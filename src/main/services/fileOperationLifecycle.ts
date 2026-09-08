import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { assertSynchronousOperation, type SynchronousResult } from './auditedTransaction'
import {
  FileOperationJournal,
  classifyFileOperationError,
  recordFileOperationCommit,
  type FileOperationIdentity,
  type FileOperationLease,
  type FileOperationRecoveryRecord
} from './fileOperationJournal'

export interface FileOperationRecoveryHandler {
  /** 主库已提交后完成不可逆收尾；失败保留 recovery_required。 */
  complete?(record: FileOperationRecoveryRecord, savePlan: (plan: Record<string, unknown>) => void): undefined
  /** 校验最终文件，禁止仅根据数据库提交标记推断文件仍然完整。 */
  verify(record: FileOperationRecoveryRecord): boolean
  /** 只能补偿恢复计划中可证明归属本操作的文件。 */
  compensate(
    record: FileOperationRecoveryRecord,
    savePlan?: (plan: Record<string, unknown>) => void
  ): undefined
}

function verifyFiles(
  handler: FileOperationRecoveryHandler,
  record: FileOperationRecoveryRecord
): boolean {
  const result = handler.verify(record)
  if (typeof result !== 'boolean') throw new TypeError('文件校验必须同步返回布尔值')
  return result
}

export class FileOperationLifecycle {
  constructor(
    private readonly journal: FileOperationJournal,
    private readonly db: Database.Database
  ) {}

  recoverPending(handlers: Readonly<Record<string, FileOperationRecoveryHandler>>): {
    busy: boolean
    recovered: number
    manual: number
  } {
    if (this.db.inTransaction) throw new Error('文件操作恢复不得嵌套在数据库事务中')
    const lease = this.journal.tryAcquire()
    if (!lease) return { busy: true, recovered: 0, manual: 0 }
    let recovered = 0
    let manual = 0
    try {
      for (const summary of this.journal.list()) {
        if (
          summary.state === 'succeeded' ||
          (summary.state === 'failed' && ['completed', 'not_needed'].includes(summary.compensation))
        )
          continue
        const handler = Object.hasOwn(handlers, summary.kind) ? handlers[summary.kind] : undefined
        if (!handler) {
          this.journal.transition(lease, summary.operationId, 'recovery_required', {
            errorCode: 'UNKNOWN_OPERATION_KIND',
            compensation: 'failed'
          })
          manual += 1
          continue
        }
        try {
          this.reconcile(lease, this.journal.getRecoveryRecord(summary.operationId)!, handler)
          recovered += 1
        } catch {
          manual += 1
        }
      }
      return { busy: false, recovered, manual }
    } finally {
      lease.release()
    }
  }

  private committed(record: FileOperationRecoveryRecord): boolean {
    const marker = this.db
      .prepare(
        'SELECT journal_id,request_hash,result_digest FROM file_operation_commits WHERE operation_id=?'
      )
      .get(record.operationId) as
      | {
          journal_id: string
          request_hash: string
          result_digest: string
        }
      | undefined
    if (!marker) return false
    const digest = createHash('sha256').update(JSON.stringify(record.result)).digest('hex')
    if (
      marker.journal_id !== this.journal.journalId ||
      marker.request_hash !== record.requestHash ||
      marker.result_digest !== digest
    )
      throw new Error('文件操作提交标记不匹配')
    return true
  }

  reconcile(
    lease: FileOperationLease,
    record: FileOperationRecoveryRecord,
    handler: FileOperationRecoveryHandler
  ): void {
    lease.assertOwner(this.journal)
    assertSynchronousOperation(handler.verify as () => unknown)
    assertSynchronousOperation(handler.compensate as () => unknown)
    if (record.state === 'succeeded') return
    try {
      if (this.committed(record)) {
        if (handler.complete) {
          assertSynchronousOperation(handler.complete as () => unknown)
          const result = handler.complete(record, plan => this.journal.saveRecoveryPlan(lease, record.operationId, plan))
          if (result !== undefined) throw new TypeError('文件收尾必须同步完成')
        }
        if (!verifyFiles(handler, record)) throw new Error('已提交文件不完整，需人工处理')
        this.journal.transition(lease, record.operationId, 'succeeded', {
          compensation: 'not_needed'
        })
      } else {
        const compensation = handler.compensate(record, (plan) =>
          this.journal.saveRecoveryPlan(lease, record.operationId, plan)
        )
        if (compensation !== undefined)
          throw new TypeError('文件补偿必须同步完成，不得返回 Promise')
        this.journal.transition(lease, record.operationId, 'failed', {
          errorCode: record.errorCode ?? 'INTERRUPTED',
          compensation: 'completed'
        })
      }
    } catch (error) {
      this.journal.transition(lease, record.operationId, 'recovery_required', {
        errorCode: classifyFileOperationError(error),
        compensation: 'failed'
      })
      throw error
    }
  }

  /** 文件准备/发布同步执行；数据库业务、成功日志和提交标记同事务提交。 */
  executeReplacement<T>(
    identity: FileOperationIdentity,
    handler: FileOperationRecoveryHandler,
    replace: (
      commitCandidate: (candidate: Database.Database, result: T) => undefined,
      lease: FileOperationLease
    ) => undefined,
    reopen: () => Database.Database
  ): T {
    assertSynchronousOperation(replace as () => unknown)
    assertSynchronousOperation(reopen)
    if (handler.complete) assertSynchronousOperation(handler.complete as () => unknown)
    assertSynchronousOperation(handler.verify as () => unknown)
    assertSynchronousOperation(handler.compensate as () => unknown)
    if (this.db.inTransaction) throw new Error('数据库替换不得嵌套在事务中')
    const lease = this.journal.tryAcquire()
    if (!lease) throw new Error('其他文件操作正在执行，请稍后重试')
    try {
      const unresolved = this.journal
        .list()
        .some(
          (record) =>
            record.operationId !== identity.operationId &&
            record.state !== 'succeeded' &&
            !(
              record.state === 'failed' && ['completed', 'not_needed'].includes(record.compensation)
            )
        )
      if (unresolved) throw new Error('存在尚未恢复完成的文件操作，禁止替换数据库')
      let record = this.journal.plan(lease, identity)
      if (record.state === 'succeeded') {
        if (!this.committed(record) || !verifyFiles(handler, record))
          throw new Error('历史数据库替换结果不一致，禁止重复执行')
        return record.result as T
      }
      if (record.state !== 'planned') {
        this.reconcile(lease, record, handler)
        record = this.journal.getRecoveryRecord(identity.operationId)!
        if (record.state === 'succeeded') return record.result as T
      }
      this.journal.transition(lease, identity.operationId, 'running', {
        compensation: 'pending',
        completedSteps: []
      })
      try {
        const returned = replace((candidate, result) => {
          if (!candidate.inTransaction) throw new Error('候选库标记必须与业务在同一事务提交')
          const resultDigest = this.journal.savePreparedResult(lease, identity.operationId, result)
          recordFileOperationCommit(candidate, {
            operationId: identity.operationId,
            journalId: this.journal.journalId,
            requestHash: identity.requestHash,
            resultDigest
          })
        }, lease)
        if (returned !== undefined) throw new TypeError('数据库替换必须同步完成')
        const current = new FileOperationLifecycle(this.journal, reopen())
        current.reconcile(lease, this.journal.getRecoveryRecord(identity.operationId)!, handler)
        const completed = this.journal.getRecoveryRecord(identity.operationId)!
        if (completed.state !== 'succeeded') throw new Error('数据库替换未提交')
        return completed.result as T
      } catch (error) {
        this.journal.transition(lease, identity.operationId, 'recovery_required', {
          errorCode: classifyFileOperationError(error),
          compensation: 'pending'
        })
        try {
          new FileOperationLifecycle(this.journal, reopen()).reconcile(
            lease,
            this.journal.getRecoveryRecord(identity.operationId)!,
            handler
          )
          const recovered = this.journal.getRecoveryRecord(identity.operationId)!
          if (recovered.state === 'succeeded') return recovered.result as T
        } catch {
          /* 保留 recovery_required，由启动恢复或人工处理。 */
        }
        throw error
      }
    } finally {
      lease.release()
    }
  }

  /** 文件准备/发布同步执行；数据库业务、成功日志和提交标记同事务提交。 */
  execute<T, P = void>(
    identity: FileOperationIdentity,
    handler: FileOperationRecoveryHandler,
    prepare: (lease: FileOperationLease) => P & SynchronousResult<P>,
    commit: () => T & SynchronousResult<T>
  ): T {
    assertSynchronousOperation(prepare as () => unknown)
    assertSynchronousOperation(commit)
    if (handler.complete) assertSynchronousOperation(handler.complete as () => unknown)
    assertSynchronousOperation(handler.verify as () => unknown)
    assertSynchronousOperation(handler.compensate as () => unknown)
    if (this.db.inTransaction) throw new Error('文件操作生命周期不得嵌套在数据库事务中')
    const lease = this.journal.tryAcquire()
    if (!lease) throw new Error('其他文件操作正在执行，请稍后重试')
    try {
      let record = this.journal.plan(lease, identity)
      if (record.state === 'succeeded') {
        if (!this.committed(record) || !verifyFiles(handler, record))
          throw new Error('历史操作结果与当前数据不一致，禁止重复执行')
        return record.result as T
      }
      if (record.state !== 'planned') {
        this.reconcile(lease, record, handler)
        record = this.journal.getRecoveryRecord(identity.operationId)!
        if (record.state === 'succeeded') return record.result as T
      }
      this.journal.transition(lease, identity.operationId, 'running', {
        compensation: 'pending',
        completedSteps: []
      })
      try {
        const prepared = prepare(lease)
        if (prepared && typeof (prepared as { then?: unknown }).then === 'function')
          throw new Error('文件操作准备回调不得返回 Promise')
        const result = this.db
          .transaction(() => {
            const value = commit()
            if (value && typeof (value as { then?: unknown }).then === 'function')
              throw new Error('文件操作提交回调不得返回 Promise')
            const resultDigest = this.journal.savePreparedResult(lease, identity.operationId, value)
            recordFileOperationCommit(this.db, {
              operationId: identity.operationId,
              journalId: this.journal.journalId,
              requestHash: identity.requestHash,
              resultDigest
            })
            if (!verifyFiles(handler, this.journal.getRecoveryRecord(identity.operationId)!))
              throw new Error('文件发布校验失败')
            return value
          })
          .immediate()
        this.reconcile(lease, this.journal.getRecoveryRecord(identity.operationId)!, handler)
        return result
      } catch (error) {
        this.journal.transition(lease, identity.operationId, 'recovery_required', {
          errorCode: classifyFileOperationError(error),
          compensation: 'pending'
        })
        this.reconcile(lease, this.journal.getRecoveryRecord(identity.operationId)!, handler)
        const recovered = this.journal.getRecoveryRecord(identity.operationId)!
        if (recovered.state === 'succeeded') return recovered.result as T
        throw error
      }
    } finally {
      lease.release()
    }
  }
}

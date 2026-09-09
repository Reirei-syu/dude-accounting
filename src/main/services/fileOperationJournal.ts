import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { resolveContainedPath } from './containedPath'

export type FileOperationState =
  | 'planned'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'recovery_required'
export type FileOperationCompensation = 'not_needed' | 'pending' | 'completed' | 'failed'

export interface FileOperationIdentity {
  operationId: string
  kind: string
  actorId: number
  username: string
  ledgerId: number | null
  requestHash: string
}

export interface FileOperationSummary extends FileOperationIdentity {
  state: FileOperationState
  attempt: number
  createdAt: string
  startedAt: string | null
  updatedAt: string
  finishedAt: string | null
  errorCode: string | null
  compensation: FileOperationCompensation
  completedSteps: string[]
}

/** 私有恢复数据，不得直接作为日志、IPC 或 CLI 返回值。 */
export interface FileOperationRecoveryRecord extends FileOperationSummary {
  recoveryPlan: Record<string, unknown>
  result: unknown
}

export function requireOperationId(value: unknown): string {
  if (value === undefined) return randomUUID()
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('operationId 必须是 UUID v4')
  }
  return value.toLowerCase()
}

export function classifyFileOperationError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (
    typeof code === 'string' &&
    /^(?:SQLITE_[A-Z_]+|ENOSPC|EACCES|EPERM|ENOENT|EEXIST|EXDEV|EBUSY|EIO)$/.test(code)
  )
    return code
  return 'OPERATION_FAILED'
}

export class FileOperationLease {
  private released = false
  constructor(
    readonly owner: FileOperationJournal,
    private connection: Database.Database
  ) {}
  assertOwner(journal: FileOperationJournal): void {
    if (this.released || this.owner !== journal) throw new Error('操作租约无效')
  }
  release(): void {
    if (this.released) return
    this.released = true
    this.connection.close()
  }
}

/** 独立于可替换业务库的持久控制记录；全部路径由显式主库路径派生。 */
export class FileOperationJournal {
  readonly journalId: string
  private readonly db: Database.Database
  private readonly root: string
  /** 仅供主进程审计 SQL 联合查询使用，不得返回 IPC/CLI。 */
  readonly databasePath: string
  constructor(targetDatabasePath: string) {
    if (!path.isAbsolute(targetDatabasePath)) throw new Error('操作记录必须使用显式绝对数据库路径')
    this.root = resolveContainedPath(
      path.dirname(targetDatabasePath),
      `${path.basename(targetDatabasePath)}.operations`
    )
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    const file = resolveContainedPath(this.root, 'journal.sqlite')
    this.databasePath = file
    this.db = new Database(file)
    try {
      const version = this.db.pragma('user_version', { simple: true }) as number
      if (version !== 0 && version !== 1) throw new Error('不支持的文件操作记录版本')
      this.db.pragma('journal_mode=WAL')
      this.db.pragma('synchronous=FULL')
      this.db
        .transaction(() => {
          this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
          operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor_id INTEGER NOT NULL,
          username TEXT NOT NULL, ledger_id INTEGER, request_hash TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('planned','running','succeeded','failed','recovery_required')),
          attempt INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
          error_code TEXT, compensation TEXT NOT NULL DEFAULT 'not_needed'
            CHECK(compensation IN ('not_needed','pending','completed','failed')),
          steps_json TEXT NOT NULL DEFAULT '[]', plan_json TEXT NOT NULL DEFAULT '{}', result_json TEXT
        );
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL,
          state TEXT NOT NULL, created_at TEXT NOT NULL, error_code TEXT, compensation TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_audit_time ON events(julianday(created_at) DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_events_operation ON events(operation_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_operations_audit_actor ON operations(actor_id, ledger_id, kind);`)
          this.db
            .prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('journal_id',?)")
            .run(randomUUID())
          this.db.pragma('user_version=1')
        })
        .immediate()
      const identity = this.db
        .prepare("SELECT value FROM metadata WHERE key='journal_id'")
        .get() as { value: string }
      this.journalId = requireOperationId(identity.value)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  close(): void {
    this.db.close()
  }

  /** busy 表示另一个活跃进程持有租约；不能把它作为残留恢复。 */
  tryAcquire(): FileOperationLease | null {
    const connection = new Database(resolveContainedPath(this.root, 'execution-lock.sqlite'), {
      timeout: 0
    })
    try {
      connection.exec('BEGIN EXCLUSIVE')
      return new FileOperationLease(this, connection)
    } catch (error) {
      connection.close()
      if ((error as { code?: string }).code === 'SQLITE_BUSY') return null
      throw error
    }
  }

  plan(lease: FileOperationLease, identity: FileOperationIdentity): FileOperationRecoveryRecord {
    lease.assertOwner(this)
    const operationId = requireOperationId(identity.operationId)
    if (
      !/^[a-z][a-z0-9_]{0,79}$/.test(identity.kind) ||
      !/^[a-f0-9]{64}$/.test(identity.requestHash)
    )
      throw new Error('操作种类或请求摘要无效')
    return this.db
      .transaction(() => {
        const existing = this.getRecoveryRecord(operationId)
        if (existing) {
          if (
            existing.kind !== identity.kind ||
            existing.actorId !== identity.actorId ||
            existing.ledgerId !== identity.ledgerId ||
            existing.requestHash !== identity.requestHash
          )
            throw new Error('operationId 已绑定其他请求')
          return existing
        }
        const now = new Date().toISOString()
        this.db
          .prepare(
            `INSERT INTO operations(operation_id,kind,actor_id,username,ledger_id,request_hash,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'planned',?,?)`
          )
          .run(
            operationId,
            identity.kind,
            identity.actorId,
            identity.username,
            identity.ledgerId,
            identity.requestHash,
            now,
            now
          )
        this.recordEvent(operationId, 'planned', now, null, 'not_needed')
        return this.getRecoveryRecord(operationId)!
      })
      .immediate()
  }

  saveRecoveryPlan(
    lease: FileOperationLease,
    operationId: string,
    plan: Record<string, unknown>
  ): void {
    lease.assertOwner(this)
    operationId = requireOperationId(operationId)
    const current = this.requireRecord(operationId)
    if (!['planned', 'running', 'recovery_required', 'failed'].includes(current.state))
      throw new Error('当前操作状态不允许更改恢复计划')
    this.db
      .prepare('UPDATE operations SET plan_json=?, updated_at=? WHERE operation_id=?')
      .run(JSON.stringify(plan), new Date().toISOString(), operationId)
  }

  checkpoint(lease: FileOperationLease, operationId: string, step: string): void {
    lease.assertOwner(this)
    operationId = requireOperationId(operationId)
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(step)) throw new Error('步骤名称无效')
    this.db
      .transaction(() => {
        const current = this.requireRecord(operationId)
        if (current.state !== 'running') throw new Error('只有运行中操作可以记录步骤')
        this.db
          .prepare('UPDATE operations SET steps_json=?,updated_at=? WHERE operation_id=?')
          .run(
            JSON.stringify([...new Set([...current.completedSteps, step])]),
            new Date().toISOString(),
            operationId
          )
      })
      .immediate()
  }

  savePreparedResult(lease: FileOperationLease, operationId: string, result: unknown): string {
    lease.assertOwner(this)
    operationId = requireOperationId(operationId)
    if (this.requireRecord(operationId).state !== 'running')
      throw new Error('只有运行中操作可以准备返回结果')
    const serialized = JSON.stringify(result)
    if (serialized === undefined) throw new Error('文件操作结果必须可以序列化')
    this.db
      .prepare('UPDATE operations SET result_json=?,updated_at=? WHERE operation_id=?')
      .run(serialized, new Date().toISOString(), operationId)
    return createHash('sha256').update(serialized).digest('hex')
  }

  transition(
    lease: FileOperationLease,
    operationId: string,
    state: FileOperationState,
    options: {
      errorCode?: string
      compensation?: FileOperationCompensation
      completedSteps?: string[]
      result?: unknown
    } = {}
  ): void {
    lease.assertOwner(this)
    operationId = requireOperationId(operationId)
    this.db
      .transaction(() => {
        const current = this.requireRecord(operationId)
        const allowed: Record<FileOperationState, FileOperationState[]> = {
          planned: ['running', 'failed', 'recovery_required'],
          running: ['succeeded', 'failed', 'recovery_required'],
          succeeded: [],
          failed: ['running', 'recovery_required'],
          recovery_required: ['succeeded', 'failed', 'running']
        }
        const sameState = current.state === state
        if (sameState && !['failed', 'recovery_required'].includes(state)) return
        if (!sameState && !allowed[current.state].includes(state))
          throw new Error('非法的文件操作状态转换')
        if (
          state === 'running' &&
          ['failed', 'recovery_required'].includes(current.state) &&
          !['completed', 'not_needed'].includes(current.compensation)
        )
          throw new Error('补偿未完成，禁止直接重试')
        if (options.errorCode && !/^[A-Z][A-Z0-9_]{0,79}$/.test(options.errorCode))
          throw new Error('错误类别不得包含敏感上下文')
        const steps = options.completedSteps ?? current.completedSteps
        if (steps.some((step) => !/^[a-z][a-z0-9_]{0,79}$/.test(step)))
          throw new Error('步骤名称无效')
        const compensation = options.compensation ?? current.compensation
        const now = new Date().toISOString()
        const finished = state === 'failed' || state === 'succeeded' ? now : null
        this.db
          .prepare(
            `UPDATE operations SET state=?,attempt=attempt+?,updated_at=?,started_at=?,finished_at=?,error_code=?,compensation=?,steps_json=?,result_json=? WHERE operation_id=?`
          )
          .run(
            state,
            Number(state === 'running'),
            now,
            state === 'running' ? now : current.startedAt,
            finished,
            options.errorCode ?? null,
            compensation,
            JSON.stringify(steps),
            options.result === undefined
              ? JSON.stringify(current.result)
              : JSON.stringify(options.result),
            operationId
          )
        this.recordEvent(operationId, state, now, options.errorCode ?? null, compensation)
      })
      .immediate()
  }

  getRecoveryRecord(operationId: string): FileOperationRecoveryRecord | null {
    const row = this.db
      .prepare('SELECT * FROM operations WHERE operation_id=?')
      .get(requireOperationId(operationId)) as Record<string, unknown> | undefined
    if (!row) return null
    return {
      operationId: String(row.operation_id),
      kind: String(row.kind),
      actorId: Number(row.actor_id),
      username: String(row.username),
      ledgerId: row.ledger_id === null ? null : Number(row.ledger_id),
      requestHash: String(row.request_hash),
      state: row.state as FileOperationState,
      attempt: Number(row.attempt),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      startedAt: row.started_at === null ? null : String(row.started_at),
      finishedAt: row.finished_at === null ? null : String(row.finished_at),
      errorCode: row.error_code === null ? null : String(row.error_code),
      compensation: row.compensation as FileOperationCompensation,
      completedSteps: JSON.parse(String(row.steps_json)),
      recoveryPlan: JSON.parse(String(row.plan_json)),
      result: row.result_json === null ? null : JSON.parse(String(row.result_json))
    }
  }

  listAuditEvents(): Array<{
    id: number
    operationId: string
    kind: string
    actorId: number
    username: string
    ledgerId: number | null
    state: string
    createdAt: string
    errorCode: string | null
    compensation: string
    currentCompletedStepsJson: string
  }> {
    return this.db
      .prepare(
        `SELECT e.id, e.operation_id AS operationId, o.kind,
      o.actor_id AS actorId, o.username, o.ledger_id AS ledgerId,
      e.state, e.created_at AS createdAt, e.error_code AS errorCode, e.compensation,
      o.steps_json AS currentCompletedStepsJson
      FROM events e JOIN operations o ON o.operation_id=e.operation_id ORDER BY e.id DESC`
      )
      .all() as ReturnType<FileOperationJournal['listAuditEvents']>
  }

  list(): FileOperationSummary[] {
    const ids = this.db
      .prepare('SELECT operation_id FROM operations ORDER BY created_at,operation_id')
      .all() as { operation_id: string }[]
    return ids.map(({ operation_id }) => {
      const record = this.requireRecord(operation_id)
      const { recoveryPlan: _plan, result: _result, ...summary } = record
      void _plan
      void _result
      return summary
    })
  }

  private requireRecord(operationId: string): FileOperationRecoveryRecord {
    const record = this.getRecoveryRecord(operationId)
    if (!record) throw new Error('文件操作记录不存在')
    return record
  }
  private recordEvent(
    id: string,
    state: FileOperationState,
    now: string,
    code: string | null,
    compensation: FileOperationCompensation
  ): void {
    this.db
      .prepare(
        'INSERT INTO events(operation_id,state,created_at,error_code,compensation) VALUES(?,?,?,?,?)'
      )
      .run(id, state, now, code, compensation)
  }
}

/** 必须与业务和成功日志同一事务；控制记录以此识别文件已发布但进程未确认的提交。 */
export function recordFileOperationCommit(
  db: Database.Database,
  marker: { operationId: string; journalId: string; requestHash: string; resultDigest: string }
): void {
  if (!db.inTransaction) throw new Error('文件操作提交标记必须位于业务事务中')
  if (![marker.requestHash, marker.resultDigest].every((value) => /^[a-f0-9]{64}$/.test(value)))
    throw new Error('文件操作提交摘要无效')
  db.prepare(
    'INSERT INTO file_operation_commits(operation_id,journal_id,request_hash,result_digest) VALUES(?,?,?,?)'
  ).run(
    requireOperationId(marker.operationId),
    requireOperationId(marker.journalId),
    marker.requestHash,
    marker.resultDigest
  )
}

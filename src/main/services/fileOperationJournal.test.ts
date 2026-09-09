import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCurrentSchema } from '../database/schema'
import { runDatabaseMigrations } from '../database/migrations'
import { FileOperationLifecycle } from './fileOperationLifecycle'
import { fileOperationDeletionRecovery, prepareFileOperationDeletion } from './fileOperationDeletion'
import { listAuditableOperations } from './fileOperationAudit'
import { exportOperationLogsAsCsv } from './auditLog'
import { restoreBackupArtifact } from './backupRecovery'
import { computeFileSha256 } from './fileIntegrity'
import { recoverPendingFileOperations } from './fileOperationStartup'
import { prepareFileOperationFileExport } from './fileOperationFileExport'
import { exportArchiveCommand } from '../commands/archiveCommands'
import {
  restoreBackupCommand,
  createBackupCommand,
  importBackupCommand
} from '../commands/backupCommands'
import { closeDatabase, getDatabase, initializeDatabase } from '../database/init'
import { setRuntimeContext, clearRuntimeContext } from '../runtime/runtimeContext'
import { consumeEmbeddedCliState } from '../runtime/embeddedCliState'
import { importElectronicVoucherCommand } from '../commands/electronicVoucherCommands'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import { createNodeRuntimeContext } from '../runtime/runtimeContext'
import {
  fileOperationArtifactRecovery,
  prepareFileOperationArtifact
} from './fileOperationArtifact'
import {
  FileOperationJournal,
  type FileOperationLease,
  requireOperationId,
  classifyFileOperationError,
  recordFileOperationCommit
} from './fileOperationJournal'

describe('文件操作控制记录基础', () => {
  let root: string
  let databasePath: string
  const journals: FileOperationJournal[] = []
  const leases: FileOperationLease[] = []
  beforeEach(() => {
    const base = path.resolve('.tmp')
    fs.mkdirSync(base, { recursive: true })
    root = fs.mkdtempSync(path.join(base, 'file-operation-test-'))
    databasePath = path.join(root, 'business.sqlite')
  })
  afterEach(() => {
    for (const lease of leases.splice(0)) lease.release()
    for (const journal of journals.splice(0)) journal.close()
    if (
      path.dirname(root) !== path.resolve('.tmp') ||
      !path.basename(root).startsWith('file-operation-test-')
    )
      throw new Error('测试清理目标越界')
    fs.rmSync(root, { recursive: true, force: true })
  })
  function open(): FileOperationJournal {
    const journal = new FileOperationJournal(databasePath)
    journals.push(journal)
    return journal
  }
  function lock(journal: FileOperationJournal): FileOperationLease {
    const lease = journal.tryAcquire()
    expect(lease).not.toBeNull()
    leases.push(lease!)
    return lease!
  }
  function identity(): {
    operationId: string
    kind: string
    actorId: number
    username: string
    ledgerId: number
    requestHash: string
  } {
    return {
      operationId: requireOperationId(undefined),
      kind: 'backup_create',
      actorId: 1,
      username: 'admin',
      ledgerId: 1,
      requestHash: 'a'.repeat(64)
    }
  }
  it.each(['occupied', 'interrupted'] as const)('删除回滚原子恢复文件：%s', mode => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.transition(lease, input.operationId, 'running')
    const original = path.join(root, 'original.txt')
    fs.writeFileSync(original, 'original')
    prepareFileOperationDeletion(journal, lease, input.operationId, [original], root)
    const record = journal.getRecoveryRecord(input.operationId)!
    const staged = path.join(root, `operation-${input.operationId}`, 'result', 'item-0')
    if (mode === 'occupied') {
      const link = fs.linkSync
      const fault = vi.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
        fs.writeFileSync(target, 'independent', { flag: 'wx' })
        return link(source, target)
      })
      try { expect(() => fileOperationDeletionRecovery.compensate(record)).toThrow('禁止覆盖') }
      finally { fault.mockRestore() }
      expect(fs.readFileSync(original, 'utf8')).toBe('independent')
      expect(fs.readFileSync(staged, 'utf8')).toBe('original')
    } else {
      fs.linkSync(staged, original)
      fileOperationDeletionRecovery.compensate(record)
      expect(fs.readFileSync(original, 'utf8')).toBe('original')
      expect(fs.existsSync(staged)).toBe(false)
      fileOperationDeletionRecovery.compensate(record)
    }
  })
  it.each([false, true])('CSV 发布后重启按主库提交证据收敛：%s', committed => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const journal = open()
      const lease = lock(journal)
      const input = { ...identity(), kind: 'audit_log_export', ledgerId: null }
      journal.plan(lease, input)
      journal.transition(lease, input.operationId, 'running')
      const target = path.join(root, 'published.csv')
      prepareFileOperationFileExport(journal, lease, input.operationId, target, 'csv')
      if (committed) {
        const result = { filePath: target }
        const resultDigest = journal.savePreparedResult(lease, input.operationId, result)
        db.transaction(() => recordFileOperationCommit(db, {
          operationId: input.operationId, journalId: journal.journalId,
          requestHash: input.requestHash, resultDigest
        }))()
      }
      lease.release()
      expect(recoverPendingFileOperations(db).manual).toBe(0)
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe(committed ? 'succeeded' : 'failed')
      expect(fs.existsSync(target)).toBe(committed)
      expect(recoverPendingFileOperations(db).recovered).toBe(0)
    } finally { db.close() }
  })
  it('CSV撤回移动后清理中断，下一次恢复继续且不永久运行', () => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const journal = open()
      const lease = lock(journal)
      const input = { ...identity(), kind: 'audit_log_export', ledgerId: null }
      journal.plan(lease, input)
      journal.transition(lease, input.operationId, 'running')
      const target = path.join(root, 'interrupted.csv')
      prepareFileOperationFileExport(journal, lease, input.operationId, target, 'csv')
      lease.release()
      const unlink = fs.unlinkSync
      const fault = vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
        if (String(file).endsWith(`${path.sep}withdrawn`)) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        return unlink(file)
      })
      try { expect(recoverPendingFileOperations(db).manual).toBe(1) }
      finally { fault.mockRestore() }
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('recovery_required')
      expect(recoverPendingFileOperations(db).manual).toBe(0)
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('failed')
      expect(fs.existsSync(target)).toBe(false)
    } finally { db.close() }
  })
  it('SQLite UTC 与带时区事件按真实时间混排后再限制条数', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    lease.release()
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const event = journal.listAuditEvents()[0]
      const newer = new Date(Date.parse(event.createdAt) + 60_000).toISOString().slice(0, 19).replace('T', ' ')
      db.prepare("INSERT INTO operation_logs(module,action,details_json,created_at) VALUES('newer','test','{}',?)").run(newer)
      expect(listAuditableOperations(db, { limit: 1 })[0].module).toBe('newer')
      expect(listAuditableOperations(db, { limit: 2 })[1].target_id).toBe(input.operationId)
    } finally { db.close() }
  })
  it('状态、步骤和私有恢复计划持久化到同一显式控制目录', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.saveRecoveryPlan(lease, input.operationId, { staging: 'private-path' })
    journal.transition(lease, input.operationId, 'running')
    journal.checkpoint(lease, input.operationId, 'files_staged')
    lease.release()
    const second = open()
    expect(second.getRecoveryRecord(input.operationId)).toMatchObject({
      state: 'running',
      attempt: 1,
      recoveryPlan: { staging: 'private-path' },
      completedSteps: ['files_staged']
    })
    expect(second.getRecoveryRecord(input.operationId)?.startedAt).toBeTruthy()
  })
  it('同一主库的两个不同操作也必须串行，状态记录不被长锁阻塞', () => {
    const first = open()
    const second = open()
    const lease = lock(first)
    first.plan(lease, identity())
    expect(second.tryAcquire()).toBeNull()
    expect(second.list()).toHaveLength(1)
    lease.release()
    lock(second)
  })
  it('相同ID绑定相同身份和请求，成功状态不可重新运行', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    expect(() => journal.plan(lease, { ...input, actorId: 2 })).toThrow('其他请求')
    expect(() => journal.plan(lease, { ...input, requestHash: 'b'.repeat(64) })).toThrow('其他请求')
    journal.transition(lease, input.operationId, 'running')
    journal.transition(lease, input.operationId, 'succeeded', { result: { id: 3 } })
    expect(journal.plan(lease, input)).toMatchObject({
      state: 'succeeded',
      result: { id: 3 },
      attempt: 1
    })
    expect(() => journal.transition(lease, input.operationId, 'running')).toThrow('非法')
  })
  it('补偿失败阻止重试，恢复完成后同ID可以再次执行', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.transition(lease, input.operationId, 'running')
    journal.transition(lease, input.operationId, 'recovery_required', {
      compensation: 'failed',
      errorCode: 'EACCES'
    })
    expect(() => journal.transition(lease, input.operationId, 'running')).toThrow('补偿未完成')
    journal.transition(lease, input.operationId, 'failed', {
      compensation: 'completed',
      errorCode: 'EACCES'
    })
    journal.transition(lease, input.operationId, 'running')
    expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
      attempt: 2,
      state: 'running'
    })
  })
  it('重复恢复在状态不变时仍持久化补偿结果且不增加尝试次数', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.transition(lease, input.operationId, 'running')
    journal.transition(lease, input.operationId, 'recovery_required', { compensation: 'pending' })
    journal.transition(lease, input.operationId, 'recovery_required', {
      compensation: 'failed',
      errorCode: 'EACCES'
    })
    expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
      state: 'recovery_required',
      compensation: 'failed',
      errorCode: 'EACCES',
      attempt: 1
    })
    journal.transition(lease, input.operationId, 'failed', { compensation: 'pending' })
    journal.transition(lease, input.operationId, 'failed', { compensation: 'completed' })
    expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
      state: 'failed',
      compensation: 'completed',
      attempt: 1
    })
    journal.transition(lease, input.operationId, 'running')
    expect(journal.getRecoveryRecord(input.operationId)?.attempt).toBe(2)
  })
  it('删除先暂存，业务失败恢复原文件，重试提交后才不可逆清理', () => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const journal = open()
      const input = { ...identity(), kind: 'backup_delete' }
      const original = path.join(root, 'owned-package')
      fs.mkdirSync(original)
      fs.writeFileSync(path.join(original, 'data'), 'keep-on-failure')
      let fail = true
      const execute = (): boolean => new FileOperationLifecycle(journal, db).execute(input,
        fileOperationDeletionRecovery,
        lease => prepareFileOperationDeletion(journal, lease, input.operationId, [original], root),
        () => { if (fail) throw new Error('模拟审计失败'); return true })
      expect(execute).toThrow('模拟审计失败')
      expect(fs.readFileSync(path.join(original, 'data'), 'utf8')).toBe('keep-on-failure')
      fail = false
      expect(execute()).toBe(true)
      expect(execute()).toBe(true)
      expect(fs.existsSync(original)).toBe(false)
      expect(fs.existsSync(path.join(root, `operation-${input.operationId}`))).toBe(false)
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('succeeded')
    } finally { db.close() }
  })
  it.each(['staging', 'published', 'committed'])('子进程在 %s 直接退出后重启恢复收敛', (phase) => {
    const input = identity()
    const serviceRoot = path.resolve('out/cli/main/services')
    const program = `
      const fs=require('node:fs'), path=require('node:path'), D=require('better-sqlite3');
      const {runDatabaseMigrations}=require(${JSON.stringify(path.resolve('out/cli/main/database/migrations.js'))});
      const {FileOperationJournal}=require(${JSON.stringify(path.join(serviceRoot, 'fileOperationJournal.js'))});
      const {FileOperationLifecycle}=require(${JSON.stringify(path.join(serviceRoot, 'fileOperationLifecycle.js'))});
      const {prepareFileOperationArtifact,fileOperationArtifactRecovery}=require(${JSON.stringify(path.join(serviceRoot, 'fileOperationArtifact.js'))});
      const db=new D(${JSON.stringify(databasePath)}); runDatabaseMigrations(db);
      const journal=new FileOperationJournal(db.name), phase=${JSON.stringify(phase)};
      const transition=journal.transition.bind(journal);
      journal.transition=(lease,id,state,options)=>{if(phase==='committed'&&state==='succeeded')process.exit(73);return transition(lease,id,state,options)};
      const identity=${JSON.stringify(input)};
      new FileOperationLifecycle(journal,db).execute(identity,fileOperationArtifactRecovery,lease=>{
        prepareFileOperationArtifact(journal,lease,identity.operationId,${JSON.stringify(root)},staging=>{
          fs.writeFileSync(path.join(staging,'data'),'owned');
          if(phase==='staging')process.exit(73);
        });
        if(phase==='published')process.exit(73);
      },()=>Number(db.prepare("INSERT INTO users(username) VALUES('crash-user')").run().lastInsertRowid));
    `
    const child = spawnSync(process.execPath, ['-e', program], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20000, encoding: 'utf8'
    })
    expect(child.status, child.stderr).toBe(73)
    const db = new Database(databasePath)
    try {
      expect(recoverPendingFileOperations(db)).toEqual({ busy: false, recovered: 1, manual: 0 })
      expect(recoverPendingFileOperations(db)).toEqual({ busy: false, recovered: 0, manual: 0 })
      const journal = open()
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe(phase === 'committed' ? 'succeeded' : 'failed')
      expect(db.prepare('SELECT id FROM users').all()).toHaveLength(phase === 'committed' ? 1 : 0)
      expect(fs.existsSync(path.join(root, `operation-${input.operationId}`))).toBe(phase === 'committed')
    } finally { db.close() }
  })
  it.each(['ENOSPC', 'EACCES'])('文件故障 %s 留下失败记录、无业务提交且重试收敛', (code) => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const journal = open()
      const input = identity()
      const lifecycle = new FileOperationLifecycle(journal, db)
      let inject = true
      const rename = fs.renameSync.bind(fs)
      const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (inject && code === 'EACCES' && String(to).endsWith(`${path.sep}result`))
          throw Object.assign(new Error('D:/private/credential'), { code })
        rename(from, to)
      })
      const execute = (): number => lifecycle.execute(input, fileOperationArtifactRecovery, lease => {
        prepareFileOperationArtifact(journal, lease, input.operationId, root, staging => {
          fs.writeFileSync(path.join(staging, 'data'), 'partial')
          if (inject && code === 'ENOSPC') throw Object.assign(new Error('D:/private/credential'), { code })
        })
      }, () => Number(db.prepare("INSERT INTO users(username) VALUES('file-operation-user')").run().lastInsertRowid))
      try {
        expect(execute).toThrow()
        expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({ state: 'failed', errorCode: code, compensation: 'completed' })
        expect(fs.existsSync(path.join(root, `operation-${input.operationId}`))).toBe(false)
        expect(db.prepare('SELECT id FROM users').all()).toEqual([])
        expect(db.prepare('SELECT operation_id FROM file_operation_commits').all()).toEqual([])
        inject = false
        const first = execute()
        expect(execute()).toBe(first)
        expect(db.prepare('SELECT id FROM users').all()).toHaveLength(1)
      } finally { fault.mockRestore() }
    } finally { db.close() }
  })
  it('公开结果不包含私有路径或结果，错误只保留类别', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.saveRecoveryPlan(lease, input.operationId, { target: 'D:/private/company/invoice.xml' })
    journal.transition(lease, input.operationId, 'running')
    journal.transition(lease, input.operationId, 'failed', {
      errorCode: classifyFileOperationError(
        Object.assign(new Error('D:/private/company/invoice.xml password'), { code: 'ENOSPC' })
      ),
      compensation: 'completed'
    })
    const publicData = JSON.stringify(journal.list())
    expect(publicData).toContain('ENOSPC')
    expect(publicData).not.toContain('private')
    expect(publicData).not.toContain('password')
    expect(classifyFileOperationError(new Error('private'))).toBe('OPERATION_FAILED')
    lease.release()
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const rows = listAuditableOperations(db, { module: 'file_operation', keyword: 'ENOSPC' })
      expect(rows).toHaveLength(1)
      expect(rows[0].target_id).toBe(input.operationId)
      const csv = exportOperationLogsAsCsv(rows)
      expect(csv).toContain('failed')
      expect(csv).toContain('completed')
      expect(csv).not.toContain('private')
      expect(csv).not.toContain('password')
      expect(listAuditableOperations(db, { ledgerId: 999 })).toEqual([])
    } finally {
      db.close()
    }
  })
  it('释放后的租约不能更新记录，UUID大小写规范化', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, { ...input, operationId: input.operationId.toUpperCase() })
    journal.transition(lease, input.operationId.toUpperCase(), 'running')
    expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('running')
    lease.release()
    expect(() => journal.transition(lease, input.operationId, 'failed')).toThrow('租约无效')
  })
  it('真实备份创建及导入按操作ID只生成一份备份和新账套', async () => {
    setRuntimeContext(createNodeRuntimeContext({ userDataPath: root, isDevelopment: true }))
    try {
      initializeDatabase()
      const db = getDatabase()
      const actorId = (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: number }).id
      db.exec(
        "INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'测试源账套','2026-01','2026-01')"
      )
      const context = {
        db,
        actor: resolveSessionActor(db, issueSession(db, actorId), 'cli'),
        runtime: createNodeRuntimeContext({ userDataPath: root }),
        outputMode: 'json' as const,
        now: new Date()
      }
      const createPayload = {
        ledgerId: 1,
        directoryPath: root,
        operationId: requireOperationId(undefined)
      }
      const created = await createBackupCommand(context, createPayload)
      expect(created.status, JSON.stringify(created.error)).toBe('success')
      expect(await createBackupCommand(context, createPayload)).toEqual(created)
      const importPayload = {
        backupId: created.data!.backupId,
        operationId: requireOperationId(undefined)
      }
      const imported = await importBackupCommand(context, importPayload)
      expect(imported.status, JSON.stringify(imported.error)).toBe('success')
      expect(await importBackupCommand(context, importPayload)).toEqual(imported)
      expect(context.db.prepare('SELECT id FROM ledgers').all()).toHaveLength(2)
      expect(
        context.db
          .prepare("SELECT id FROM operation_logs WHERE module='backup' AND action='import'")
          .all()
      ).toHaveLength(1)
    } finally {
      closeDatabase()
      clearRuntimeContext()
    }
  })
  it('真实恢复命令在候选库写审计，切换后记录成功且撤销旧会话', async () => {
    setRuntimeContext(createNodeRuntimeContext({ userDataPath: root, isDevelopment: true }))
    try {
      initializeDatabase()
      const db = getDatabase()
      const actorId = Number(
        (db.prepare('SELECT id FROM users LIMIT 1').get() as { id: number }).id
      )
      const actor = resolveSessionActor(db, issueSession(db, actorId), 'cli')
      const packagePath = path.join(root, 'restore-package')
      fs.mkdirSync(packagePath)
      const backupPath = path.join(packagePath, 'database.db')
      const source = new Database(backupPath)
      runDatabaseMigrations(source)
      source.prepare('INSERT INTO file_operation_commits(operation_id,journal_id,request_hash,result_digest) VALUES(?,?,?,?)')
        .run(requireOperationId(undefined), requireOperationId(undefined), 'old-hash', 'old-result')
      source.close()
      fs.writeFileSync(
        path.join(packagePath, 'manifest.json'),
        JSON.stringify({
          schemaVersion: '1.0',
          packageType: 'system_backup',
          databaseFile: 'database.db',
          checksum: computeFileSha256(backupPath),
          fileSize: fs.statSync(backupPath).size
        })
      )
      const context = {
        db,
        actor,
        runtime: createNodeRuntimeContext({ userDataPath: root }),
        outputMode: 'json' as const,
        now: new Date()
      }
      const operationId = requireOperationId(undefined)
      const result = await restoreBackupCommand(context, { packagePath, operationId })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(context.db.prepare('SELECT * FROM auth_sessions').all()).toEqual([])
      expect(context.db.prepare('SELECT operation_id FROM file_operation_commits').all())
        .toEqual([{ operation_id: operationId }])
      expect(
        context.db.prepare("SELECT target_id FROM operation_logs WHERE action='restore'").all()
      ).toEqual([{ target_id: operationId }])
      const journal = new FileOperationJournal(context.db.name)
      try {
        expect(journal.getRecoveryRecord(operationId)?.state).toBe('succeeded')
      } finally {
        journal.close()
      }
    } finally {
      closeDatabase()
      clearRuntimeContext()
      consumeEmbeddedCliState()
    }
  })
  it('其他文件操作未收敛时不允许数据库替换覆盖提交证据', () => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const journal = open()
      const lease = lock(journal)
      journal.plan(lease, identity())
      lease.release()
      let called = false
      expect(() =>
        new FileOperationLifecycle(journal, db).executeReplacement(
          { ...identity(), kind: 'backup_restore' },
          { verify: () => true, compensate: (): undefined => {} },
          () => {
            called = true
          },
          () => db
        )
      ).toThrow('禁止替换数据库')
      expect(called).toBe(false)
      expect(journal.list()).toHaveLength(1)
    } finally {
      db.close()
    }
  })
  it('整库切换成功后清理报错仍确认成功，同ID不重复执行替换', () => {
    let db = new Database(databasePath)
    runDatabaseMigrations(db)
    db.close()
    const source = path.join(root, 'restore-source.sqlite')
    fs.copyFileSync(databasePath, source)
    const checksum = computeFileSha256(source)
    db = new Database(databasePath)
    const journal = open()
    const input = { ...identity(), kind: 'backup_restore' }
    let replacements = 0
    const handler = { verify: (): boolean => true, compensate: (): undefined => {} }
    const execute = (): { restored: boolean } =>
      new FileOperationLifecycle(journal, db).executeReplacement(
        input,
        handler,
        (commitCandidate) => {
          replacements += 1
          db.close()
          restoreBackupArtifact({
            backupPath: source,
            targetPath: databasePath,
            expectedChecksum: checksum,
            manifestPath: null,
            commitCandidate(candidate) {
              commitCandidate(candidate, { restored: true })
            }
          })
          throw Object.assign(new Error('模拟切换后临时清理失败'), { code: 'EBUSY' })
        },
        () => {
          if (!db.open) db = new Database(databasePath)
          return db
        }
      )
    try {
      expect(execute()).toEqual({ restored: true })
      expect(execute()).toEqual({ restored: true })
      expect(replacements).toBe(1)
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('succeeded')
      expect(db.prepare('SELECT * FROM file_operation_commits').all()).toHaveLength(1)
    } finally {
      if (db.open) db.close()
    }
  })
  it('附件真实命令日志失败回滚文件与业务，同ID重试保留单份待验证记录', async () => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      db.exec(`INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1);
        INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'测试账套','2026-01','2026-01');
        CREATE TRIGGER fail_log BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;`)
      const context = {
        db,
        actor: resolveSessionActor(db, issueSession(db, 1), 'cli'),
        runtime: createNodeRuntimeContext({ userDataPath: root }),
        outputMode: 'json' as const,
        now: new Date()
      }
      const sourcePath = path.join(root, 'invoice.pdf')
      fs.writeFileSync(sourcePath, 'isolated-test-invoice')
      const operationId = requireOperationId(undefined)
      const payload = { ledgerId: 1, sourcePath, operationId }
      expect((await importElectronicVoucherCommand(context, payload)).status).toBe('error')
      expect(db.prepare('SELECT * FROM electronic_voucher_files').all()).toEqual([])
      expect(
        fs.existsSync(
          path.join(root, 'electronic-vouchers', 'ledger-1', `operation-${operationId}`)
        )
      ).toBe(false)
      db.exec('DROP TRIGGER fail_log')
      const first = await importElectronicVoucherCommand(context, payload)
      expect(first.status).toBe('success')
      expect(await importElectronicVoucherCommand(context, payload)).toEqual(first)
      expect(db.prepare('SELECT * FROM electronic_voucher_records').all()).toHaveLength(1)
      expect(
        db.prepare('SELECT verification_status FROM electronic_voucher_verifications').all()
      ).toEqual([{ verification_status: 'pending' }])
    } finally {
      db.close()
    }
  })
  it('归档真实命令在日志失败时回滚目录记录及文件，同ID重试只导出一次', async () => {
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      db.exec(`INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1);
        INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'测试账套','2026-01','2026-01');
        CREATE TRIGGER fail_archive_log BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;`)
      const context = {
        db,
        actor: resolveSessionActor(db, issueSession(db, 1), 'cli'),
        runtime: createNodeRuntimeContext({ userDataPath: root }),
        outputMode: 'json' as const,
        now: new Date('2026-09-08T00:00:00Z')
      }
      const operationId = requireOperationId(undefined)
      const payload = { ledgerId: 1, fiscalYear: '2026', directoryPath: root, operationId }
      expect((await exportArchiveCommand(context, payload)).status).toBe('error')
      expect(db.prepare('SELECT * FROM archive_exports').all()).toEqual([])
      expect(fs.existsSync(path.join(root, `operation-${operationId}`))).toBe(false)
      db.exec('DROP TRIGGER fail_archive_log')
      const first = await exportArchiveCommand(context, payload)
      expect(first.status).toBe('success')
      expect(fs.existsSync(first.data!.manifestPath)).toBe(true)
      expect(await exportArchiveCommand(context, payload)).toEqual(first)
      expect(db.prepare('SELECT * FROM archive_exports').all()).toHaveLength(1)
      expect(
        db.prepare("SELECT * FROM operation_logs WHERE module='archive' AND action='export'").all()
      ).toHaveLength(1)
    } finally {
      db.close()
    }
  })
  it('重新打开主库时自动补偿未提交产物，重复扫描无副作用', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.transition(lease, input.operationId, 'running')
    const output = prepareFileOperationArtifact(
      journal,
      lease,
      input.operationId,
      root,
      (staging) => {
        fs.writeFileSync(path.join(staging, 'data.json'), '{}')
      }
    )
    lease.release()
    const original = new Database(databasePath)
    runDatabaseMigrations(original)
    original.close()
    const reopened = new Database(databasePath)
    try {
      expect(recoverPendingFileOperations(reopened)).toEqual({
        busy: false,
        recovered: 1,
        manual: 0
      })
      expect(fs.existsSync(output)).toBe(false)
      expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
        state: 'failed',
        compensation: 'completed'
      })
      expect(recoverPendingFileOperations(reopened)).toEqual({
        busy: false,
        recovered: 0,
        manual: 0
      })
    } finally {
      reopened.close()
    }
  })
  it('产物发布与恢复校验内容摘要，拒绝清理被外部修改的产物', () => {
    const journal = open()
    const lease = lock(journal)
    const input = identity()
    journal.plan(lease, input)
    journal.transition(lease, input.operationId, 'running')
    const finalDirectory = prepareFileOperationArtifact(
      journal,
      lease,
      input.operationId,
      root,
      (staging) => {
        fs.writeFileSync(path.join(staging, 'data.json'), '{}')
      }
    )
    const record = journal.getRecoveryRecord(input.operationId)!
    expect(fileOperationArtifactRecovery.verify(record)).toBe(true)
    fs.writeFileSync(path.join(finalDirectory, 'unrelated.txt'), 'keep')
    expect(fileOperationArtifactRecovery.verify(record)).toBe(false)
    expect(() => fileOperationArtifactRecovery.compensate(record)).toThrow('禁止自动清理')
    expect(fs.readFileSync(path.join(finalDirectory, 'unrelated.txt'), 'utf8')).toBe('keep')
    fs.unlinkSync(path.join(finalDirectory, 'unrelated.txt'))
    // 模拟清理已删除一部分文件后进程终止。
    fs.unlinkSync(path.join(finalDirectory, 'data.json'))
    expect(fs.existsSync(path.join(path.dirname(finalDirectory), '.owner'))).toBe(true)
    const operationRoot = path.dirname(finalDirectory)
    const originalRmdir = fs.rmdirSync.bind(fs)
    const fault = vi.spyOn(fs, 'rmdirSync').mockImplementation((target) => {
      if (target === operationRoot)
        throw Object.assign(new Error('模拟收尾目录占用'), { code: 'EBUSY' })
      originalRmdir(target)
    })
    try {
      expect(() =>
        fileOperationArtifactRecovery.compensate(record, (plan) =>
          journal.saveRecoveryPlan(lease, input.operationId, plan)
        )
      ).toThrow('模拟收尾目录占用')
    } finally {
      fault.mockRestore()
    }
    expect(fs.readdirSync(operationRoot)).toEqual([])
    const interrupted = journal.getRecoveryRecord(input.operationId)!
    expect(interrupted.recoveryPlan.cleanupFinalizing).toBe(true)
    fileOperationArtifactRecovery.compensate(interrupted)
    fileOperationArtifactRecovery.compensate(interrupted)
    expect(fs.existsSync(finalDirectory)).toBe(false)
  })
  it('异步准备及提交在执行前拒绝，不生成操作记录或逃逸写入', async () => {
    const journal = open()
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const lifecycle = new FileOperationLifecycle(journal, db)
      let calls = 0
      const asynchronous = async (): Promise<number> => {
        calls += 1
        await Promise.resolve()
        calls += 1
        return 1
      }
      const handler = { verify: (): boolean => true, compensate: (): undefined => {} }
      // @ts-expect-error 同时验证类型层禁止 Promise 回调
      expect(() => lifecycle.execute(identity(), handler, asynchronous, () => 1)).toThrow(
        '异步回调'
      )
      // @ts-expect-error 提交回调同样禁止 Promise
      expect(() => lifecycle.execute(identity(), handler, () => {}, asynchronous)).toThrow(
        '异步回调'
      )
      await Promise.resolve()
      expect(calls).toBe(0)
      expect(journal.list()).toEqual([])
    } finally {
      db.close()
    }
  })
  it('恢复扫描尊重活跃租约，未注册类型只标记人工处理，重复扫描可收敛', () => {
    const journal = open()
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      const input = identity()
      const lease = lock(journal)
      journal.plan(lease, input)
      journal.transition(lease, input.operationId, 'running', { compensation: 'pending' })
      const lifecycle = new FileOperationLifecycle(journal, db)
      expect(lifecycle.recoverPending({})).toEqual({ busy: true, recovered: 0, manual: 0 })
      expect(journal.getRecoveryRecord(input.operationId)?.state).toBe('running')
      lease.release()
      expect(lifecycle.recoverPending({})).toEqual({ busy: false, recovered: 0, manual: 1 })
      expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
        state: 'recovery_required',
        errorCode: 'UNKNOWN_OPERATION_KIND'
      })
      let compensated = 0
      const handlers = {
        backup_create: {
          verify: (): boolean => false,
          compensate: (): undefined => {
            compensated += 1
          }
        }
      }
      expect(lifecycle.recoverPending(handlers)).toEqual({ busy: false, recovered: 1, manual: 0 })
      expect(lifecycle.recoverPending(handlers)).toEqual({ busy: false, recovered: 0, manual: 0 })
      expect(compensated).toBe(1)
      expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
        state: 'failed',
        compensation: 'completed'
      })
    } finally {
      db.close()
    }
  })
  it('协调层提交结果可幂等读取，数据库失败补偿文件后可重试', () => {
    const journal = open()
    const db = new Database(databasePath)
    try {
      runDatabaseMigrations(db)
      db.exec('CREATE TABLE lifecycle_test(id INTEGER PRIMARY KEY, value TEXT)')
      const lifecycle = new FileOperationLifecycle(journal, db)
      const input = identity()
      const target = path.join(root, 'owned.txt')
      let prepared = 0
      const handler = {
        verify: (): boolean =>
          fs.existsSync(target) && fs.readFileSync(target, 'utf8') === input.operationId,
        compensate: (): undefined => {
          if (fs.existsSync(target)) {
            if (fs.readFileSync(target, 'utf8') !== input.operationId)
              throw new Error('文件不属于本操作')
            fs.unlinkSync(target)
          }
        }
      }
      const prepare = (): void => {
        prepared += 1
        fs.writeFileSync(target, input.operationId, { flag: 'wx' })
      }
      expect(() =>
        lifecycle.execute(input, handler, prepare, () => {
          db.prepare('INSERT INTO lifecycle_test VALUES(1,?)').run('rolled back')
          throw Object.assign(new Error('模拟数据库失败'), { code: 'SQLITE_CONSTRAINT' })
        })
      ).toThrow('模拟数据库失败')
      expect(fs.existsSync(target)).toBe(false)
      expect(db.prepare('SELECT * FROM lifecycle_test').all()).toEqual([])
      expect(db.prepare('SELECT * FROM file_operation_commits').all()).toEqual([])
      expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
        state: 'failed',
        compensation: 'completed',
        errorCode: 'SQLITE_CONSTRAINT'
      })
      const commit = (): { id: number } => {
        db.prepare('INSERT INTO lifecycle_test VALUES(1,?)').run('committed')
        return { id: 1 }
      }
      expect(lifecycle.execute(input, handler, prepare, commit)).toEqual({ id: 1 })
      expect(lifecycle.execute(input, handler, prepare, commit)).toEqual({ id: 1 })
      expect(prepared).toBe(2)
      expect(db.prepare('SELECT * FROM lifecycle_test').all()).toHaveLength(1)
      expect(journal.getRecoveryRecord(input.operationId)).toMatchObject({
        state: 'succeeded',
        attempt: 2
      })
    } finally {
      db.close()
    }
  })
  it('主库提交标记只能与业务同事务写入，失败时不留下标记', () => {
    const db = new Database(':memory:')
    try {
      runDatabaseMigrations(db)
      const id = requireOperationId(undefined)
      const marker = {
        operationId: id,
        journalId: requireOperationId(undefined),
        requestHash: 'a'.repeat(64),
        resultDigest: 'b'.repeat(64)
      }
      expect(() => recordFileOperationCommit(db, marker)).toThrow('业务事务')
      expect(() =>
        db.transaction(() => {
          recordFileOperationCommit(db, marker)
          throw new Error('business failed')
        })()
      ).toThrow('business failed')
      expect(db.prepare('SELECT * FROM file_operation_commits').all()).toHaveLength(0)
      db.transaction(() => recordFileOperationCommit(db, marker))()
      expect(db.prepare('SELECT result_digest FROM file_operation_commits').get()).toEqual({
        result_digest: 'b'.repeat(64)
      })
    } finally {
      db.close()
    }
  })
  it('schema 3 通过独立第四步迁移，失败不提升版本或丢失业务', () => {
    const db = new Database(':memory:')
    try {
      createCurrentSchema(db, 3)
      db.pragma('user_version=3')
      db.exec("INSERT INTO users(id,username) VALUES(1,'keep')")
      expect(() =>
        runDatabaseMigrations(db, {
          checkpoint: (point) => {
            if (point === 'beforeCommit') throw new Error('commit failed')
          }
        })
      ).toThrow('commit failed')
      expect(db.pragma('user_version', { simple: true })).toBe(3)
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name='file_operation_commits'").all()
      ).toHaveLength(0)
      expect(runDatabaseMigrations(db).applied).toEqual([4, 5])
      expect(db.prepare('SELECT username FROM users').get()).toEqual({ username: 'keep' })
    } finally {
      db.close()
    }
  })
})

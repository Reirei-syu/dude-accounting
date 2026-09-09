import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { FileOperationJournal } from './fileOperationJournal'
import { listAuditableOperations } from './fileOperationAudit'
import { appendOperationLog, exportOperationLogsAsCsv } from './auditLog'
import { exportAuditLogsCommand, listAuditLogsCommand } from '../commands/auditLogCommands'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import type { CommandContext } from '../commands/types'
import type { AuditLogFilters, AuditLogRow } from '../../shared/contracts/auditLog'

describe('操作日志双库查询与公开契约', () => {
  let db: Database.Database
  let root: string
  beforeEach(() => {
    const base = path.resolve('.tmp/audit-log-tests')
    fs.mkdirSync(base, { recursive: true })
    root = fs.mkdtempSync(path.join(base, 'run-'))
    db = new Database(path.join(root, 'main.sqlite'))
    runDatabaseMigrations(db)
    db.exec("INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1),(2,'operator',0)")
  })
  afterEach(() => {
    db.close()
    vi.restoreAllMocks()
  })

  function context(userId = 1, source: 'ipc' | 'cli' = 'cli'): CommandContext {
    return {
      db,
      actor: resolveSessionActor(db, issueSession(db, userId), source),
      runtime: {} as CommandContext['runtime'],
      outputMode: 'json',
      now: new Date()
    }
  }
  function insert(count: number): void {
    const query = db.prepare(
      "INSERT INTO operation_logs(ledger_id,user_id,username,module,action,reason,approval_tag,details_json,created_at) VALUES(8,1,'admin','voucher','test','审批原因','APP-1',?, '2026-09-09T00:00:00.000Z')"
    )
    db.transaction(() => {
      for (let i = 0; i < count; i++)
        query.run(
          JSON.stringify({
            entryCount: i,
            password: 'SECRET_PASSWORD',
            before: { token: 'SECRET_TOKEN' },
            path: 'D:/SECRET_PATH'
          })
        )
    })()
  }
  function event(): string {
    const journal = new FileOperationJournal(db.name)
    const lease = journal.tryAcquire()!
    const operationId = randomUUID()
    journal.plan(lease, {
      operationId,
      kind: 'backup_create',
      actorId: 1,
      username: 'admin',
      ledgerId: 8,
      requestHash: 'a'.repeat(64)
    })
    journal.saveRecoveryPlan(lease, operationId, { path: 'D:/SECRET_RECOVERY' })
    journal.transition(lease, operationId, 'running')
    journal.transition(lease, operationId, 'failed', {
      errorCode: 'ENOSPC',
      compensation: 'completed'
    })
    const control = new Database(journal.databasePath)
    control.exec("UPDATE events SET created_at='2026-09-09T00:00:00.000Z'")
    control.close()
    lease.release()
    journal.close()
    return operationId
  }

  it('超过1000条混合日志用游标完整读取，同时间双源ID不重不漏；新增记录不挤动后续页', () => {
    insert(1101)
    event()
    const all: AuditLogRow[] = []
    let cursor: AuditLogFilters['cursor']
    const oldWholeTableRead = vi
      .spyOn(FileOperationJournal.prototype, 'listAuditEvents')
      .mockImplementation(() => {
        throw new Error('禁止全表读取')
      })
    for (;;) {
      const page = listAuditableOperations(db, { limit: 37, cursor })
      if (!page.length) break
      all.push(...page)
      const last = page[page.length - 1]
      cursor = { id: last.id, createdAt: last.created_at }
      if (all.length === 37) appendOperationLog(db, { module: 'new', action: 'insert' })
    }
    expect(all).toHaveLength(1104)
    expect(new Set(all.map((row) => row.id)).size).toBe(1104)
    expect(all.some((row) => row.module === 'new')).toBe(false)
    expect(all.slice(-6).map((row) => row.id)).toEqual([3, -3, 2, -2, 1, -1])
    expect(oldWholeTableRead).not.toHaveBeenCalled()
    expect(
      (db.pragma('database_list') as Array<{ name: string }>).some(
        (item) => item.name === 'audit_control'
      )
    ).toBe(false)
  })

  it('按时间排序后再限制，不因时钟回拨造成ID与时间逆序漏项', () => {
    insert(2)
    db.exec("UPDATE operation_logs SET created_at='2026-09-09T03:00:00.000Z' WHERE id=1")
    expect(listAuditableOperations(db, { limit: 1 })[0].id).toBe(1)
  })

  it('组合筛选状态/operationId/时间/人员/账套，关键词百分号和下划线按字面量匹配', () => {
    const operationId = event()
    const filters: AuditLogFilters = {
      ledgerId: 8,
      userId: 1,
      module: 'file_operation',
      action: 'backup_create',
      status: 'failed',
      operationId,
      startTime: '2026-09-09T08:00:00+08:00',
      endTime: '2026-09-09T00:00:00Z'
    }
    expect(listAuditableOperations(db, filters)).toHaveLength(1)
    expect(listAuditableOperations(db, { ...filters, userId: 2 })).toEqual([])
    expect(listAuditableOperations(db, { keyword: '%' })).toEqual([])
    expect(listAuditableOperations(db, { keyword: '_' })).toHaveLength(3)
    expect(listAuditableOperations(db, { keyword: 'SECRET_RECOVERY' })).toEqual([])
  })

  it('GUI/CLI同筛选一致，公开数据/导出脱敏但保留原因与审批；文件导出留痕', async () => {
    insert(2)
    event()
    db.exec("UPDATE operation_logs SET target_id='D:/SECRET_TARGET.xml' WHERE id=1")
    const filters = { ledgerId: 8, limit: 50 }
    const cli = await listAuditLogsCommand(context(1, 'cli'), filters)
    const ipc = await listAuditLogsCommand(context(1, 'ipc'), filters)
    expect(cli).toEqual(ipc)
    expect(cli.status).toBe('success')
    expect(JSON.stringify(cli)).not.toContain('SECRET')
    expect(JSON.stringify(cli)).toContain('APP-1')
    const filePath = path.join(root, 'logs.csv')
    const result = await exportAuditLogsCommand(context(), {
      filters,
      filePath,
      operationId: randomUUID()
    })
    expect(result.status).toBe('success')
    const csv = fs.readFileSync(filePath, 'utf8')
    expect(csv).not.toContain('SECRET')
    expect(csv).toContain('审批原因')
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM operation_logs WHERE module='audit_log' AND action='export'"
        )
        .get()
    ).toEqual({ n: 1 })
  })

  it('普通用户、旧管理员会话被撤权，列表及两种导出都拒绝且不落文件', async () => {
    const oldAdmin = context()
    const normal = context(2)
    db.exec('UPDATE users SET is_admin=0 WHERE id=1')
    for (const ctx of [normal, oldAdmin]) {
      expect((await listAuditLogsCommand(ctx)).status).toBe('error')
      expect((await exportAuditLogsCommand(ctx)).status).toBe('error')
      const target = path.join(root, 'denied.csv')
      expect(
        (await exportAuditLogsCommand(ctx, { filePath: target, operationId: randomUUID() })).status
      ).toBe('error')
      expect(fs.existsSync(target)).toBe(false)
    }
  })

  it('限量导出显式返回后续游标，调用方可连续取完而不误认为全部', async () => {
    insert(1001)
    const first = await exportAuditLogsCommand(context(), {
      filters: { module: 'voucher', limit: 1000 }
    })
    expect(first.status).toBe('success')
    expect(first.data).toMatchObject({ rowCount: 1000, hasMore: true })
    const next = await exportAuditLogsCommand(context(), {
      filters: { module: 'voucher', limit: 1000, cursor: first.data?.nextCursor }
    })
    expect(next.data).toMatchObject({ rowCount: 1, hasMore: false })
  })

  it.each(['Windows', 'WSL/Hermes'])('%s 显式导出路径落到相同隔离目录', async (source) => {
    insert(1)
    const target = path.join(root, `${source === 'Windows' ? 'windows' : 'wsl'}.csv`)
    const input =
      source === 'WSL/Hermes' && process.platform === 'win32'
        ? `/mnt/${target[0].toLowerCase()}${target.slice(2).replaceAll('\\', '/')}`
        : target
    const exported = await exportAuditLogsCommand(context(), {
      filePath: input,
      filters: { module: 'voucher' }
    })
    expect(exported.status).toBe('success')
    expect(exported.data?.filePath).toBe(target)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('拒绝依赖cwd的相对导出路径和Windows当前驱动器根相对路径', async () => {
    const inputs = ['audit.csv', ...(process.platform === 'win32' ? ['\\tmp\\audit.csv'] : [])]
    for (const filePath of inputs) {
      const result = await exportAuditLogsCommand(context(), { filePath })
      expect(result.error?.code).toBe('VALIDATION_ERROR')
    }
    expect(
      db.prepare("SELECT count(*) AS n FROM operation_logs WHERE module='audit_log'").get()
    ).toEqual({ n: 0 })
  })

  it.each([
    { limit: NaN },
    { limit: 1.5 },
    { limit: 1001 },
    { userId: -1 },
    { status: 'unknown' },
    { startTime: '2026-09-09' },
    { startTime: '2026-09-10T00:00:00Z', endTime: '2026-09-09T00:00:00Z' },
    { cursor: { id: 0, createdAt: '2026-09-09 00:00:00' } }
  ])('非法筛选在SQL前拒绝：%j', (filters) => {
    expect(() => listAuditableOperations(db, filters as AuditLogFilters)).toThrow('筛选条件无效')
  })

  it('新审计时间精确到毫秒；CSV用户文本不作为公式执行', () => {
    appendOperationLog(db, {
      module: 'audit',
      action: 'test',
      username: '=CMD()',
      reason: '+SUM(1,2)',
      approvalTag: '@test'
    })
    const rows = listAuditableOperations(db)
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    const csv = exportOperationLogsAsCsv(rows)
    expect(csv).toContain("'=CMD()")
    expect(csv).toContain("'+SUM(1,2)")
    expect(csv).toContain("'@test")
  })
})

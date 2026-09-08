import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { fileOperationDeletionRecovery } from '../services/fileOperationDeletion'
import { createBackupCommand, deleteBackupCommand } from './backupCommands'
import { exportArchiveCommand, deleteArchiveCommand } from './archiveCommands'
import { requireOperationId } from '../services/fileOperationJournal'
import { createBackupOperationFixture } from './testSupport/backupOperationFixture'
import { exportAuditLogsCommand } from './auditLogCommands'
import { recoverPendingFileOperations } from '../services/fileOperationStartup'

describe('删除文件操作生命周期', () => {
  it.each([false, true])('撤回CSV时保留并发新文件，恢复后清理中断：%s', async interrupted => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const filePath = path.join(root, 'race.csv')
      const replacement = path.join(root, 'replacement.csv')
      fs.writeFileSync(replacement, 'new-independent-content')
      context.db.exec("CREATE TRIGGER fail_export_log BEFORE INSERT ON operation_logs WHEN NEW.module='audit_log' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
      const rename = fs.renameSync
      let injected = false
      const fault = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
        if (source === filePath && !injected) { injected = true; rename(replacement, filePath) }
        return rename(source, target)
      })
      const unlink = fs.unlinkSync
      const cleanupFault = vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
        if (interrupted && injected && String(file).endsWith(`${path.sep}withdrawn`))
          throw Object.assign(new Error('interrupted'), { code: 'EBUSY' })
        return unlink(file)
      })
      try {
        expect((await exportAuditLogsCommand(context, { filePath })).status).toBe('error')
      } finally { fault.mockRestore(); cleanupFault.mockRestore() }
      expect(injected).toBe(true)
      expect(fs.readFileSync(filePath, 'utf8')).toBe('new-independent-content')
      recoverPendingFileOperations(context.db)
      expect(recoverPendingFileOperations(context.db).manual).toBe(0)
      expect(fs.readFileSync(filePath, 'utf8')).toBe('new-independent-content')
    } finally { fixture.cleanup() }
  })
  it('不同数据库同ID容器碰撞不能删除先前导出', async () => {
    const first = createBackupOperationFixture()
    const secondPath = path.join(first.root, 'second.sqlite')
    first.context.db.prepare('VACUUM INTO ?').run(secondPath)
    const second = new Database(secondPath)
    try {
      const operationId = requireOperationId(undefined)
      const filePath = path.join(first.root, 'shared.csv')
      expect((await exportAuditLogsCommand(first.context, { operationId, filePath })).status).toBe('success')
      const contents = fs.readFileSync(filePath)
      expect((await exportAuditLogsCommand({ ...first.context, db: second }, { operationId, filePath })).status).toBe('error')
      expect(fs.readFileSync(filePath)).toEqual(contents)
    } finally { second.close(); first.cleanup() }
  })
  it('审计导出日志失败撤回文件，同ID重试不覆盖其他文件', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const operationId = requireOperationId(undefined)
      const filePath = path.join(root, 'audit.csv')
      const run = (): ReturnType<typeof exportAuditLogsCommand> => exportAuditLogsCommand(context, { operationId, filePath })
      context.db.exec("CREATE TRIGGER fail_export_log BEFORE INSERT ON operation_logs WHEN NEW.module='audit_log' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
      expect((await run()).status).toBe('error')
      expect(fs.existsSync(filePath)).toBe(false)
      context.db.exec('DROP TRIGGER fail_export_log')
      fs.writeFileSync(filePath, 'independent')
      expect((await run()).status).toBe('error')
      expect(fs.readFileSync(filePath, 'utf8')).toBe('independent')
      fs.unlinkSync(filePath)
      const result = await run()
      expect(result.status).toBe('success')
      expect(await run()).toEqual(result)
      expect(context.db.prepare("SELECT id FROM operation_logs WHERE module='audit_log'").all()).toHaveLength(1)
    } finally { fixture.cleanup() }
  })
  it.each(['backup', 'archive'] as const)('%s 日志失败恢复旧包，同ID重试只删除一次', async kind => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const create = async (): Promise<{ id: number; directory: string }> => {
        if (kind === 'backup') {
          const result = await createBackupCommand(context, { ledgerId: 7, directoryPath: root })
          expect(result.status, JSON.stringify(result.error)).toBe('success')
          return { id: result.data!.backupId, directory: path.dirname(result.data!.manifestPath) }
        }
        const result = await exportArchiveCommand(context, { ledgerId: 7, fiscalYear: '2026', directoryPath: root })
        expect(result.status, JSON.stringify(result.error)).toBe('success')
        return { id: result.data!.exportId, directory: result.data!.exportPath }
      }
      const first = await create()
      const latest = await create()
      const operationId = requireOperationId(undefined)
      const remove = (): ReturnType<typeof deleteBackupCommand> => kind === 'backup'
        ? deleteBackupCommand(context, { backupId: first.id, operationId })
        : deleteArchiveCommand(context, { exportId: first.id, operationId })
      context.db.exec("CREATE TRIGGER fail_delete_log BEFORE INSERT ON operation_logs WHEN NEW.action='delete' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
      const failed = await remove()
      expect(failed.status).toBe('error')
      expect(failed.error?.details).toMatchObject({ operationId, state: 'failed', compensation: 'completed' })
      expect(fs.existsSync(first.directory)).toBe(true)
      const table = kind === 'backup' ? 'backup_packages' : 'archive_exports'
      expect(context.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(first.id)).toBeTruthy()
      context.db.exec('DROP TRIGGER fail_delete_log')
      const complete = fileOperationDeletionRecovery.complete!
      let cleanupFailures = 0
      const fault = vi.spyOn(fileOperationDeletionRecovery, 'complete').mockImplementation((record, savePlan) => {
        if (cleanupFailures++ === 0) throw Object.assign(new Error('模拟一次性清理占用'), { code: 'EBUSY' })
        return complete(record, savePlan)
      })
      const success = await remove().finally(() => fault.mockRestore())
      expect(success.status, JSON.stringify(success.error)).toBe('success')
      expect(await remove()).toEqual(success)
      expect(fs.existsSync(first.directory)).toBe(false)
      expect(fs.existsSync(latest.directory)).toBe(true)
      expect(context.db.prepare(`SELECT id FROM ${table}`).all()).toEqual([{ id: latest.id }])
      expect(context.db.prepare("SELECT id FROM operation_logs WHERE module=? AND action='delete'").all(kind)).toHaveLength(1)
    } finally { fixture.cleanup() }
  })
})

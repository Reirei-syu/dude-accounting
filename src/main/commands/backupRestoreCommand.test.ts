import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { restoreBackupCommand, createBackupCommand } from './backupCommands'
import { createBackupOperationFixture } from './testSupport/backupOperationFixture'
import { runDatabaseMigrations } from '../database/migrations'
import { createBackupPackageRecord } from '../services/backupCatalog'
import { computeFileSha256 } from '../services/fileIntegrity'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { consumeEmbeddedCliState } from '../runtime/embeddedCliState'

function legacyPackage(fixture: ReturnType<typeof createBackupOperationFixture>): { packagePath: string; backupPath: string; backupId: number } {
  const packagePath = path.join(fixture.root, 'system-backup')
  fs.mkdirSync(packagePath)
  const backupPath = path.join(packagePath, 'data.db')
  const source = new Database(backupPath)
  runDatabaseMigrations(source)
  source.close()
  const manifestPath = path.join(packagePath, 'manifest.json')
  const checksum = computeFileSha256(backupPath)
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: '1.0', packageType: 'system_backup',
    databaseFile: 'data.db', checksum, fileSize: fs.statSync(backupPath).size }))
  const backupId = createBackupPackageRecord(fixture.context.db, { ledgerId: 7, backupPeriod: null,
    fiscalYear: null, packageType: 'system_db_snapshot_legacy', packageSchemaVersion: '1.0',
    backupPath, manifestPath, checksum, fileSize: fs.statSync(backupPath).size,
    createdBy: fixture.context.actor!.id, createdAt: '2026-04-11 18:00:00' })
  return { packagePath, backupPath, backupId }
}

describe('restoreBackupCommand', () => {
  it('候选库审计提交后请求重启，不依赖 pending 成功日志', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const pkg = legacyPackage(fixture)
      const operationId = requireOperationId(undefined)
      const result = await restoreBackupCommand(fixture.context, { backupId: pkg.backupId, operationId })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(result.data).toMatchObject({ restartRequired: true, backupPath: pkg.backupPath })
      expect(fixture.context.db.prepare("SELECT target_id FROM operation_logs WHERE action='restore'").all()).toEqual([{ target_id: operationId }])
      expect(fs.existsSync(path.join(fixture.root, 'pending-restore-log.json'))).toBe(false)
      expect(consumeEmbeddedCliState().relaunchRequested).toBe(true)
    } finally { fixture.cleanup() }
  })
  it('拒绝账套包按整库恢复并提供导入指引', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const created = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath: fixture.root })
      const result = await restoreBackupCommand(fixture.context, { backupId: created.data!.backupId })
      expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { backupId: created.data!.backupId, packageType: 'ledger_backup' } })
      expect(result.error?.message).toContain('backup import')
      expect(consumeEmbeddedCliState().relaunchRequested).toBe(false)
    } finally { fixture.cleanup() }
  })
  it('候选发布失败恢复原库并留下失败记录，不重启', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const pkg = legacyPackage(fixture)
      const operationId = requireOperationId(undefined)
      const target = fixture.context.db.name
      const rename = fs.renameSync.bind(fs)
      let injected = false
      const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (!injected && to === target) { injected = true; throw Object.assign(new Error('模拟发布失败'), { code: 'EACCES' }) }
        rename(from, to)
      })
      try {
        const result = await restoreBackupCommand(fixture.context, { backupId: pkg.backupId, operationId })
        expect(result.status).toBe('error')
        expect(injected).toBe(true)
      } finally { fault.mockRestore() }
      expect(fixture.context.db.open).toBe(true)
      expect(fixture.context.db.prepare('SELECT id FROM ledgers WHERE id=7').get()).toEqual({ id: 7 })
      const journal = new FileOperationJournal(target)
      try { expect(journal.getRecoveryRecord(operationId)).toMatchObject({ state: 'failed', compensation: 'completed' }) }
      finally { journal.close() }
      expect(consumeEmbeddedCliState().relaunchRequested).toBe(false)
    } finally { fixture.cleanup() }
  })
  it('显式目录恢复后仍保留所选目录偏好', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const pkg = legacyPackage(fixture)
      const result = await restoreBackupCommand(fixture.context, { packagePath: pkg.packagePath })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(fixture.context.db.prepare("SELECT value FROM system_settings WHERE key='backup_restore_last_dir'").get()).toEqual({ value: fixture.root })
    } finally { fixture.cleanup() }
  })
  it('父目录解析到账套包时仍拒绝整库恢复', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const created = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath: fixture.root })
      const packagePath = path.dirname(path.dirname(created.data!.manifestPath))
      const result = await restoreBackupCommand(fixture.context, { packagePath })
      expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { packagePath, packageType: 'ledger_backup' } })
      expect(result.error?.message).toContain('backup import')
    } finally { fixture.cleanup() }
  })
})

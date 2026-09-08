import path from 'node:path'
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { createBackupCommand, importBackupCommand } from './backupCommands'
import { createBackupOperationFixture } from './testSupport/backupOperationFixture'

describe('importBackupCommand', () => {
  it('规划后源清单变化拒绝导入，恢复原清单后同ID可重试', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const created = await createBackupCommand(context, { ledgerId: 7, directoryPath: root })
      expect(created.status).toBe('success')
      const manifestPath = created.data!.manifestPath
      const original = fs.readFileSync(manifestPath, 'utf8')
      const operationId = requireOperationId(undefined)
      const originalPlan = FileOperationJournal.prototype.plan
      const fault = vi.spyOn(FileOperationJournal.prototype, 'plan').mockImplementation(function (this: FileOperationJournal, lease, identity) {
        const result = originalPlan.call(this, lease, identity)
        if (identity.operationId === operationId) fs.writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(original), ledgerName: '另一合法清单' }))
        return result
      })
      try {
        const result = await importBackupCommand(context, { backupId: created.data!.backupId, operationId })
        expect(result.status).toBe('error')
        expect(result.error?.code).toBe('FILE_OPERATION_FAILED')
        expect(result.error?.details).toMatchObject({ operationId, state: 'failed' })
        expect(context.db.prepare('SELECT id FROM ledgers').all()).toHaveLength(1)
      } finally { fault.mockRestore(); fs.writeFileSync(manifestPath, original) }
      expect((await importBackupCommand(context, { backupId: created.data!.backupId, operationId })).status).toBe('success')
      expect(context.db.prepare('SELECT id FROM ledgers').all()).toHaveLength(2)
    } finally { fixture.cleanup() }
  })
  it('remembers import directories when importing from a parent directory path', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const created = await createBackupCommand(context, { ledgerId: 7, directoryPath: root })
      expect(created.status).toBe('success')
      const container = path.dirname(path.dirname(created.data!.manifestPath))
      const result = await importBackupCommand(context, { packagePath: container })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(context.db.prepare("SELECT value FROM system_settings WHERE key='backup_import_last_dir'").get()).toEqual({ value: path.dirname(container) })
      expect(context.db.prepare('SELECT id FROM ledgers WHERE id=?').get(result.data!.importedLedgerId)).toBeTruthy()
      expect(context.db.prepare("SELECT id FROM operation_logs WHERE action='import' AND module='backup'").all()).toHaveLength(1)
    } finally { fixture.cleanup() }
  })
})

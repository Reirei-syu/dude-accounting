import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createBackupCommand } from './backupCommands'
import { createBackupOperationFixture } from './testSupport/backupOperationFixture'

describe('createBackupCommand', () => {
  it('creates backup records with schema version 2.1 and null period metadata', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const result = await createBackupCommand(context, { ledgerId: 7, period: '2026-03', directoryPath: root })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(result.data).toMatchObject({ directoryPath: root, period: null })
      const row = context.db.prepare('SELECT * FROM backup_packages WHERE id=?').get(result.data!.backupId)
      expect(row).toMatchObject({ ledger_id: 7, backup_period: null, fiscal_year: null, package_type: 'ledger_backup', package_schema_version: '2.1' })
      const manifest = JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8'))
      expect(manifest).toMatchObject({ schemaVersion: '2.1', ledgerId: 7, period: null, fiscalYear: null })
      expect(context.db.prepare("SELECT value FROM system_settings WHERE key='backup_create_last_dir'").get()).toEqual({ value: root })
    } finally { fixture.cleanup() }
  })
})

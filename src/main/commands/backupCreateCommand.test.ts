import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createBackupCommand, importBackupCommand } from './backupCommands'
import { createBackupOperationFixture } from './testSupport/backupOperationFixture'
import { validateLedgerBackupArtifact } from '../services/backupRecovery'
import { getDatabase } from '../database/init'
import { parseCliArgs } from '../../cli/parse'
import { resolveCliPayload } from '../../cli/payload'

describe('createBackupCommand', () => {
  it('CLI 数字字符串账套 ID 生成数值清单，可校验并与数字载荷幂等重试', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const operationId = '98765432-1234-4234-8234-123456789abc'
      const directoryPath = path.join(fixture.root, 'flags-backup')
      const parsed = parseCliArgs(['backup', 'create', '--ledgerId', '7', '--directoryPath', directoryPath, '--operationId', operationId])
      const result = await createBackupCommand(fixture.context, resolveCliPayload({ flags: parsed.flags }) as Parameters<typeof createBackupCommand>[1])
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8')).ledgerId).toBe(7)
      expect(validateLedgerBackupArtifact(result.data!.backupPath, result.data!.manifestPath).valid).toBe(true)
      const retried = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath, operationId })
      expect(retried.status, JSON.stringify(retried.error)).toBe('success')
      expect(retried.data!.backupId).toBe(result.data!.backupId)
    } finally { fixture.cleanup() }
  })
  it('兼容旧数字字符串清单且不修改原包，仍拒绝错账套或非法 ID', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const result = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath: fixture.root })
      const manifest = JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8'))
      const legacyText = JSON.stringify({ ...manifest, ledgerId: '7' })
      fs.writeFileSync(result.data!.manifestPath, legacyText)
      const validation = validateLedgerBackupArtifact(result.data!.backupPath, result.data!.manifestPath)
      expect(validation.valid, validation.error).toBe(true)
      expect(validation.manifest!.ledgerId).toBe('7')
      expect(fs.readFileSync(result.data!.manifestPath, 'utf8')).toBe(legacyText)
      for (const ledgerId of ['8', '0', '7.1', true, null, '9007199254740993']) {
        fs.writeFileSync(result.data!.manifestPath, JSON.stringify({ ...manifest, ledgerId }))
        expect(validateLedgerBackupArtifact(result.data!.backupPath, result.data!.manifestPath).valid).toBe(false)
      }
      fs.writeFileSync(result.data!.manifestPath, legacyText)
      const imported = await importBackupCommand(fixture.context, { backupId: result.data!.backupId })
      expect(imported.status, JSON.stringify(imported.error)).toBe('success')
      expect(fixture.context.db.prepare('SELECT id FROM ledgers WHERE id=?').get(imported.data!.importedLedgerId)).toBeTruthy()
    } finally { fixture.cleanup() }
  })
  it.each(['0', 0, -1, '1.2', true, null, '9007199254740993'])('非法账套 ID %s 在产物创建前拒绝', async (ledgerId) => {
    const fixture = createBackupOperationFixture()
    try {
      const directoryPath = path.join(fixture.root, 'invalid-backup')
      const result = await createBackupCommand(fixture.context, { ledgerId: ledgerId as number, directoryPath })
      expect(result.status).toBe('error')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
      expect(fs.existsSync(directoryPath)).toBe(false)
      expect(fixture.context.db.prepare('SELECT * FROM backup_packages').all()).toEqual([])
    } finally { fixture.cleanup() }
  })
  it('同名不同原件在备份副本内唯一命名，主库不变且导入后内容完整', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const originals = ['receipt.pdf', 'RECEIPT.PDF', 'file-2-0.PDF'].map((name, index) => {
        const folder = path.join(fixture.root, `source-${index}`)
        fs.mkdirSync(folder)
        const storedPath = path.join(folder, name)
        const bytes = Buffer.from(`%PDF-1.4\n%fixture-${index}\n%%EOF\n`)
        fs.writeFileSync(storedPath, bytes)
        const hash = createHash('sha256').update(bytes).digest('hex')
        fixture.context.db
          .prepare(
            'INSERT INTO electronic_voucher_files(id,ledger_id,original_name,stored_name,stored_path,sha256,file_size) VALUES(?,7,?,?,?,?,?)'
          )
          .run(index + 1, name, name, storedPath, hash, bytes.length)
        return { name, hash, storedPath }
      })
      const result = await createBackupCommand(fixture.context, {
        ledgerId: 7,
        directoryPath: path.join(fixture.root, 'backups')
      })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      const manifest = JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8'))
      expect(
        new Set(
          manifest.attachments.map((item: { storedName: string }) => item.storedName.toLowerCase())
        ).size
      ).toBe(3)
      expect(
        manifest.attachments.map((item: { originalName: string }) => item.originalName)
      ).toEqual(originals.map((item) => item.name))
      expect(
        validateLedgerBackupArtifact(result.data!.backupPath, result.data!.manifestPath).valid
      ).toBe(true)
      expect(
        fixture.context.db
          .prepare('SELECT stored_name,stored_path FROM electronic_voucher_files ORDER BY id')
          .all()
      ).toEqual(originals.map((item) => ({ stored_name: item.name, stored_path: item.storedPath })))
      const imported = await importBackupCommand(fixture.context, {
        backupId: result.data!.backupId
      })
      expect(imported.status, JSON.stringify(imported.error)).toBe('success')
      const db = getDatabase()
      const files = db
        .prepare(
          'SELECT original_name,stored_path,sha256 FROM electronic_voucher_files WHERE ledger_id=? ORDER BY id'
        )
        .all(imported.data!.importedLedgerId) as Array<{
        original_name: string
        stored_path: string
        sha256: string
      }>
      expect(files.map((item) => item.original_name)).toEqual(originals.map((item) => item.name))
      expect(
        files.map((item) =>
          createHash('sha256').update(fs.readFileSync(item.stored_path)).digest('hex')
        )
      ).toEqual(originals.map((item) => item.hash))
    } finally {
      fixture.cleanup()
    }
  })
  it.runIf(process.platform === 'win32')(
    'Windows 多级备份包数据库路径超过260字符仍能创建和校验',
    async () => {
      const fixture = createBackupOperationFixture()
      try {
        const directoryPath = path.join(
          fixture.root,
          'long-output-'.repeat(5),
          'backups-'.repeat(5)
        )
        const result = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath })
        expect(result.status, JSON.stringify(result.error)).toBe('success')
        expect(result.data!.backupPath.length).toBeGreaterThan(260)
        expect(fs.existsSync(result.data!.backupPath)).toBe(true)
        const validation = validateLedgerBackupArtifact(
          result.data!.backupPath,
          result.data!.manifestPath
        )
        expect(validation.valid, validation.error ?? '').toBe(true)
      } finally {
        fixture.cleanup()
      }
    }
  )
  it('新建父目录后审计失败仅补偿操作容器，父目录保留', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const directoryPath = path.join(fixture.root, 'new-output', 'failed-backups')
      fixture.context.db.exec(
        "CREATE TRIGGER fail_backup_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'injected audit failure'); END"
      )
      const result = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath })
      expect(result.status).toBe('error')
      expect(result.error?.details).toMatchObject({ state: 'failed', compensation: 'completed' })
      expect(fs.statSync(directoryPath).isDirectory()).toBe(true)
      expect(fs.readdirSync(directoryPath)).toEqual([])
      expect(fixture.context.db.prepare('SELECT * FROM backup_packages').all()).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
  it('支持不存在的多级输出目录并保留完整备份清单', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const directoryPath = path.join(fixture.root, 'new-output', 'backups')
      expect(fs.existsSync(directoryPath)).toBe(false)
      const result = await createBackupCommand(fixture.context, { ledgerId: 7, directoryPath })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(fs.existsSync(result.data!.backupPath)).toBe(true)
      expect(JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8')).ledgerId).toBe(7)
    } finally {
      fixture.cleanup()
    }
  })
  it('creates backup records with schema version 2.1 and null period metadata', async () => {
    const fixture = createBackupOperationFixture()
    try {
      const { context, root } = fixture
      const result = await createBackupCommand(context, {
        ledgerId: 7,
        period: '2026-03',
        directoryPath: root
      })
      expect(result.status, JSON.stringify(result.error)).toBe('success')
      expect(result.data).toMatchObject({ directoryPath: root, period: null })
      const row = context.db
        .prepare('SELECT * FROM backup_packages WHERE id=?')
        .get(result.data!.backupId)
      expect(row).toMatchObject({
        ledger_id: 7,
        backup_period: null,
        fiscal_year: null,
        package_type: 'ledger_backup',
        package_schema_version: '2.1'
      })
      const manifest = JSON.parse(fs.readFileSync(result.data!.manifestPath, 'utf8'))
      expect(manifest).toMatchObject({
        schemaVersion: '2.1',
        ledgerId: 7,
        period: null,
        fiscalYear: null
      })
      expect(
        context.db
          .prepare("SELECT value FROM system_settings WHERE key='backup_create_last_dir'")
          .get()
      ).toEqual({ value: root })
    } finally {
      fixture.cleanup()
    }
  })
})

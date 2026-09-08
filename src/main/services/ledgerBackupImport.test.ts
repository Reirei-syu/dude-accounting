import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { runDatabaseMigrations } from '../database/migrations'
import { computeFileSha256 } from './fileIntegrity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLedgerBackupArtifact, importLedgerBackupArtifact } from './backupRecovery'

function createLedgerSchema(db: Database.Database): void {
  runDatabaseMigrations(db)
}

describe('ledger backup import', () => {
  let tempDir = ''

  afterEach(() => {
    vi.restoreAllMocks()
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it.each([
    'success',
    'success-legacy',
    'success-legacy-no-assets',
    'success-legacy-schema',
    'attachment-copy',
    'wallpaper-copy',
    'database-commit',
    'asset-switch',
    'source-race'
  ])('导入与故障补偿：%s', (failure) => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-import-'))
    const sourcePath = path.join(tempDir, 'source.db')
    const backupDir = path.join(tempDir, 'backups')
    const targetUserDataPath = path.join(tempDir, 'target-user-data')
    const attachmentRootDir = path.join(targetUserDataPath, 'electronic-vouchers')
    fs.mkdirSync(targetUserDataPath, { recursive: true })
    const targetPath = path.join(targetUserDataPath, 'target.db')
    const sourceWallpaperDir = path.join(tempDir, 'wallpapers', 'user-2')
    const sourceWallpaperPath = path.join(sourceWallpaperDir, 'current.webp')
    fs.mkdirSync(sourceWallpaperDir, { recursive: true })
    fs.writeFileSync(sourceWallpaperPath, 'source-wallpaper', 'utf8')

    const sourceDb = new Database(sourcePath)
    createLedgerSchema(sourceDb)
    const sourceVoucherPath = path.join(tempDir, 'source-voucher.ofd')
    fs.writeFileSync(sourceVoucherPath, 'source-voucher', 'utf8')
    sourceDb.exec(`
      INSERT INTO users (id, username, real_name, password_hash, permissions, is_admin, created_at)
      VALUES
        (1, 'admin', '管理员', '', '{}', 1, '2026-04-02 09:00:00'),
        (2, 'maker', '制单员', '', '{}', 0, '2026-04-02 09:00:00');
      INSERT INTO ledgers (id, name, standard_type, taxpayer_identification_number, start_period, current_period, created_at)
      VALUES (8, '华北客户', 'enterprise', '91310000IMPORT001', '2026-01', '2026-03', '2026-04-02 09:00:00');
      INSERT INTO periods (ledger_id, period, is_closed, closed_at) VALUES (8, '2026-03', 1, '2026-03-31 23:59:59');
      INSERT INTO subjects (id, ledger_id, code, name, category, balance_direction) VALUES
        (81, 8, '1001', '库存现金', 'asset', 'debit');
      INSERT INTO cash_flow_items (id, ledger_id, code, name, category, direction, is_system) VALUES
        (801, 8, 'CF01', '销售商品收到的现金', 'operating', 'inflow', 1);
      INSERT INTO vouchers (
        id, ledger_id, period, voucher_date, voucher_number, voucher_word, creator_id, auditor_id, bookkeeper_id
      ) VALUES (801, 8, '2026-03', '2026-03-01', 1, '记', 1, 2, 1);
      INSERT INTO voucher_entries (
        id, voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id
      ) VALUES (9001, 801, 1, '导入分录', '1001', 100, 0, 801);
      INSERT INTO electronic_voucher_files (
        id, ledger_id, original_name, stored_name, stored_path, file_ext, sha256, file_size, imported_by, imported_at
      ) VALUES (810, 8, 'source-voucher.ofd', 'source-voucher.ofd', '${sourceVoucherPath.replace(/\\/g, '/')}', '.ofd', 'hash-1', 13, 2, '2026-03-01 09:00:00');
      INSERT INTO electronic_voucher_records (
        id, ledger_id, file_id, voucher_type, source_number, source_date, fingerprint, status
      ) VALUES (811, 8, 810, 'digital_invoice', 'INV-1', '2026-03-01', 'fp-1', 'verified');
      INSERT INTO electronic_voucher_verifications (record_id, verification_status) VALUES (811, 'verified');
      INSERT INTO voucher_source_links (voucher_id, source_type, source_record_id) VALUES (801, 'electronic_voucher', 811);
      INSERT INTO operation_logs (ledger_id, user_id, username, module, action, target_type, target_id, reason, approval_tag, details_json, created_at)
      VALUES (8, 2, 'maker', 'voucher', 'create', 'voucher', '801', '紧急逆转补录', 'APR-2026-03', '{}', '2026-03-01 09:30:00');
      INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES
        (2, 'default_home_tab', 'report-query', '2026-04-02 09:05:00'),
        (2, 'custom_wallpaper_relative_path', 'wallpapers/user-2/current.webp', '2026-04-02 09:06:00');
      INSERT INTO system_settings (key, value) VALUES
        ('backup_last_dir', 'D:/snapshot-backups'),
        ('last_login_user_id', '2');
      INSERT INTO user_ledger_permissions (user_id, ledger_id) VALUES (2, 8);
    `)
    sourceDb.exec(
      "UPDATE vouchers SET posted_at='2026-03-02 09:00:00', emergency_reversal_reason='批准修正', emergency_reversal_by=2, emergency_reversal_at='2026-03-03 09:00:00', reversal_approval_tag='APR-001'"
    )
    sourceDb.close()

    const artifact = createLedgerBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '华北客户',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 3, 2, 10, 0, 0)
    })

    const targetDb = new Database(targetPath)
    createLedgerSchema(targetDb)
    targetDb.exec(`
      INSERT INTO users (id, username, real_name, password_hash, permissions, is_admin, created_at)
      VALUES
        (1, 'admin', '管理员', '', '{}', 1, '2026-04-02 08:00:00'),
        (2, 'maker', '旧制单员', 'old-hash', '{}', 0, '2026-04-02 08:05:00');
      INSERT INTO ledgers (id, name, standard_type, start_period, current_period, created_at)
      VALUES (1, '华北客户', 'enterprise', '2026-01', '2026-03', '2026-04-02 08:00:00');
      INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES
        (2, 'default_home_tab', 'voucher-entry', '2026-04-02 08:10:00');
      INSERT INTO system_settings (key, value) VALUES ('backup_last_dir', 'D:/old-backups');
    `)
    targetDb.close()

    const originalDatabase = fs.readFileSync(targetPath)
    if (failure.startsWith('success-legacy')) {
      const manifest = JSON.parse(fs.readFileSync(artifact.manifestPath, 'utf8'))
      manifest.schemaVersion = '2.0'
      if (failure === 'success-legacy-no-assets') {
        delete manifest.settingsAssets
        fs.rmSync(path.join(artifact.packageDir, 'settings-assets'), { recursive: true })
      }
      if (failure === 'success-legacy-schema') {
        const legacy = new Database(artifact.backupPath)
        legacy.exec(
          "DROP TABLE initial_balances; CREATE TABLE initial_balances(id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0); INSERT INTO initial_balances(ledger_id,subject_code,debit_amount) VALUES(8,'1001',12345); PRAGMA user_version=0"
        )
        legacy.close()
        manifest.checksum = computeFileSha256(artifact.backupPath)
        manifest.fileSize = fs.statSync(artifact.backupPath).size
      }
      fs.writeFileSync(artifact.manifestPath, JSON.stringify(manifest))
    }
    const oldWallpaper = path.join(targetUserDataPath, 'wallpapers', 'user-2', 'current.webp')
    fs.mkdirSync(path.dirname(oldWallpaper), { recursive: true })
    fs.writeFileSync(oldWallpaper, 'original-wallpaper')
    if (failure === 'source-race') {
      const copy = fs.copyFileSync
      vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, flags) => {
        if (
          String(destination).includes('.import-staging-') &&
          String(destination).endsWith('.ofd')
        ) {
          fs.writeFileSync(source, 'changed-after-validation')
        }
        return copy(source, destination, flags)
      })
    }
    if (failure === 'attachment-copy' || failure === 'wallpaper-copy') {
      const copy = fs.copyFileSync
      vi.spyOn(fs, 'copyFileSync').mockImplementation((source, destination, flags) => {
        if (
          String(destination).includes('.import-staging-') &&
          String(destination).endsWith(failure === 'attachment-copy' ? '.ofd' : '.webp')
        ) {
          throw new Error(`故障注入：${failure}`)
        }
        return copy(source, destination, flags)
      })
    }
    if (failure === 'database-commit') {
      const exec = Database.prototype.exec
      vi.spyOn(Database.prototype, 'exec').mockImplementation(function (
        this: Database.Database,
        sql: string
      ) {
        if (sql === 'COMMIT;') throw new Error(`故障注入：${failure}`)
        return exec.call(this, sql)
      })
    }
    if (failure === 'asset-switch') {
      const rename = fs.renameSync
      vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
        if (String(destination).includes(`${path.sep}import-assets${path.sep}`))
          throw new Error(`故障注入：${failure}`)
        return rename(source, destination)
      })
    }
    const performImport = (): ReturnType<typeof importLedgerBackupArtifact> =>
      importLedgerBackupArtifact({
        backupPath: artifact.backupPath,
        manifestPath: artifact.manifestPath,
        targetPath,
        attachmentRootDir,
        operatorUserId: 1,
        operatorIsAdmin: false,
        appendImportLog: (db, result) => {
          expect(db.inTransaction).toBe(true)
          db.prepare(
            'INSERT INTO operation_logs(ledger_id, user_id, username, module, action, details_json) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            result.importedLedgerId,
            1,
            'admin',
            'backup',
            'import',
            JSON.stringify({ importedLedgerName: result.importedLedgerName })
          )
        }
      })
    const packageBytesBeforeImport = fs.readFileSync(artifact.backupPath)
    if (!failure.startsWith('success')) {
      expect(performImport).toThrow(
        failure === 'source-race' ? '源包发生变化' : `故障注入：${failure}`
      )
      expect(fs.readFileSync(targetPath)).toEqual(originalDatabase)
      expect(fs.readFileSync(oldWallpaper, 'utf8')).toBe('original-wallpaper')
      expect(
        fs.readdirSync(targetUserDataPath).some((entry) => entry.includes('.import-staging-'))
      ).toBe(false)
      expect(fs.existsSync(`${targetPath}.recovery`)).toBe(false)
      const assetsRoot = path.join(targetUserDataPath, 'import-assets')
      expect(fs.existsSync(assetsRoot) ? fs.readdirSync(assetsRoot) : []).toEqual([])
      return
    }
    const result = performImport()
    expect(fs.readFileSync(artifact.backupPath)).toEqual(packageBytesBeforeImport)
    expect(fs.readFileSync(oldWallpaper, 'utf8')).toBe('original-wallpaper')

    const importedDb = new Database(targetPath, { readonly: true })
    if (failure === 'success-legacy-schema')
      expect(
        importedDb
          .prepare('SELECT period, debit_amount FROM initial_balances WHERE ledger_id = ?')
          .get(result.importedLedgerId)
      ).toEqual({ period: '2026-01', debit_amount: 12345 })
    expect(
      importedDb
        .prepare(
          'SELECT posted_at, emergency_reversal_reason, emergency_reversal_by, emergency_reversal_at, reversal_approval_tag FROM vouchers WHERE ledger_id = ?'
        )
        .get(result.importedLedgerId)
    ).toEqual({
      posted_at: '2026-03-02 09:00:00',
      emergency_reversal_reason: '批准修正',
      emergency_reversal_by: 2,
      emergency_reversal_at: '2026-03-03 09:00:00',
      reversal_approval_tag: 'APR-001'
    })
    expect(
      importedDb
        .prepare(
          "SELECT COUNT(*) AS count FROM operation_logs WHERE ledger_id = ? AND module = 'backup' AND action = 'import'"
        )
        .get(result.importedLedgerId)
    ).toEqual({ count: 1 })
    expect(result.importedLedgerName).toBe('华北客户（导入）')
    expect(
      importedDb.prepare('SELECT COUNT(1) AS count FROM ledgers').get() as { count: number }
    ).toEqual({ count: 2 })
    expect(
      importedDb
        .prepare('SELECT id, name, taxpayer_identification_number FROM ledgers WHERE id = ?')
        .get(result.importedLedgerId) as {
        id: number
        name: string
        taxpayer_identification_number: string
      }
    ).toEqual({
      id: result.importedLedgerId,
      name: '华北客户（导入）',
      taxpayer_identification_number: '91310000IMPORT001'
    })
    expect(
      importedDb
        .prepare('SELECT COUNT(1) AS count FROM vouchers WHERE ledger_id = ?')
        .get(result.importedLedgerId) as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare('SELECT period, is_closed, closed_at FROM periods WHERE ledger_id = ?')
        .get(result.importedLedgerId) as {
        period: string
        is_closed: number
        closed_at: string | null
      }
    ).toEqual({
      period: '2026-03',
      is_closed: 1,
      closed_at: '2026-03-31 23:59:59'
    })
    expect(
      importedDb.prepare('SELECT COUNT(1) AS count FROM users WHERE username = ?').get('admin') as {
        count: number
      }
    ).toEqual({ count: 1 })
    expect(
      importedDb.prepare('SELECT COUNT(1) AS count FROM users WHERE username = ?').get('maker') as {
        count: number
      }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare(
          'SELECT COUNT(1) AS count FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?'
        )
        .get(1, result.importedLedgerId) as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare(
          'SELECT COUNT(1) AS count FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?'
        )
        .get(2, result.importedLedgerId) as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
        .get(2, 'default_home_tab') as { value: string }
    ).toEqual({ value: 'report-query' })
    const wallpaperPreference = importedDb
      .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
      .get(2, 'custom_wallpaper_relative_path') as { value: string }
    if (failure === 'success-legacy-no-assets') expect(wallpaperPreference).toBeUndefined()
    else
      expect(wallpaperPreference.value).toMatch(
        /^import-assets\/[a-f0-9-]+\/wallpapers\/user-2\/current.webp$/
      )
    expect(
      importedDb
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get('backup_last_dir') as {
        value: string
      }
    ).toEqual({ value: 'D:/snapshot-backups' })
    expect(
      importedDb
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get('last_login_user_id') as {
        value: string
      }
    ).toEqual({ value: '2' })
    const fileRow = importedDb
      .prepare(
        'SELECT stored_path, imported_by, ledger_id FROM electronic_voucher_files WHERE ledger_id = ?'
      )
      .get(result.importedLedgerId) as {
      stored_path: string
      imported_by: number
      ledger_id: number
    }
    expect(fileRow.imported_by).not.toBeNull()
    expect(fileRow.stored_path).toContain(`ledger-${result.importedLedgerId}`)
    expect(
      importedDb
        .prepare(
          'SELECT reason, approval_tag FROM operation_logs WHERE ledger_id = ? AND module = ? AND action = ?'
        )
        .get(result.importedLedgerId, 'voucher', 'create') as {
        reason: string | null
        approval_tag: string | null
      }
    ).toEqual({
      reason: '紧急逆转补录',
      approval_tag: 'APR-2026-03'
    })
    importedDb.close()

    expect(fs.existsSync(fileRow.stored_path)).toBe(true)
    expect(fs.readFileSync(fileRow.stored_path, 'utf8')).toBe('source-voucher')
    expect(fs.existsSync(path.join(tempDir, 'wallpapers', 'user-2', 'current.webp'))).toBe(true)
    if (wallpaperPreference) {
      expect(fs.existsSync(path.join(targetUserDataPath, wallpaperPreference.value))).toBe(true)
      expect(
        fs.readFileSync(path.join(targetUserDataPath, wallpaperPreference.value), 'utf8')
      ).toBe('source-wallpaper')
    }
  })
})

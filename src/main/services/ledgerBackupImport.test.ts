import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createLedgerBackupArtifact, importLedgerBackupArtifact } from './backupRecovery'

function createLedgerSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      real_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '{}',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE user_ledger_permissions (
      user_id INTEGER NOT NULL,
      ledger_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, ledger_id)
    );
    CREATE TABLE ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      standard_type TEXT NOT NULL,
      start_period TEXT NOT NULL,
      current_period TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT DEFAULT NULL
    );
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_code TEXT DEFAULT NULL,
      category TEXT NOT NULL,
      balance_direction TEXT NOT NULL,
      has_auxiliary INTEGER NOT NULL DEFAULT 0,
      is_cash_flow INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE auxiliary_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE subject_auxiliary_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      category TEXT NOT NULL
    );
    CREATE TABLE subject_auxiliary_custom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      auxiliary_item_id INTEGER NOT NULL
    );
    CREATE TABLE vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      voucher_number INTEGER NOT NULL,
      voucher_word TEXT NOT NULL DEFAULT '记',
      status INTEGER NOT NULL DEFAULT 0,
      deleted_from_status INTEGER DEFAULT NULL,
      creator_id INTEGER DEFAULT NULL,
      auditor_id INTEGER DEFAULT NULL,
      bookkeeper_id INTEGER DEFAULT NULL,
      attachment_count INTEGER NOT NULL DEFAULT 0,
      is_carry_forward INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE voucher_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      row_order INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      subject_code TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0,
      auxiliary_item_id INTEGER DEFAULT NULL,
      cash_flow_item_id INTEGER DEFAULT NULL
    );
    CREATE TABLE cash_flow_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      direction TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE cash_flow_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      subject_code TEXT NOT NULL,
      counterpart_subject_code TEXT DEFAULT NULL,
      entry_direction TEXT DEFAULT NULL,
      cash_flow_item_id INTEGER NOT NULL
    );
    CREATE TABLE pl_carry_forward_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      from_subject_code TEXT NOT NULL,
      to_subject_code TEXT NOT NULL
    );
    CREATE TABLE initial_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE electronic_voucher_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      file_ext TEXT NOT NULL DEFAULT '',
      mime_type TEXT DEFAULT NULL,
      sha256 TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      imported_by INTEGER DEFAULT NULL,
      imported_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE electronic_voucher_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      voucher_type TEXT NOT NULL DEFAULT 'digital_invoice',
      source_number TEXT DEFAULT NULL,
      source_date TEXT DEFAULT NULL,
      counterpart_name TEXT DEFAULT NULL,
      amount_cents INTEGER DEFAULT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'imported',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE electronic_voucher_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'verified',
      verification_method TEXT DEFAULT NULL,
      verification_message TEXT DEFAULT NULL,
      verified_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE voucher_source_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_record_id INTEGER NOT NULL,
      linked_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE report_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      report_type TEXT NOT NULL,
      report_name TEXT NOT NULL,
      period TEXT NOT NULL,
      start_period TEXT NOT NULL DEFAULT '',
      end_period TEXT NOT NULL DEFAULT '',
      as_of_date TEXT DEFAULT NULL,
      include_unposted_vouchers INTEGER NOT NULL DEFAULT 0,
      generated_by INTEGER DEFAULT NULL,
      generated_at TEXT NOT NULL DEFAULT '',
      content_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER DEFAULT NULL,
      user_id INTEGER DEFAULT NULL,
      username TEXT NOT NULL DEFAULT '',
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT DEFAULT NULL,
      target_id TEXT DEFAULT NULL,
      reason TEXT DEFAULT NULL,
      approval_tag TEXT DEFAULT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE backup_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      backup_path TEXT NOT NULL
    );
    CREATE TABLE archive_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      export_path TEXT NOT NULL
    );
    CREATE TABLE user_preferences (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `)
}

describe('ledger backup import', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('imports a ledger backup package as a new ledger, reuses users by username, and rewrites attachment paths', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-import-'))
    const sourcePath = path.join(tempDir, 'source.db')
    const targetPath = path.join(tempDir, 'target.db')
    const backupDir = path.join(tempDir, 'backups')
    const targetUserDataPath = path.join(tempDir, 'target-user-data')
    const attachmentRootDir = path.join(targetUserDataPath, 'electronic-vouchers')
    const sourceWallpaperDir = path.join(tempDir, 'wallpapers', 'user-2')
    const sourceWallpaperPath = path.join(sourceWallpaperDir, 'current.webp')
    fs.mkdirSync(sourceWallpaperDir, { recursive: true })
    fs.writeFileSync(sourceWallpaperPath, 'source-wallpaper', 'utf8')

    const sourceDb = new DatabaseSync(sourcePath)
    createLedgerSchema(sourceDb)
    const sourceVoucherPath = path.join(tempDir, 'source-voucher.ofd')
    fs.writeFileSync(sourceVoucherPath, 'source-voucher', 'utf8')
    sourceDb.exec(`
      INSERT INTO users (id, username, real_name, password_hash, permissions, is_admin, created_at)
      VALUES
        (1, 'admin', '管理员', '', '{}', 1, '2026-04-02 09:00:00'),
        (2, 'maker', '制单员', '', '{}', 0, '2026-04-02 09:00:00');
      INSERT INTO ledgers (id, name, standard_type, start_period, current_period, created_at)
      VALUES (8, '华北客户', 'enterprise', '2026-01', '2026-03', '2026-04-02 09:00:00');
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

    const targetDb = new DatabaseSync(targetPath)
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

    const result = importLedgerBackupArtifact({
      backupPath: artifact.backupPath,
      manifestPath: artifact.manifestPath,
      targetPath,
      attachmentRootDir,
      operatorUserId: 1,
      operatorIsAdmin: false
    })

    const importedDb = new DatabaseSync(targetPath, { readOnly: true })
    expect(result.importedLedgerName).toBe('华北客户（导入）')
    expect(
      importedDb.prepare('SELECT COUNT(1) AS count FROM ledgers').get() as { count: number }
    ).toEqual({ count: 2 })
    expect(
      importedDb
        .prepare('SELECT id, name FROM ledgers WHERE id = ?')
        .get(result.importedLedgerId) as { id: number; name: string }
    ).toEqual({
      id: result.importedLedgerId,
      name: '华北客户（导入）'
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
      importedDb
        .prepare('SELECT COUNT(1) AS count FROM users WHERE username = ?')
        .get('admin') as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare('SELECT COUNT(1) AS count FROM users WHERE username = ?')
        .get('maker') as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare('SELECT COUNT(1) AS count FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?')
        .get(1, result.importedLedgerId) as { count: number }
    ).toEqual({ count: 1 })
    expect(
      importedDb
        .prepare('SELECT COUNT(1) AS count FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?')
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
    expect(wallpaperPreference.value).toBe('wallpapers/user-2/current.webp')
    expect(
      importedDb.prepare('SELECT value FROM system_settings WHERE key = ?').get('backup_last_dir') as {
        value: string
      }
    ).toEqual({ value: 'D:/snapshot-backups' })
    expect(
      importedDb.prepare('SELECT value FROM system_settings WHERE key = ?').get('last_login_user_id') as {
        value: string
      }
    ).toEqual({ value: '2' })
    const fileRow = importedDb
      .prepare('SELECT stored_path, imported_by, ledger_id FROM electronic_voucher_files WHERE ledger_id = ?')
      .get(result.importedLedgerId) as { stored_path: string; imported_by: number; ledger_id: number }
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
    expect(
      fs.existsSync(path.join(targetUserDataPath, wallpaperPreference.value))
    ).toBe(true)
    expect(
      fs.readFileSync(path.join(targetUserDataPath, wallpaperPreference.value), 'utf8')
    ).toBe('source-wallpaper')
  })
})

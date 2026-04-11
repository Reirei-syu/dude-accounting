import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBackupArtifact,
  createLedgerBackupArtifact,
  type LedgerBackupManifest,
  resolveBackupArtifactPaths,
  restoreBackupArtifact,
  validateBackupArtifact,
  validateLedgerBackupArtifact
} from './backupRecovery'

describe('backupRecovery service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('creates a backup package with the ledger name and period in the directory name', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(path.basename(path.dirname(result.backupPath))).toBe('test-ledger_2026-03_备份包')
    expect(path.basename(result.backupPath)).toBe('test-ledger_2026-03_备份包.db')
    expect(path.basename(result.manifestPath)).toBe('manifest.json')
    expect(result.fileSize).toBeGreaterThan(0)
    expect(result.createdAt).toBe('2026-03-08 09:10:11')
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      schemaVersion: '1.0',
      packageType: 'system_backup',
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      createdAt: '2026-03-08 09:10:11',
      checksum: result.checksum,
      fileSize: result.fileSize,
      databaseFile: 'test-ledger_2026-03_备份包.db'
    })

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: true,
        actualChecksum: result.checksum,
        manifest: expect.objectContaining({
          packageType: 'system_backup',
          ledgerId: 8,
          ledgerName: 'test-ledger'
        })
      })
    )
  })

  it('adds a numeric suffix when the target backup directory already exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const first = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })
    const second = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(path.basename(first.packageDir)).toBe('test-ledger_2026-03_备份包')
    expect(path.basename(second.packageDir)).toBe('test-ledger_2026-03_备份包_2')
    expect(path.basename(second.backupPath)).toBe('test-ledger_2026-03_备份包_2.db')
  })

  it('fails validation when manifest metadata does not match the backup file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as {
      checksum: string
    }
    manifest.checksum = 'tampered-checksum'
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: false,
        actualChecksum: result.checksum
      })
    )
  })

  it('restores the backup artifact to the target database path via a temporary file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    const targetPath = path.join(tempDir, 'restored.db')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')
    fs.writeFileSync(targetPath, 'old-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    restoreBackupArtifact({
      backupPath: result.backupPath,
      targetPath
    })

    expect(fs.readFileSync(targetPath, 'utf8')).toBe('sqlite-bytes')
    expect(fs.existsSync(`${targetPath}.restore-tmp`)).toBe(false)
  })

  it('resolves backup and manifest paths from a selected backup package directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(resolveBackupArtifactPaths(result.packageDir)).toEqual({
      backupPath: result.backupPath,
      manifestPath: result.manifestPath
    })
  })

  it('creates a ledger-scoped backup package that keeps only the selected ledger and bundled voucher files', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'source.db')
    const backupDir = path.join(tempDir, 'backups')
    const sourceDb = new DatabaseSync(sourcePath)
    sourceDb.exec('PRAGMA foreign_keys = ON;')
    sourceDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        real_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '{}',
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT ''
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
        FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
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
        is_system INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
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
        updated_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (auditor_id) REFERENCES users(id),
        FOREIGN KEY (bookkeeper_id) REFERENCES users(id)
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
        cash_flow_item_id INTEGER DEFAULT NULL,
        FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
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
        imported_by INTEGER DEFAULT NULL
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
        updated_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (file_id) REFERENCES electronic_voucher_files(id) ON DELETE CASCADE
      );
      CREATE TABLE electronic_voucher_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'verified',
        verification_method TEXT DEFAULT NULL,
        verification_message TEXT DEFAULT NULL,
        verified_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (record_id) REFERENCES electronic_voucher_records(id) ON DELETE CASCADE
      );
      CREATE TABLE voucher_source_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voucher_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_record_id INTEGER NOT NULL,
        linked_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
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
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE user_preferences (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (user_id, key)
      );
      CREATE TABLE user_ledger_permissions (
        user_id INTEGER NOT NULL,
        ledger_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, ledger_id)
      );
      CREATE TABLE system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
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
      CREATE TABLE auxiliary_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL
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
    `)

    const keptVoucherFilePath = path.join(tempDir, 'voucher-kept.ofd')
    const droppedVoucherFilePath = path.join(tempDir, 'voucher-dropped.ofd')
    const sourceWallpaperDir = path.join(tempDir, 'wallpapers', 'user-1')
    const sourceWallpaperPath = path.join(sourceWallpaperDir, 'current.png')
    fs.mkdirSync(sourceWallpaperDir, { recursive: true })
    fs.writeFileSync(keptVoucherFilePath, 'kept-file', 'utf8')
    fs.writeFileSync(droppedVoucherFilePath, 'dropped-file', 'utf8')
    fs.writeFileSync(sourceWallpaperPath, 'wallpaper-file', 'utf8')

    sourceDb.exec(`
      INSERT INTO users (id, username, real_name, password_hash, permissions, is_admin, created_at)
      VALUES
        (1, 'admin', '管理员', '', '{}', 1, '2026-04-02 09:00:00'),
        (2, 'user-a', '甲', '', '{}', 0, '2026-04-02 09:00:00');
      INSERT INTO ledgers (id, name, standard_type, start_period, current_period, created_at)
      VALUES
        (8, '测试账套', 'enterprise', '2026-01', '2026-03', '2026-04-02 09:00:00'),
        (9, '其他账套', 'enterprise', '2026-01', '2026-03', '2026-04-02 09:00:00');
      INSERT INTO periods (ledger_id, period, is_closed) VALUES
        (8, '2026-03', 1),
        (9, '2026-03', 1);
      INSERT INTO subjects (id, ledger_id, code, name, category, balance_direction) VALUES
        (81, 8, '1001', '库存现金', 'asset', 'debit'),
        (91, 9, '1001', '库存现金', 'asset', 'debit');
      INSERT INTO vouchers (
        id, ledger_id, period, voucher_date, voucher_number, voucher_word, creator_id, auditor_id, bookkeeper_id
      ) VALUES
        (801, 8, '2026-03', '2026-03-01', 1, '记', 1, 2, 1),
        (901, 9, '2026-03', '2026-03-02', 1, '记', 1, 2, 1);
      INSERT INTO voucher_entries (voucher_id, row_order, summary, subject_code, debit_amount, credit_amount) VALUES
        (801, 1, '保留分录', '1001', 100, 0),
        (901, 1, '删除分录', '1001', 200, 0);
      INSERT INTO electronic_voucher_files (
        id, ledger_id, original_name, stored_name, stored_path, file_ext, sha256, file_size, imported_by
      ) VALUES
        (810, 8, 'kept.ofd', 'kept.ofd', '${keptVoucherFilePath.replace(/\\/g, '/')}', '.ofd', 'hash-kept', 9, 1),
        (910, 9, 'dropped.ofd', 'dropped.ofd', '${droppedVoucherFilePath.replace(/\\/g, '/')}', '.ofd', 'hash-dropped', 12, 2);
      INSERT INTO electronic_voucher_records (
        id, ledger_id, file_id, voucher_type, source_number, source_date, fingerprint, status
      ) VALUES
        (811, 8, 810, 'digital_invoice', 'A001', '2026-03-01', 'fp-kept', 'verified'),
        (911, 9, 910, 'digital_invoice', 'B001', '2026-03-02', 'fp-dropped', 'verified');
      INSERT INTO electronic_voucher_verifications (record_id, verification_status) VALUES
        (811, 'verified'),
        (911, 'verified');
      INSERT INTO voucher_source_links (voucher_id, source_type, source_record_id) VALUES
        (801, 'electronic_voucher', 811),
        (901, 'electronic_voucher', 911);
      INSERT INTO operation_logs (ledger_id, user_id, username, module, action, target_type, target_id, details_json, created_at) VALUES
        (8, 1, 'admin', 'voucher', 'create', 'voucher', '801', '{}', '2026-04-02 09:00:00'),
        (9, 2, 'user-a', 'voucher', 'create', 'voucher', '901', '{}', '2026-04-02 09:00:00');
      INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES
        (1, 'default_home_tab', 'voucher-entry', '2026-04-02 09:00:00'),
        (1, 'custom_wallpaper_relative_path', 'wallpapers/user-1/current.png', '2026-04-02 09:05:00');
      INSERT INTO user_ledger_permissions (user_id, ledger_id) VALUES
        (2, 8),
        (2, 9);
      INSERT INTO system_settings (key, value) VALUES
        ('foo', 'bar'),
        ('last_login_user_id', '1');
      INSERT INTO backup_packages (ledger_id, backup_path) VALUES
        (8, 'D:/legacy-1'),
        (9, 'D:/legacy-2');
      INSERT INTO archive_exports (ledger_id, export_path) VALUES
        (8, 'D:/archive-1'),
        (9, 'D:/archive-2');
    `)
    sourceDb.close()

    const result = createLedgerBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 3, 2, 10, 0, 0)
    })

    const packageDb = new DatabaseSync(result.backupPath, { readOnly: true })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM ledgers').get() as { count: number }
    ).toEqual({ count: 1 })
    expect(
      packageDb.prepare('SELECT name FROM ledgers').get() as { name: string }
    ).toEqual({ name: '测试账套' })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM vouchers').get() as { count: number }
    ).toEqual({ count: 1 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM electronic_voucher_files').get() as {
        count: number
      }
    ).toEqual({ count: 1 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM backup_packages').get() as { count: number }
    ).toEqual({ count: 0 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM archive_exports').get() as { count: number }
    ).toEqual({ count: 0 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM user_preferences').get() as { count: number }
    ).toEqual({ count: 2 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM system_settings').get() as { count: number }
    ).toEqual({ count: 2 })
    expect(
      packageDb.prepare('SELECT COUNT(1) AS count FROM user_ledger_permissions').get() as {
        count: number
      }
    ).toEqual({ count: 1 })
    const storedPathRow = packageDb
      .prepare('SELECT stored_path FROM electronic_voucher_files')
      .get() as { stored_path: string }
    expect(storedPathRow.stored_path).toBe('electronic-vouchers/kept.ofd')
    packageDb.close()

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as LedgerBackupManifest
    expect(manifest.packageType).toBe('ledger_backup')
    expect(manifest.schemaVersion).toBe('2.1')
    expect(manifest.ledgerId).toBe(8)
    expect(manifest.attachments).toEqual([
      expect.objectContaining({
        relativePath: 'electronic-vouchers/kept.ofd',
        originalName: 'kept.ofd'
      })
    ])
    expect(manifest.settingsAssets).toEqual([
      expect.objectContaining({
        ownerUsername: 'admin',
        kind: 'wallpaper',
        relativePath: 'settings-assets/admin-wallpaper.png'
      })
    ])
    expect(fs.existsSync(path.join(result.packageDir, 'electronic-vouchers', 'kept.ofd'))).toBe(true)
    expect(fs.existsSync(path.join(result.packageDir, 'electronic-vouchers', 'dropped.ofd'))).toBe(false)
    expect(fs.existsSync(path.join(result.packageDir, 'settings-assets', 'admin-wallpaper.png'))).toBe(
      true
    )
  })

  it('fails ledger package validation when a bundled voucher file is missing', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'source.db')
    const backupDir = path.join(tempDir, 'backups')
    const sourceDb = new DatabaseSync(sourcePath)
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, real_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '{}', is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, standard_type TEXT NOT NULL, start_period TEXT NOT NULL, current_period TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE periods (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, is_closed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, parent_code TEXT DEFAULT NULL, category TEXT NOT NULL, balance_direction TEXT NOT NULL, has_auxiliary INTEGER NOT NULL DEFAULT 0, is_cash_flow INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, is_system INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, voucher_date TEXT NOT NULL, voucher_number INTEGER NOT NULL, voucher_word TEXT NOT NULL DEFAULT '记', status INTEGER NOT NULL DEFAULT 0, deleted_from_status INTEGER DEFAULT NULL, creator_id INTEGER DEFAULT NULL, auditor_id INTEGER DEFAULT NULL, bookkeeper_id INTEGER DEFAULT NULL, attachment_count INTEGER NOT NULL DEFAULT 0, is_carry_forward INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE voucher_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, row_order INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0, auxiliary_item_id INTEGER DEFAULT NULL, cash_flow_item_id INTEGER DEFAULT NULL);
      CREATE TABLE electronic_voucher_files (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, stored_path TEXT NOT NULL, file_ext TEXT NOT NULL DEFAULT '', mime_type TEXT DEFAULT NULL, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, imported_by INTEGER DEFAULT NULL);
      CREATE TABLE electronic_voucher_records (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, file_id INTEGER NOT NULL, voucher_type TEXT NOT NULL DEFAULT 'digital_invoice', source_number TEXT DEFAULT NULL, source_date TEXT DEFAULT NULL, counterpart_name TEXT DEFAULT NULL, amount_cents INTEGER DEFAULT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'imported', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE electronic_voucher_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, verification_status TEXT NOT NULL DEFAULT 'verified', verification_method TEXT DEFAULT NULL, verification_message TEXT DEFAULT NULL, verified_at TEXT DEFAULT NULL, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE voucher_source_links (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, source_type TEXT NOT NULL, source_record_id INTEGER NOT NULL, linked_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER DEFAULT NULL, user_id INTEGER DEFAULT NULL, username TEXT NOT NULL DEFAULT '', module TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT DEFAULT NULL, target_id TEXT DEFAULT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE user_preferences (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, key));
      CREATE TABLE user_ledger_permissions (user_id INTEGER NOT NULL, ledger_id INTEGER NOT NULL, PRIMARY KEY (user_id, ledger_id));
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
      CREATE TABLE backup_packages (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, backup_path TEXT NOT NULL);
      CREATE TABLE archive_exports (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, export_path TEXT NOT NULL);
      CREATE TABLE auxiliary_items (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, category TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE subject_auxiliary_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, category TEXT NOT NULL);
      CREATE TABLE subject_auxiliary_custom_items (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, auxiliary_item_id INTEGER NOT NULL);
      CREATE TABLE cash_flow_items (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE cash_flow_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, subject_code TEXT NOT NULL, counterpart_subject_code TEXT DEFAULT NULL, entry_direction TEXT DEFAULT NULL, cash_flow_item_id INTEGER NOT NULL);
      CREATE TABLE pl_carry_forward_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, from_subject_code TEXT NOT NULL, to_subject_code TEXT NOT NULL);
      CREATE TABLE initial_balances (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE report_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, report_type TEXT NOT NULL, report_name TEXT NOT NULL, period TEXT NOT NULL, start_period TEXT NOT NULL DEFAULT '', end_period TEXT NOT NULL DEFAULT '', as_of_date TEXT DEFAULT NULL, include_unposted_vouchers INTEGER NOT NULL DEFAULT 0, generated_by INTEGER DEFAULT NULL, generated_at TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL DEFAULT '{}');
      INSERT INTO ledgers (id, name, standard_type, start_period, current_period, created_at) VALUES (8, '测试账套', 'enterprise', '2026-01', '2026-03', '2026-04-02 09:00:00');
      INSERT INTO periods (ledger_id, period, is_closed) VALUES (8, '2026-03', 1);
      INSERT INTO subjects (id, ledger_id, code, name, category, balance_direction) VALUES (81, 8, '1001', '库存现金', 'asset', 'debit');
    `)
    const voucherPath = path.join(tempDir, 'voucher.ofd')
    fs.writeFileSync(voucherPath, 'voucher-file', 'utf8')
    sourceDb.exec(`
      INSERT INTO electronic_voucher_files (id, ledger_id, original_name, stored_name, stored_path, file_ext, sha256, file_size, imported_by)
      VALUES (810, 8, 'voucher.ofd', 'voucher.ofd', '${voucherPath.replace(/\\/g, '/')}', '.ofd', 'hash', 12, NULL);
      INSERT INTO electronic_voucher_records (id, ledger_id, file_id, voucher_type, source_number, source_date, fingerprint, status)
      VALUES (811, 8, 810, 'digital_invoice', 'A001', '2026-03-01', 'fp-kept', 'verified');
    `)
    sourceDb.close()

    const result = createLedgerBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 3, 2, 10, 0, 0)
    })

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as LedgerBackupManifest
    manifest.attachments[0].relativePath = 'electronic-vouchers/missing-voucher.ofd'
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    expect(validateLedgerBackupArtifact(result.backupPath, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: false,
        error: expect.stringContaining('附件')
      })
    )
  })

  it('fails ledger package validation when a bundled settings asset is missing', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'source.db')
    const backupDir = path.join(tempDir, 'backups')
    const wallpaperDir = path.join(tempDir, 'wallpapers', 'user-1')
    const wallpaperPath = path.join(wallpaperDir, 'current.png')
    fs.mkdirSync(wallpaperDir, { recursive: true })
    fs.writeFileSync(wallpaperPath, 'wallpaper-file', 'utf8')
    const sourceDb = new DatabaseSync(sourcePath)
    sourceDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, real_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '{}', is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, standard_type TEXT NOT NULL, start_period TEXT NOT NULL, current_period TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE periods (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, is_closed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE subjects (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, parent_code TEXT DEFAULT NULL, category TEXT NOT NULL, balance_direction TEXT NOT NULL, has_auxiliary INTEGER NOT NULL DEFAULT 0, is_cash_flow INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, is_system INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE vouchers (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, voucher_date TEXT NOT NULL, voucher_number INTEGER NOT NULL, voucher_word TEXT NOT NULL DEFAULT '记', status INTEGER NOT NULL DEFAULT 0, deleted_from_status INTEGER DEFAULT NULL, creator_id INTEGER DEFAULT NULL, auditor_id INTEGER DEFAULT NULL, bookkeeper_id INTEGER DEFAULT NULL, attachment_count INTEGER NOT NULL DEFAULT 0, is_carry_forward INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE voucher_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, row_order INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0, auxiliary_item_id INTEGER DEFAULT NULL, cash_flow_item_id INTEGER DEFAULT NULL);
      CREATE TABLE electronic_voucher_files (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, original_name TEXT NOT NULL, stored_name TEXT NOT NULL, stored_path TEXT NOT NULL, file_ext TEXT NOT NULL DEFAULT '', mime_type TEXT DEFAULT NULL, sha256 TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0, imported_by INTEGER DEFAULT NULL);
      CREATE TABLE electronic_voucher_records (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, file_id INTEGER NOT NULL, voucher_type TEXT NOT NULL DEFAULT 'digital_invoice', source_number TEXT DEFAULT NULL, source_date TEXT DEFAULT NULL, counterpart_name TEXT DEFAULT NULL, amount_cents INTEGER DEFAULT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'imported', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE electronic_voucher_verifications (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, verification_status TEXT NOT NULL DEFAULT 'verified', verification_method TEXT DEFAULT NULL, verification_message TEXT DEFAULT NULL, verified_at TEXT DEFAULT NULL, created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE voucher_source_links (id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, source_type TEXT NOT NULL, source_record_id INTEGER NOT NULL, linked_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER DEFAULT NULL, user_id INTEGER DEFAULT NULL, username TEXT NOT NULL DEFAULT '', module TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT DEFAULT NULL, target_id TEXT DEFAULT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE user_preferences (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, key));
      CREATE TABLE user_ledger_permissions (user_id INTEGER NOT NULL, ledger_id INTEGER NOT NULL, PRIMARY KEY (user_id, ledger_id));
      CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
      CREATE TABLE backup_packages (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, backup_path TEXT NOT NULL);
      CREATE TABLE archive_exports (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, export_path TEXT NOT NULL);
      CREATE TABLE auxiliary_items (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, category TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE subject_auxiliary_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, category TEXT NOT NULL);
      CREATE TABLE subject_auxiliary_custom_items (id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, auxiliary_item_id INTEGER NOT NULL);
      CREATE TABLE cash_flow_items (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, direction TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE cash_flow_mappings (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, subject_code TEXT NOT NULL, counterpart_subject_code TEXT DEFAULT NULL, entry_direction TEXT DEFAULT NULL, cash_flow_item_id INTEGER NOT NULL);
      CREATE TABLE pl_carry_forward_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, from_subject_code TEXT NOT NULL, to_subject_code TEXT NOT NULL);
      CREATE TABLE initial_balances (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL, subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE report_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, report_type TEXT NOT NULL, report_name TEXT NOT NULL, period TEXT NOT NULL, start_period TEXT NOT NULL DEFAULT '', end_period TEXT NOT NULL DEFAULT '', as_of_date TEXT DEFAULT NULL, include_unposted_vouchers INTEGER NOT NULL DEFAULT 0, generated_by INTEGER DEFAULT NULL, generated_at TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL DEFAULT '{}');
      INSERT INTO users (id, username, real_name, password_hash, permissions, is_admin, created_at) VALUES (1, 'admin', '管理员', '', '{}', 1, '2026-04-02 09:00:00');
      INSERT INTO ledgers (id, name, standard_type, start_period, current_period, created_at) VALUES (8, '测试账套', 'enterprise', '2026-01', '2026-03', '2026-04-02 09:00:00');
      INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (1, 'custom_wallpaper_relative_path', 'wallpapers/user-1/current.png', '2026-04-02 09:05:00');
      INSERT INTO system_settings (key, value) VALUES ('last_login_user_id', '1');
    `)
    sourceDb.close()

    const result = createLedgerBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: null,
      fiscalYear: null,
      now: new Date(2026, 3, 2, 10, 0, 0)
    })

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as LedgerBackupManifest
    manifest.settingsAssets![0].relativePath = 'settings-assets/missing-wallpaper.png'
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    expect(validateLedgerBackupArtifact(result.backupPath, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: false,
        error: expect.stringContaining('设置资产')
      })
    )
  })
})

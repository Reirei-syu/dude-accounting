import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { seedAdminUser, seedSubjects, seedCashFlowItems, seedPLCarryForwardRules } from './seed'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db
  const dbPath = path.join(app.getPath('userData'), 'dude-accounting.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function initializeDatabase(): void {
  const db = getDatabase()

  db.exec(`
    -- 用户表
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      real_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '{}',
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 账套表
    CREATE TABLE IF NOT EXISTS ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      standard_type TEXT NOT NULL DEFAULT 'enterprise' CHECK(standard_type IN ('enterprise', 'npo')),
      start_period TEXT NOT NULL,
      current_period TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 会计科目表
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_code TEXT DEFAULT NULL,
      category TEXT NOT NULL CHECK(category IN ('asset', 'liability', 'common', 'equity', 'cost', 'profit_loss')),
      balance_direction INTEGER NOT NULL DEFAULT 1,
      has_auxiliary INTEGER NOT NULL DEFAULT 0,
      is_cash_flow INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ledger_id, code),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 辅助核算项目表
    CREATE TABLE IF NOT EXISTS auxiliary_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ledger_id, category, code),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 科目辅助项类别关联表
    CREATE TABLE IF NOT EXISTS subject_auxiliary_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      UNIQUE(subject_id, category),
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    -- 科目与自定义辅助项明细关联表
    CREATE TABLE IF NOT EXISTS subject_auxiliary_custom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      auxiliary_item_id INTEGER NOT NULL,
      UNIQUE(subject_id, auxiliary_item_id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
      FOREIGN KEY (auxiliary_item_id) REFERENCES auxiliary_items(id) ON DELETE RESTRICT
    );

    -- 凭证主表
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      voucher_date TEXT NOT NULL,
      voucher_number INTEGER NOT NULL,
      voucher_word TEXT NOT NULL DEFAULT '记',
      status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0, 1, 2, 3)),
      deleted_from_status INTEGER DEFAULT NULL CHECK(deleted_from_status IS NULL OR deleted_from_status IN (0, 1, 2)),
      creator_id INTEGER,
      auditor_id INTEGER,
      bookkeeper_id INTEGER,
      attachment_count INTEGER NOT NULL DEFAULT 0,
      is_carry_forward INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (creator_id) REFERENCES users(id),
      FOREIGN KEY (auditor_id) REFERENCES users(id),
      FOREIGN KEY (bookkeeper_id) REFERENCES users(id)
    );

    -- 凭证分录明细表
    CREATE TABLE IF NOT EXISTS voucher_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      row_order INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      subject_code TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0,
      auxiliary_item_id INTEGER DEFAULT NULL,
      cash_flow_item_id INTEGER DEFAULT NULL,
      FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE,
      FOREIGN KEY (auxiliary_item_id) REFERENCES auxiliary_items(id),
      FOREIGN KEY (cash_flow_item_id) REFERENCES cash_flow_items(id)
    );

    -- 现金流量项目表
    CREATE TABLE IF NOT EXISTS cash_flow_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('operating', 'investing', 'financing')),
      direction TEXT NOT NULL DEFAULT 'inflow' CHECK(direction IN ('inflow', 'outflow')),
      is_system INTEGER NOT NULL DEFAULT 1,
      UNIQUE(ledger_id, code),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 现金流量匹配规则表
    CREATE TABLE IF NOT EXISTS cash_flow_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      subject_code TEXT NOT NULL,
      counterpart_subject_code TEXT NOT NULL,
      entry_direction TEXT NOT NULL CHECK(entry_direction IN ('inflow', 'outflow')),
      cash_flow_item_id INTEGER NOT NULL,
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY (cash_flow_item_id) REFERENCES cash_flow_items(id)
    );

    -- 期末损益结转规则表
    CREATE TABLE IF NOT EXISTS pl_carry_forward_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      from_subject_code TEXT NOT NULL,
      to_subject_code TEXT NOT NULL DEFAULT '4103',
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 期初余额表
    CREATE TABLE IF NOT EXISTS initial_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0,
      UNIQUE(ledger_id, period, subject_code),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 会计期间表
    CREATE TABLE IF NOT EXISTS periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      closed_at TEXT DEFAULT NULL,
      UNIQUE(ledger_id, period),
      FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
    );

    -- 系统设置表
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_subjects_ledger ON subjects(ledger_id);
    CREATE INDEX IF NOT EXISTS idx_subject_aux_categories_subject ON subject_auxiliary_categories(subject_id);
    CREATE INDEX IF NOT EXISTS idx_subject_aux_custom_items_subject ON subject_auxiliary_custom_items(subject_id);
    CREATE INDEX IF NOT EXISTS idx_subject_aux_custom_items_aux_item ON subject_auxiliary_custom_items(auxiliary_item_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_ledger_period ON vouchers(ledger_id, period);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_unique_number
      ON vouchers(ledger_id, period, voucher_word, voucher_number);
    CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher ON voucher_entries(voucher_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(voucher_date);
  `)

  ensureVoucherSchema(db)
  ensureInitialBalanceSchema(db)
  ensureCashFlowMappingSchema(db)

  // Seed default data
  seedAdminUser(db)
  seedSubjects(db)
  seedCashFlowItems(db)
  seedPLCarryForwardRules(db)

  // Set default system settings
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  )
  insertSetting.run('allow_same_maker_auditor', '0')
  insertSetting.run('wallpaper_path', '')
}

export function ensureInitialBalanceSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('initial_balances')").all() as Array<{
    name: string
  }>
  if (columns.length === 0) return

  const hasPeriod = columns.some((col) => col.name === 'period')
  if (!hasPeriod) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE initial_balances_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ledger_id INTEGER NOT NULL,
          period TEXT NOT NULL,
          subject_code TEXT NOT NULL,
          debit_amount INTEGER NOT NULL DEFAULT 0,
          credit_amount INTEGER NOT NULL DEFAULT 0,
          UNIQUE(ledger_id, period, subject_code),
          FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
        );
      `)
      db.exec(`
        INSERT INTO initial_balances_new (ledger_id, period, subject_code, debit_amount, credit_amount)
        SELECT ib.ledger_id, l.start_period, ib.subject_code, ib.debit_amount, ib.credit_amount
        FROM initial_balances ib
        INNER JOIN ledgers l ON l.id = ib.ledger_id;
      `)
      db.exec('DROP TABLE initial_balances;')
      db.exec('ALTER TABLE initial_balances_new RENAME TO initial_balances;')
    })

    migrate()
  }

  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_initial_balances_ledger_period ON initial_balances(ledger_id, period)'
  ).run()
}

export function ensureVoucherSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('vouchers')").all() as Array<{ name: string }>
  if (columns.length === 0) return

  const hasDeletedFromStatus = columns.some((col) => col.name === 'deleted_from_status')
  const voucherTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vouchers'")
    .get() as { sql: string } | undefined
  const supportsDeletedStatus = voucherTableSql?.sql.includes('status IN (0, 1, 2, 3)') ?? false

  if (!hasDeletedFromStatus || !supportsDeletedStatus) {
    const deletedFromStatusProjection = hasDeletedFromStatus
      ? 'deleted_from_status'
      : 'NULL AS deleted_from_status'
    const foreignKeysEnabled = (db.pragma('foreign_keys', { simple: true }) as number) === 1

    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE vouchers_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ledger_id INTEGER NOT NULL,
          period TEXT NOT NULL,
          voucher_date TEXT NOT NULL,
          voucher_number INTEGER NOT NULL,
          voucher_word TEXT NOT NULL DEFAULT '记',
          status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0, 1, 2, 3)),
          deleted_from_status INTEGER DEFAULT NULL CHECK(deleted_from_status IS NULL OR deleted_from_status IN (0, 1, 2)),
          creator_id INTEGER,
          auditor_id INTEGER,
          bookkeeper_id INTEGER,
          attachment_count INTEGER NOT NULL DEFAULT 0,
          is_carry_forward INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
          FOREIGN KEY (creator_id) REFERENCES users(id),
          FOREIGN KEY (auditor_id) REFERENCES users(id),
          FOREIGN KEY (bookkeeper_id) REFERENCES users(id)
        );
      `)
      db.exec(`
        INSERT INTO vouchers_new (
          id,
          ledger_id,
          period,
          voucher_date,
          voucher_number,
          voucher_word,
          status,
          deleted_from_status,
          creator_id,
          auditor_id,
          bookkeeper_id,
          attachment_count,
          is_carry_forward,
          created_at,
          updated_at
        )
        SELECT
          id,
          ledger_id,
          period,
          voucher_date,
          voucher_number,
          voucher_word,
          status,
          ${deletedFromStatusProjection},
          creator_id,
          auditor_id,
          bookkeeper_id,
          attachment_count,
          is_carry_forward,
          created_at,
          updated_at
        FROM vouchers;
      `)
      db.exec('DROP TABLE vouchers;')
      db.exec('ALTER TABLE vouchers_new RENAME TO vouchers;')
    })

    db.pragma('foreign_keys = OFF')
    try {
      migrate()
    } finally {
      db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`)
    }

    const foreignKeyIssues = db.pragma('foreign_key_check') as Array<unknown>
    if (foreignKeyIssues.length > 0) {
      throw new Error('凭证表迁移后外键校验失败')
    }
  }

  db.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_ledger_period ON vouchers(ledger_id, period)').run()
  db.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_unique_number ON vouchers(ledger_id, period, voucher_word, voucher_number)'
  ).run()
  db.prepare('CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(voucher_date)').run()
}

export function ensureCashFlowMappingSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('cash_flow_mappings')").all() as Array<{
    name: string
  }>
  if (columns.length === 0) return

  const hasCounterpartSubjectCode = columns.some((col) => col.name === 'counterpart_subject_code')
  const hasEntryDirection = columns.some((col) => col.name === 'entry_direction')

  if (!hasCounterpartSubjectCode) {
    db.exec(
      "ALTER TABLE cash_flow_mappings ADD COLUMN counterpart_subject_code TEXT NOT NULL DEFAULT ''"
    )
  }

  if (!hasEntryDirection) {
    db.exec(
      "ALTER TABLE cash_flow_mappings ADD COLUMN entry_direction TEXT NOT NULL DEFAULT 'inflow'"
    )
  }

  if (!hasCounterpartSubjectCode || !hasEntryDirection) {
    db.prepare(
      "UPDATE cash_flow_mappings SET counterpart_subject_code = '' WHERE counterpart_subject_code IS NULL"
    ).run()
    db.prepare(
      "UPDATE cash_flow_mappings SET entry_direction = 'inflow' WHERE entry_direction IS NULL OR entry_direction = ''"
    ).run()
    // Legacy rows without counterpart information are not usable for auto matching.
    db.prepare("DELETE FROM cash_flow_mappings WHERE counterpart_subject_code = ''").run()
  }

  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_cash_flow_mappings_ledger ON cash_flow_mappings(ledger_id)'
  ).run()
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_flow_mappings_unique
     ON cash_flow_mappings(ledger_id, subject_code, counterpart_subject_code, entry_direction)`
  ).run()
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

import type Database from 'better-sqlite3'

// 历史结构独立声明，不从当前 schema 删除字段生成，以防迁移与 fixture 一起漂移。
function populateHistoricalFixture(db: Database.Database, variant: string): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      real_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '{}', is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, standard_type TEXT NOT NULL DEFAULT 'enterprise',
      start_period TEXT NOT NULL, current_period TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1),(2,'历史操作员',0);
    INSERT INTO ledgers(id,name,standard_type,start_period,current_period) VALUES(7,'历史账套','npo','2026-01','2026-03');
  `)
  const include = (name: string): boolean => variant === 'all' || variant === name
  if (include('subjects')) db.exec(`
    CREATE TABLE subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      parent_code TEXT DEFAULT NULL, category TEXT NOT NULL CHECK(category IN ('asset','liability','equity','cost','profit_loss')),
      balance_direction INTEGER NOT NULL DEFAULT 1, has_auxiliary INTEGER NOT NULL DEFAULT 0,
      is_cash_flow INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, is_system INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(ledger_id,code),
      FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE);
    INSERT INTO subjects(id,ledger_id,code,name,category,balance_direction) VALUES
      (31,7,'3101','非限定性净资产','equity',-1),(32,7,'4101','捐赠收入','profit_loss',-1),(33,7,'5101','业务活动成本','profit_loss',1);
    CREATE TABLE subject_auxiliary_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL, category TEXT NOT NULL,
      UNIQUE(subject_id,category), FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE);
    INSERT INTO subject_auxiliary_categories(id,subject_id,category) VALUES(51,31,'department');
  `)
  if (include('vouchers') || include('compliance')) {
    db.exec(`CREATE TABLE vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, period TEXT NOT NULL,
      voucher_date TEXT NOT NULL, voucher_number INTEGER NOT NULL, voucher_word TEXT NOT NULL DEFAULT '记',
      status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0,1,2)), creator_id INTEGER, auditor_id INTEGER, bookkeeper_id INTEGER,
      attachment_count INTEGER NOT NULL DEFAULT 0, is_carry_forward INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
      FOREIGN KEY(creator_id) REFERENCES users(id), FOREIGN KEY(auditor_id) REFERENCES users(id), FOREIGN KEY(bookkeeper_id) REFERENCES users(id));
      INSERT INTO vouchers(id,ledger_id,period,voucher_date,voucher_number,status,creator_id) VALUES(61,7,'2026-02','2026-02-03',1,2,2);
      CREATE TABLE voucher_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, voucher_id INTEGER NOT NULL, row_order INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '', subject_code TEXT NOT NULL, debit_amount INTEGER NOT NULL DEFAULT 0,
        credit_amount INTEGER NOT NULL DEFAULT 0, auxiliary_item_id INTEGER DEFAULT NULL, cash_flow_item_id INTEGER DEFAULT NULL,
        FOREIGN KEY(voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE,
        FOREIGN KEY(auxiliary_item_id) REFERENCES auxiliary_items(id), FOREIGN KEY(cash_flow_item_id) REFERENCES cash_flow_items(id));
      INSERT INTO voucher_entries(id,voucher_id,summary,subject_code,debit_amount) VALUES(71,61,'保留已记账分录','1001',12345);`)
    if (include('compliance')) db.exec(`
      ALTER TABLE vouchers ADD COLUMN posted_at TEXT;
      ALTER TABLE vouchers ADD COLUMN emergency_reversal_reason TEXT;
      ALTER TABLE vouchers ADD COLUMN emergency_reversal_by INTEGER;
      ALTER TABLE vouchers ADD COLUMN emergency_reversal_at TEXT;
      ALTER TABLE vouchers ADD COLUMN reversal_approval_tag TEXT;
      UPDATE vouchers SET posted_at='2026-02-04', emergency_reversal_reason='历史审批原因', emergency_reversal_by=1,
        emergency_reversal_at='2026-02-05', reversal_approval_tag='审批-001';`)
  }
  if (include('initialBalances')) db.exec(`
    CREATE TABLE initial_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, subject_code TEXT NOT NULL,
      debit_amount INTEGER NOT NULL DEFAULT 0, credit_amount INTEGER NOT NULL DEFAULT 0, UNIQUE(ledger_id,subject_code),
      FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE);
    INSERT INTO initial_balances(id,ledger_id,subject_code,debit_amount) VALUES(81,7,'1001',23456);`)
  if (include('cashMappings')) db.exec(`
    CREATE TABLE cash_flow_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('operating','investing','financing')),
      direction TEXT NOT NULL DEFAULT 'inflow' CHECK(direction IN ('inflow','outflow')), is_system INTEGER NOT NULL DEFAULT 1,
      UNIQUE(ledger_id,code), FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE);
    INSERT INTO cash_flow_items(id,ledger_id,code,name,category) VALUES(91,7,'CF01','收到现金','operating');
    CREATE TABLE cash_flow_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, subject_code TEXT NOT NULL, cash_flow_item_id INTEGER NOT NULL,
      FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE, FOREIGN KEY(cash_flow_item_id) REFERENCES cash_flow_items(id));
    INSERT INTO cash_flow_mappings(id,ledger_id,subject_code,cash_flow_item_id) VALUES(101,7,'1001',91);`)
  if (include('reports')) db.exec(`
    CREATE TABLE report_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, report_type TEXT NOT NULL CHECK(report_type IN ('balance_sheet','income_statement','activity_statement','cashflow_statement')),
      report_name TEXT NOT NULL, period TEXT NOT NULL, generated_by INTEGER DEFAULT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')), content_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE, FOREIGN KEY(generated_by) REFERENCES users(id));
    INSERT INTO report_snapshots(id,ledger_id,report_type,report_name,period,generated_by,content_json) VALUES
      (111,7,'balance_sheet','旧快照','2026-02',2,'{"amount":100}'),(112,7,'balance_sheet','新快照','2026-02',2,'{"amount":200}');`)
  if (include('backup')) db.exec(`
    CREATE TABLE backup_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, fiscal_year TEXT NOT NULL,
      backup_path TEXT NOT NULL, checksum TEXT NOT NULL, file_size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','validated','failed')),
      created_by INTEGER DEFAULT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), validated_at TEXT DEFAULT NULL);
    INSERT INTO backup_packages(id,ledger_id,fiscal_year,backup_path,checksum) VALUES(121,7,'2026','legacy-backup.db','original-checksum');
    CREATE TABLE archive_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_id INTEGER NOT NULL, fiscal_year TEXT NOT NULL,
      export_path TEXT NOT NULL, manifest_path TEXT NOT NULL, checksum TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'generated' CHECK(status IN ('generated','validated','failed')),
      item_count INTEGER NOT NULL DEFAULT 0, created_by INTEGER DEFAULT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO archive_exports(id,ledger_id,fiscal_year,export_path,manifest_path) VALUES(131,7,'2026','archive','manifest.json');`)
}

export function createHistoricalFixture(db: Database.Database, variant = 'all'): void {
  const foreignKeys = db.pragma('foreign_keys', { simple: true })
  db.pragma('foreign_keys = OFF')
  try {
    populateHistoricalFixture(db, variant)
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
  }
}

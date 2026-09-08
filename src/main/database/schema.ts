import type Database from 'better-sqlite3'
import { migrateAuthRevision } from './authRevisionMigration'

export const CURRENT_SCHEMA_VERSION = 3

// 当前结构的唯一事实源；历史升级与新库使用相同定义。
export const TABLE_SQL: Readonly<Record<string, string>> = {
  users: `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  real_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  user_ledger_permissions: `CREATE TABLE IF NOT EXISTS user_ledger_permissions (
  user_id INTEGER NOT NULL,
  ledger_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ledger_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  user_preferences: `CREATE TABLE IF NOT EXISTS user_preferences (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  ledgers: `CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  standard_type TEXT NOT NULL DEFAULT 'enterprise' CHECK(standard_type IN ('enterprise', 'npo')),
  taxpayer_identification_number TEXT NOT NULL DEFAULT '',
  start_period TEXT NOT NULL,
  current_period TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  subjects: `CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT DEFAULT NULL,
  category TEXT NOT NULL CHECK(category IN ('asset', 'liability', 'common', 'equity', 'cost', 'profit_loss', 'net_assets', 'income', 'expense')),
  balance_direction INTEGER NOT NULL DEFAULT 1,
  has_auxiliary INTEGER NOT NULL DEFAULT 0,
  is_cash_flow INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ledger_id, code),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  auxiliary_items: `CREATE TABLE IF NOT EXISTS auxiliary_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ledger_id, category, code),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  subject_auxiliary_categories: `CREATE TABLE IF NOT EXISTS subject_auxiliary_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  UNIQUE(subject_id, category),
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
)`,
  subject_auxiliary_custom_items: `CREATE TABLE IF NOT EXISTS subject_auxiliary_custom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  auxiliary_item_id INTEGER NOT NULL,
  UNIQUE(subject_id, auxiliary_item_id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (auxiliary_item_id) REFERENCES auxiliary_items(id) ON DELETE RESTRICT
)`,
  vouchers: `CREATE TABLE IF NOT EXISTS vouchers (
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
  posted_at TEXT DEFAULT NULL,
  emergency_reversal_reason TEXT DEFAULT NULL,
  emergency_reversal_by INTEGER DEFAULT NULL,
  emergency_reversal_at TEXT DEFAULT NULL,
  reversal_approval_tag TEXT DEFAULT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES users(id),
  FOREIGN KEY (auditor_id) REFERENCES users(id),
  FOREIGN KEY (bookkeeper_id) REFERENCES users(id)
)`,
  voucher_entries: `CREATE TABLE IF NOT EXISTS voucher_entries (
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
)`,
  cash_flow_items: `CREATE TABLE IF NOT EXISTS cash_flow_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('operating', 'investing', 'financing')),
  direction TEXT NOT NULL DEFAULT 'inflow' CHECK(direction IN ('inflow', 'outflow')),
  is_system INTEGER NOT NULL DEFAULT 1,
  UNIQUE(ledger_id, code),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  cash_flow_mappings: `CREATE TABLE IF NOT EXISTS cash_flow_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  subject_code TEXT NOT NULL,
  counterpart_subject_code TEXT NOT NULL,
  entry_direction TEXT NOT NULL CHECK(entry_direction IN ('inflow', 'outflow')),
  cash_flow_item_id INTEGER NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
  FOREIGN KEY (cash_flow_item_id) REFERENCES cash_flow_items(id)
)`,
  pl_carry_forward_rules: `CREATE TABLE IF NOT EXISTS pl_carry_forward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  from_subject_code TEXT NOT NULL,
  to_subject_code TEXT NOT NULL DEFAULT '4103',
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  initial_balances: `CREATE TABLE IF NOT EXISTS initial_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  subject_code TEXT NOT NULL,
  debit_amount INTEGER NOT NULL DEFAULT 0,
  credit_amount INTEGER NOT NULL DEFAULT 0,
  UNIQUE(ledger_id, period, subject_code),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  periods: `CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT DEFAULT NULL,
  UNIQUE(ledger_id, period),
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE
)`,
  system_settings: `CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  operation_logs: `CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER DEFAULT NULL,
  user_id INTEGER DEFAULT NULL,
  username TEXT DEFAULT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT DEFAULT NULL,
  target_id TEXT DEFAULT NULL,
  reason TEXT DEFAULT NULL,
  approval_tag TEXT DEFAULT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  electronic_voucher_files: `CREATE TABLE IF NOT EXISTS electronic_voucher_files (
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
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ledger_id, sha256)
)`,
  electronic_voucher_records: `CREATE TABLE IF NOT EXISTS electronic_voucher_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  voucher_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK(voucher_type IN ('digital_invoice', 'bank_receipt', 'bank_statement', 'unknown')),
  source_number TEXT DEFAULT NULL,
  source_date TEXT DEFAULT NULL,
  counterpart_name TEXT DEFAULT NULL,
  amount_cents INTEGER DEFAULT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'imported'
    CHECK(status IN ('imported', 'verified', 'parsed', 'converted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES electronic_voucher_files(id) ON DELETE CASCADE
)`,
  electronic_voucher_verifications: `CREATE TABLE IF NOT EXISTS electronic_voucher_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(verification_status IN ('pending', 'verified', 'failed')),
  verification_method TEXT DEFAULT NULL,
  verification_message TEXT DEFAULT NULL,
  verified_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (record_id) REFERENCES electronic_voucher_records(id) ON DELETE CASCADE
)`,
  voucher_source_links: `CREATE TABLE IF NOT EXISTS voucher_source_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_record_id INTEGER NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(voucher_id, source_type, source_record_id),
  FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE
)`,
  archive_exports: `CREATE TABLE IF NOT EXISTS archive_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  fiscal_year TEXT NOT NULL,
  export_path TEXT NOT NULL,
  manifest_path TEXT NOT NULL,
  checksum TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK(status IN ('generated', 'validated', 'failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT DEFAULT NULL
)`,
  backup_packages: `CREATE TABLE IF NOT EXISTS backup_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  backup_period TEXT DEFAULT NULL,
  fiscal_year TEXT DEFAULT NULL,
  package_type TEXT NOT NULL DEFAULT 'system_db_snapshot_legacy'
    CHECK(package_type IN ('ledger_backup', 'system_db_snapshot_legacy')),
  package_schema_version TEXT NOT NULL DEFAULT '1.0',
  backup_path TEXT NOT NULL,
  manifest_path TEXT DEFAULT NULL,
  checksum TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'generated'
    CHECK(status IN ('generated', 'validated', 'failed')),
  created_by INTEGER DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT DEFAULT NULL
)`,
  report_snapshots: `CREATE TABLE IF NOT EXISTS report_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL,
  report_type TEXT NOT NULL
    CHECK(report_type IN ('balance_sheet', 'income_statement', 'activity_statement', 'cashflow_statement', 'equity_statement')),
  report_name TEXT NOT NULL,
  period TEXT NOT NULL,
  start_period TEXT NOT NULL DEFAULT '',
  end_period TEXT NOT NULL DEFAULT '',
  as_of_date TEXT DEFAULT NULL,
  include_unposted_vouchers INTEGER NOT NULL DEFAULT 0,
  generated_by INTEGER DEFAULT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  content_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by) REFERENCES users(id)
)`,
  migration_conflicts: `CREATE TABLE IF NOT EXISTS migration_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  migration_version INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  row_json TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(migration_version, table_name, source_key, reason)
)`
}

export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_subjects_ledger ON subjects(ledger_id);
CREATE INDEX IF NOT EXISTS idx_subject_aux_categories_subject ON subject_auxiliary_categories(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_aux_custom_items_subject ON subject_auxiliary_custom_items(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_aux_custom_items_aux_item ON subject_auxiliary_custom_items(auxiliary_item_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_ledger_period ON vouchers(ledger_id, period);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_unique_active_number
  ON vouchers(ledger_id, period, voucher_word, voucher_number)
  WHERE status <> 3;
CREATE INDEX IF NOT EXISTS idx_voucher_entries_voucher ON voucher_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_logs_module_action ON operation_logs(module, action);
CREATE INDEX IF NOT EXISTS idx_operation_logs_ledger_user ON operation_logs(ledger_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_electronic_voucher_records_fingerprint
  ON electronic_voucher_records(ledger_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_electronic_voucher_records_file ON electronic_voucher_records(file_id);
CREATE INDEX IF NOT EXISTS idx_electronic_voucher_verifications_record
  ON electronic_voucher_verifications(record_id);
CREATE INDEX IF NOT EXISTS idx_voucher_source_links_source
  ON voucher_source_links(source_type, source_record_id);
CREATE INDEX IF NOT EXISTS idx_archive_exports_ledger_year ON archive_exports(ledger_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_backup_packages_ledger_year ON backup_packages(ledger_id, fiscal_year);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_ledger_period
  ON report_snapshots(ledger_id, period);
CREATE INDEX IF NOT EXISTS idx_report_snapshots_ledger_type
  ON report_snapshots(ledger_id, report_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_snapshots_unique_scope
  ON report_snapshots(ledger_id, report_type, period);
CREATE INDEX IF NOT EXISTS idx_user_ledger_permissions_user ON user_ledger_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ledger_permissions_ledger ON user_ledger_permissions(ledger_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_initial_balances_ledger_period ON initial_balances(ledger_id, period);
CREATE INDEX IF NOT EXISTS idx_cash_flow_mappings_ledger ON cash_flow_mappings(ledger_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_flow_mappings_unique
  ON cash_flow_mappings(ledger_id, subject_code, counterpart_subject_code, entry_direction);
`

export function createCurrentSchema(db: Database.Database, version = CURRENT_SCHEMA_VERSION): void {
  db.exec(Object.values(TABLE_SQL).join(';\n') + ';' + INDEX_SQL)
  if (version >= 3) migrateAuthRevision(db)
}

import type Database from 'better-sqlite3'
import { TABLE_SQL, INDEX_SQL } from './schema'
import { archiveRows, getColumnNames, getSchemaObjects, quoteIdentifier } from './migrationSchema'

// 仅覆盖仓库已有 ensure 支持的历史列差异，缺失其他字段不猜测数据。
const LEGACY_DEFAULTS: Record<string, Record<string, string>> = {
  ledgers: { taxpayer_identification_number: "''" },
  vouchers: {
    deleted_from_status: 'NULL', posted_at: 'NULL', emergency_reversal_reason: 'NULL',
    emergency_reversal_by: 'NULL', emergency_reversal_at: 'NULL', reversal_approval_tag: 'NULL'
  },
  initial_balances: { period: '(SELECT start_period FROM ledgers WHERE id = s.ledger_id)' },
  cash_flow_mappings: { counterpart_subject_code: "''", entry_direction: "'inflow'" },
  backup_packages: {
    package_type: "'system_db_snapshot_legacy'", package_schema_version: "'1.0'",
    manifest_path: 'NULL', backup_period: 'NULL'
  },
  archive_exports: { validated_at: 'NULL' },
  report_snapshots: { start_period: "''", end_period: "''", as_of_date: 'NULL', include_unposted_vouchers: '0', content_json: "'{}'" }
}

export function validateLegacyObjects(db: Database.Database): void {
  const knownIndexes = new Set([...INDEX_SQL.matchAll(/INDEX IF NOT EXISTS (\w+)/g)].map(match => match[1]))
  knownIndexes.add('idx_vouchers_unique_number')
  for (const object of getSchemaObjects(db)) {
    if (object.type === 'table' && TABLE_SQL[object.name]) continue
    if (object.type === 'index' && knownIndexes.has(object.name)) continue
    throw new Error(`不支持的历史 schema 对象：${object.type} ${object.name}，请在副本上人工评估`)
  }
}

export function migrateLegacyStructure(db: Database.Database): void {
  validateLegacyObjects(db)
  const hadAccessTable = getColumnNames(db, 'user_ledger_permissions').length > 0
  db.exec(TABLE_SQL.migration_conflicts)
  for (const [table, sql] of Object.entries(TABLE_SQL)) {
    const oldColumns = getColumnNames(db, table)
    if (oldColumns.length === 0) {
      db.exec(sql)
      continue
    }
    const temporary = `__migration_${table}`
    db.exec(sql.replace(`IF NOT EXISTS ${table}`, quoteIdentifier(temporary)))
    const columns = getColumnNames(db, temporary)
    const unknown = oldColumns.filter(column => !columns.includes(column))
    if (unknown.length) throw new Error(`历史表 ${table} 存在未知列：${unknown.join(', ')}，拒绝丢弃`)
    const missing = columns.filter(column => !oldColumns.includes(column) && !LEGACY_DEFAULTS[table]?.[column])
    if (missing.length) throw new Error(`历史表 ${table} 缺少必要列：${missing.join(', ')}`)

    let where = '1'
    const legacyCash = table === 'cash_flow_mappings' &&
      (!oldColumns.includes('counterpart_subject_code') || !oldColumns.includes('entry_direction'))
    if (legacyCash) {
      // 在任何填充/丢弃之前保存整条原记录，包含旧列的 NULL/缺失语义。
      const discarded = oldColumns.includes('counterpart_subject_code') ? "COALESCE(counterpart_subject_code, '') = ''" : '1'
      archiveRows(db, table, discarded, '旧现金流映射无对方科目，无法自动匹配而舍弃', 1)
      archiveRows(db, table, `NOT (${discarded})`, '旧现金流映射字段升级前原记录', 1)
      where = oldColumns.includes('counterpart_subject_code') ? "COALESCE(s.counterpart_subject_code, '') <> ''" : '0'
    }
    if (table === 'subjects') {
      archiveRows(db, table, "category IN ('equity', 'profit_loss') AND ledger_id IN (SELECT id FROM ledgers WHERE standard_type = 'npo')", '民非科目分类升级前原记录', 1)
    }
    const projections = columns.map(column => {
      if (!oldColumns.includes(column)) return LEGACY_DEFAULTS[table][column]
      if (table === 'subjects' && column === 'category') return `CASE
        WHEN (SELECT standard_type FROM ledgers WHERE id = s.ledger_id) = 'npo' AND s.category = 'equity' THEN 'net_assets'
        WHEN (SELECT standard_type FROM ledgers WHERE id = s.ledger_id) = 'npo' AND s.category = 'profit_loss' THEN CASE WHEN s.balance_direction = -1 THEN 'income' ELSE 'expense' END
        ELSE s.category END`
      if (legacyCash && column === 'entry_direction') return "COALESCE(NULLIF(s.entry_direction, ''), 'inflow')"
      return `s.${quoteIdentifier(column)}`
    })
    const sequence = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').safeIntegers().get(table) as { seq: bigint } | undefined
    db.exec(`INSERT INTO ${quoteIdentifier(temporary)} (${columns.map(quoteIdentifier).join(',')})
      SELECT ${projections.join(',')} FROM ${quoteIdentifier(table)} s WHERE ${where}`)
    db.exec(`DROP TABLE ${quoteIdentifier(table)}; ALTER TABLE ${quoteIdentifier(temporary)} RENAME TO ${quoteIdentifier(table)};`)
    if (sequence) {
      db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(sequence.seq, table)
      db.prepare('INSERT INTO sqlite_sequence(name, seq) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = ?)').run(table, sequence.seq, table)
    }
  }
  if (!hadAccessTable) {
    db.exec(`INSERT INTO user_ledger_permissions(user_id, ledger_id)
      SELECT u.id, l.id FROM users u CROSS JOIN ledgers l WHERE u.is_admin = 0`)
  }
}

export function migrateLegacyDataAndIndexes(db: Database.Database): void {
  const updates = [
    ["start_period = REPLACE(period, '.', '-')", "start_period = '' AND REPLACE(period, '.', '-') GLOB '????-??'"],
    ["end_period = REPLACE(period, '.', '-')", "end_period = '' AND REPLACE(period, '.', '-') GLOB '????-??'"],
    ["start_period = substr(REPLACE(period, '.', '-'), 1, 7), end_period = substr(REPLACE(period, '.', '-'), 9, 7)", "(start_period = '' OR end_period = '') AND REPLACE(period, '.', '-') GLOB '????-??-????-??'"],
    ["as_of_date = date(start_period || '-01', '+1 month', '-1 day')", "as_of_date IS NULL AND report_type = 'balance_sheet' AND start_period GLOB '????-??'"]
  ]
  for (const [set, where] of updates) {
    archiveRows(db, 'report_snapshots', where, '报表期间元数据归一前原记录', 2)
    db.exec(`UPDATE report_snapshots SET ${set} WHERE ${where}`)
  }
  const duplicates = 'id NOT IN (SELECT MAX(id) FROM report_snapshots GROUP BY ledger_id, report_type, period)'
  archiveRows(db, 'report_snapshots', duplicates, '重复报表范围：保留同范围最大 id', 2)
  db.exec(`DELETE FROM report_snapshots WHERE ${duplicates}`)

  const ledgers = db.prepare('SELECT id, start_period, current_period FROM ledgers').all() as Array<{ id: number; start_period: string; current_period: string }>
  const earliest = db.prepare(`SELECT MIN(period) AS period FROM (
    SELECT period FROM periods WHERE ledger_id = ? UNION ALL SELECT period FROM vouchers WHERE ledger_id = ?
    UNION ALL SELECT period FROM initial_balances WHERE ledger_id = ?)`)
  for (const ledger of ledgers) {
    const row = earliest.get(ledger.id, ledger.id, ledger.id) as { period: string | null }
    const next = [ledger.start_period, ledger.current_period, row.period ?? ''].filter(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)).sort()[0]
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(ledger.start_period) && next && next < ledger.start_period) {
      archiveRows(db, 'ledgers', `id = ${ledger.id}`, '账套启用期间归一前原记录', 2)
      db.prepare('UPDATE ledgers SET start_period = ? WHERE id = ?').run(next, ledger.id)
    }
  }
  const conflict = db.prepare(`SELECT ledger_id, period, voucher_word, voucher_number FROM vouchers
    WHERE status <> 3 GROUP BY ledger_id, period, voucher_word, voucher_number HAVING COUNT(*) > 1 LIMIT 1`).get()
  if (conflict) throw new Error(`有效凭证存在重复编号，拒绝自动删除：${JSON.stringify(conflict)}`)
  const cashConflict = db.prepare(`SELECT ledger_id, subject_code, counterpart_subject_code, entry_direction FROM cash_flow_mappings
    GROUP BY ledger_id, subject_code, counterpart_subject_code, entry_direction HAVING COUNT(*) > 1 LIMIT 1`).get()
  if (cashConflict) throw new Error(`现金流量匹配规则重复，拒绝自动裁决：${JSON.stringify(cashConflict)}`)
  db.exec(INDEX_SQL)
}

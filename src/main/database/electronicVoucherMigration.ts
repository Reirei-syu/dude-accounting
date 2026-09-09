import type Database from 'better-sqlite3'

/** 不清理历史重复关联：唯一约束失败时由迁移框架回滚并保留恢复副本。 */
export function migrateElectronicVoucherWorkflow(db: Database.Database): void {
  if (
    !(db.pragma('table_info(electronic_voucher_records)') as Array<{ name: string }>).some(
      (column) => column.name === 'last_error'
    )
  ) {
    db.exec('ALTER TABLE electronic_voucher_records ADD COLUMN last_error TEXT DEFAULT NULL')
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_electronic_voucher_source_once
    ON voucher_source_links(source_record_id) WHERE source_type = 'electronic_voucher'`)
}

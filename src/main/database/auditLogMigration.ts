import type Database from 'better-sqlite3'

/** 表达式索引也属于严格 schema 契约，必须通过版本迁移进入旧库。 */
export function migrateAuditLogIndex(db: Database.Database): void {
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_operation_logs_audit_time ON operation_logs(julianday(created_at) DESC, id DESC)'
  )
}

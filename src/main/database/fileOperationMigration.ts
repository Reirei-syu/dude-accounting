import type Database from 'better-sqlite3'

export const FILE_OPERATION_COMMIT_SQL = `CREATE TABLE IF NOT EXISTS file_operation_commits (
  operation_id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_digest TEXT NOT NULL,
  committed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

export function migrateFileOperationCommits(db: Database.Database): void {
  db.exec(FILE_OPERATION_COMMIT_SQL)
}

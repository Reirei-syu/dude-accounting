import path from 'node:path'
import type Database from 'better-sqlite3'

export function getPathPreference(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined

  return row?.value ?? null
}

export function rememberPathPreference(
  db: Database.Database,
  key: string,
  targetPath: string
): void {
  const normalizedPath = path.extname(targetPath) ? path.dirname(targetPath) : targetPath

  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, normalizedPath)
}

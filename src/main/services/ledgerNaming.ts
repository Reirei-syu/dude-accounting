import type Database from 'better-sqlite3'

export function normalizeLedgerName(name: string): string {
  return name.trim()
}

export function assertLedgerNameAvailable(
  db: Database.Database,
  name: string,
  excludeLedgerId?: number
): void {
  const normalizedName = normalizeLedgerName(name)
  if (!normalizedName) {
    throw new Error('账套名称不能为空')
  }

  const duplicated = typeof excludeLedgerId === 'number'
    ? (db
        .prepare('SELECT id FROM ledgers WHERE name = ? AND id <> ? LIMIT 1')
        .get(normalizedName, excludeLedgerId) as { id: number } | undefined)
    : (db
        .prepare('SELECT id FROM ledgers WHERE name = ? LIMIT 1')
        .get(normalizedName) as { id: number } | undefined)

  if (duplicated) {
    throw new Error('已存在同名账套，请使用其他名称')
  }
}

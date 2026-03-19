import type Database from 'better-sqlite3'

export interface LedgerCatalogRow {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  created_at: string
}

export interface LedgerPeriodRow {
  id: number
  ledger_id: number
  period: string
  is_closed: number
  closed_at: string | null
}

export interface LedgerCatalogScope {
  userId: number
  isAdmin: boolean
}

export function listAccessibleLedgers(
  db: Database.Database,
  scope: LedgerCatalogScope
): LedgerCatalogRow[] {
  if (scope.isAdmin) {
    return db.prepare('SELECT * FROM ledgers ORDER BY created_at DESC').all() as LedgerCatalogRow[]
  }

  return db
    .prepare(
      `SELECT l.*
         FROM ledgers l
         INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = l.id
        WHERE ulp.user_id = ?
        ORDER BY l.created_at DESC`
    )
    .all(scope.userId) as LedgerCatalogRow[]
}

export function listLedgerPeriods(db: Database.Database, ledgerId: number): LedgerPeriodRow[] {
  return db
    .prepare('SELECT * FROM periods WHERE ledger_id = ? ORDER BY period')
    .all(ledgerId) as LedgerPeriodRow[]
}

import type Database from 'better-sqlite3'

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function isValidPeriod(period: string): boolean {
  return PERIOD_PATTERN.test(period)
}

export function updateLedgerStartPeriodIfEarlier(
  db: Database.Database,
  ledgerId: number,
  currentStartPeriod: string,
  candidatePeriod: string
): boolean {
  if (!isValidPeriod(currentStartPeriod) || !isValidPeriod(candidatePeriod)) {
    return false
  }

  if (candidatePeriod >= currentStartPeriod) {
    return false
  }

  db.prepare('UPDATE ledgers SET start_period = ? WHERE id = ?').run(candidatePeriod, ledgerId)
  return true
}

export function normalizeLedgerStartPeriods(db: Database.Database): number {
  const ledgers = db
    .prepare('SELECT id, start_period, current_period FROM ledgers')
    .all() as Array<{
    id: number
    start_period: string
    current_period: string
  }>

  const selectEarliestPeriodStmt = db.prepare(
    `SELECT MIN(period) AS period
     FROM (
       SELECT period FROM periods WHERE ledger_id = ?
       UNION ALL
       SELECT period FROM vouchers WHERE ledger_id = ?
       UNION ALL
       SELECT period FROM initial_balances WHERE ledger_id = ?
     )`
  )

  const normalize = db.transaction(() => {
    let updatedCount = 0

    for (const ledger of ledgers) {
      const earliestRow = selectEarliestPeriodStmt.get(ledger.id, ledger.id, ledger.id) as
        | { period: string | null }
        | undefined
      const candidates = [
        ledger.start_period,
        ledger.current_period,
        earliestRow?.period ?? ''
      ].filter(isValidPeriod)

      if (candidates.length === 0) {
        continue
      }

      const normalizedStartPeriod = candidates.sort()[0]
      if (
        updateLedgerStartPeriodIfEarlier(db, ledger.id, ledger.start_period, normalizedStartPeriod)
      ) {
        updatedCount += 1
      }
    }

    return updatedCount
  })

  return normalize()
}

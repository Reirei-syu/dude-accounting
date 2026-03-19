import { describe, expect, it } from 'vitest'
import { listAccessibleLedgers, listLedgerPeriods } from './ledgerCatalog'

type FakeLedgerRow = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  created_at: string
}

type FakePeriodRow = {
  id: number
  ledger_id: number
  period: string
  is_closed: number
  closed_at: string | null
}

class FakeLedgerCatalogDb {
  ledgers: FakeLedgerRow[] = []
  periods: FakePeriodRow[] = []
  permissions: Array<{ user_id: number; ledger_id: number }> = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT * FROM ledgers ORDER BY created_at DESC') {
      return {
        all: () =>
          [...this.ledgers].sort((left, right) => right.created_at.localeCompare(left.created_at))
      }
    }

    if (
      normalized ===
      'SELECT l.* FROM ledgers l INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = l.id WHERE ulp.user_id = ? ORDER BY l.created_at DESC'
    ) {
      return {
        all: (userId) => {
          const allowedLedgerIds = new Set(
            this.permissions
              .filter((item) => item.user_id === Number(userId))
              .map((item) => item.ledger_id)
          )

          return this.ledgers
            .filter((ledger) => allowedLedgerIds.has(ledger.id))
            .sort((left, right) => right.created_at.localeCompare(left.created_at))
        }
      }
    }

    if (normalized === 'SELECT * FROM periods WHERE ledger_id = ? ORDER BY period') {
      return {
        all: (ledgerId) =>
          this.periods
            .filter((period) => period.ledger_id === Number(ledgerId))
            .sort((left, right) => left.period.localeCompare(right.period))
      }
    }

    throw new Error(`Unhandled SQL in FakeLedgerCatalogDb: ${normalized}`)
  }
}

describe('ledgerCatalog service', () => {
  it('lists accessible ledgers by admin or permission scope', () => {
    const db = new FakeLedgerCatalogDb()
    db.ledgers.push(
      {
        id: 1,
        name: '甲账套',
        standard_type: 'enterprise',
        start_period: '2026-01',
        current_period: '2026-03',
        created_at: '2026-03-19 09:00:00'
      },
      {
        id: 2,
        name: '乙账套',
        standard_type: 'npo',
        start_period: '2026-02',
        current_period: '2026-03',
        created_at: '2026-03-19 10:00:00'
      }
    )
    db.permissions.push({ user_id: 100, ledger_id: 1 })

    expect(
      listAccessibleLedgers(db as never, {
        userId: 1,
        isAdmin: true
      }).map((ledger) => ledger.id)
    ).toEqual([2, 1])

    expect(
      listAccessibleLedgers(db as never, {
        userId: 100,
        isAdmin: false
      }).map((ledger) => ledger.id)
    ).toEqual([1])
  })

  it('lists ledger periods in ascending period order', () => {
    const db = new FakeLedgerCatalogDb()
    db.periods.push(
      { id: 2, ledger_id: 1, period: '2026-03', is_closed: 0, closed_at: null },
      { id: 1, ledger_id: 1, period: '2026-01', is_closed: 1, closed_at: '2026-02-01 00:00:00' },
      { id: 3, ledger_id: 2, period: '2026-02', is_closed: 0, closed_at: null }
    )

    expect(listLedgerPeriods(db as never, 1).map((period) => period.period)).toEqual([
      '2026-01',
      '2026-03'
    ])
  })
})

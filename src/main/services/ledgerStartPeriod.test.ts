import { describe, expect, it } from 'vitest'
import { normalizeLedgerStartPeriods, updateLedgerStartPeriodIfEarlier } from './ledgerStartPeriod'

class FakeLedgerStartPeriodDb {
  ledgers: Array<{ id: number; start_period: string; current_period: string }> = []
  periods: Array<{ ledger_id: number; period: string }> = []
  vouchers: Array<{ ledger_id: number; period: string }> = []
  initialBalances: Array<{ ledger_id: number; period: string }> = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT id, start_period, current_period FROM ledgers') {
      return {
        all: () => this.ledgers.map((ledger) => ({ ...ledger })),
        get: () => undefined,
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT MIN(period) AS period FROM ( SELECT period FROM periods WHERE ledger_id = ? UNION ALL SELECT period FROM vouchers WHERE ledger_id = ? UNION ALL SELECT period FROM initial_balances WHERE ledger_id = ? )'
    ) {
      return {
        all: () => [],
        get: (periodLedgerId, voucherLedgerId, initialBalanceLedgerId) => {
          const ledgerId = Number(periodLedgerId)
          const values = [
            ...this.periods.filter((row) => row.ledger_id === ledgerId).map((row) => row.period),
            ...this.vouchers
              .filter((row) => row.ledger_id === Number(voucherLedgerId))
              .map((row) => row.period),
            ...this.initialBalances
              .filter((row) => row.ledger_id === Number(initialBalanceLedgerId))
              .map((row) => row.period)
          ].sort()

          return {
            period: values[0] ?? null
          }
        },
        run: () => ({ changes: 0 })
      }
    }

    if (normalized === 'UPDATE ledgers SET start_period = ? WHERE id = ?') {
      return {
        all: () => [],
        get: () => undefined,
        run: (startPeriod, ledgerId) => {
          const ledger = this.ledgers.find((row) => row.id === Number(ledgerId))
          if (!ledger) {
            return { changes: 0 }
          }

          ledger.start_period = String(startPeriod)
          return { changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeLedgerStartPeriodDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }
}

describe('ledgerStartPeriod service', () => {
  it('updates start period only when candidate is earlier and valid', () => {
    const db = new FakeLedgerStartPeriodDb()
    db.ledgers.push({ id: 1, start_period: '2026-03', current_period: '2026-06' })

    expect(updateLedgerStartPeriodIfEarlier(db as never, 1, '2026-03', '2026-01')).toBe(true)
    expect(db.ledgers[0]?.start_period).toBe('2026-01')

    expect(updateLedgerStartPeriodIfEarlier(db as never, 1, '2026-01', '2026-04')).toBe(false)
    expect(updateLedgerStartPeriodIfEarlier(db as never, 1, '2026-01', 'invalid')).toBe(false)
  })

  it('normalizes all ledgers in a single startup pass', () => {
    const db = new FakeLedgerStartPeriodDb()
    db.ledgers.push(
      { id: 1, start_period: '2026-03', current_period: '2026-06' },
      { id: 2, start_period: '2025-01', current_period: '2025-03' }
    )
    db.periods.push({ ledger_id: 1, period: '2026-02' })
    db.vouchers.push({ ledger_id: 1, period: '2026-01' })
    db.initialBalances.push({ ledger_id: 2, period: '2025-01' })

    const updatedCount = normalizeLedgerStartPeriods(db as never)

    expect(updatedCount).toBe(1)
    expect(db.ledgers).toEqual([
      { id: 1, start_period: '2026-01', current_period: '2026-06' },
      { id: 2, start_period: '2025-01', current_period: '2025-03' }
    ])
  })
})

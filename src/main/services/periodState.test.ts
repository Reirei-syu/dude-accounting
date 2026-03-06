import { describe, expect, it } from 'vitest'
import {
  assertPeriodReopenAllowed,
  assertPeriodWritable,
  buildClosedPeriodPendingVoucherMessage,
  buildClosedPeriodVoucherEditMessage,
  getNextPeriod,
  getPeriodStatusSummary
} from './periodState'

type PeriodRow = {
  ledger_id: number
  period: string
  is_closed: number
  closed_at: string | null
}

type VoucherRow = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: number
}

class FakePeriodDb {
  periods: PeriodRow[] = []
  vouchers: VoucherRow[] = []

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT is_closed, closed_at FROM periods WHERE ledger_id = ? AND period = ?') {
      return {
        get: (ledgerId, period) =>
          this.periods.find(
            (row) => row.ledger_id === Number(ledgerId) && row.period === String(period)
          ),
        all: () => []
      }
    }

    if (
      normalized ===
      'SELECT id, voucher_number, voucher_word, status FROM vouchers WHERE ledger_id = ? AND period = ? AND status IN (0, 1) ORDER BY voucher_date ASC, voucher_number ASC, id ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, period) =>
          this.vouchers
            .filter(
              (row) =>
                row.ledger_id === Number(ledgerId) &&
                row.period === String(period) &&
                (row.status === 0 || row.status === 1)
            )
            .slice()
            .sort((left, right) => {
              if (left.voucher_date !== right.voucher_date) {
                return left.voucher_date.localeCompare(right.voucher_date)
              }
              if (left.voucher_number !== right.voucher_number) {
                return left.voucher_number - right.voucher_number
              }
              return left.id - right.id
            })
            .map((row) => ({
              id: row.id,
              voucher_number: row.voucher_number,
              voucher_word: row.voucher_word,
              status: row.status
            }))
      }
    }

    if (
      normalized ===
      'SELECT period FROM periods WHERE ledger_id = ? AND period > ? AND is_closed = 1 ORDER BY period ASC LIMIT 1'
    ) {
      return {
        get: (ledgerId, period) =>
          this.periods
            .filter(
              (row) =>
                row.ledger_id === Number(ledgerId) &&
                row.period > String(period) &&
                row.is_closed === 1
            )
            .slice()
            .sort((left, right) => left.period.localeCompare(right.period))[0],
        all: () => []
      }
    }

    throw new Error(`Unhandled SQL in FakePeriodDb: ${normalized}`)
  }
}

function createTestDb(): FakePeriodDb {
  return new FakePeriodDb()
}

describe('periodState service', () => {
  it('computes the next accounting period across month and year boundaries', () => {
    expect(getNextPeriod('2026-03')).toBe('2026-04')
    expect(getNextPeriod('2026-12')).toBe('2027-01')
  })

  it('summarizes closed status and pending vouchers for the current period', () => {
    const db = createTestDb()

    db.periods.push({
      ledger_id: 1,
      period: '2026-03',
      is_closed: 1,
      closed_at: '2026-03-31 23:59:59'
    })

    db.vouchers.push(
      {
        id: 1,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-05',
        voucher_number: 1,
        voucher_word: '记',
        status: 0
      },
      {
        id: 2,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-08',
        voucher_number: 2,
        voucher_word: '记',
        status: 1
      },
      {
        id: 3,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-10',
        voucher_number: 3,
        voucher_word: '记',
        status: 2
      }
    )

    const summary = getPeriodStatusSummary(db as never, 1, '2026-03')

    expect(summary).toEqual({
      period: '2026-03',
      is_closed: 1,
      closed_at: '2026-03-31 23:59:59',
      pending_audit_vouchers: [
        {
          id: 1,
          voucher_number: 1,
          voucher_word: '记',
          status: 0,
          voucher_label: '记-0001'
        }
      ],
      pending_bookkeep_vouchers: [
        {
          id: 2,
          voucher_number: 2,
          voucher_word: '记',
          status: 1,
          voucher_label: '记-0002'
        }
      ]
    })
  })

  it('builds the closed-period prompt for pending vouchers', () => {
    const message = buildClosedPeriodPendingVoucherMessage({
      period: '2026-03',
      pending_audit_vouchers: [
        {
          id: 11,
          voucher_number: 3,
          voucher_word: '记',
          status: 0,
          voucher_label: '记-0003'
        }
      ],
      pending_bookkeep_vouchers: [
        {
          id: 12,
          voucher_number: 4,
          voucher_word: '记',
          status: 1,
          voucher_label: '记-0004'
        }
      ]
    })

    expect(message).toBe(
      '当前期间存在未审核凭证：记-0003；已审核未记账凭证：记-0004。结账后这些凭证仅可删除，如需继续编辑请先反结账。'
    )
  })

  it('blocks voucher writes once the period has been closed', () => {
    const db = createTestDb()

    db.periods.push({
      ledger_id: 1,
      period: '2026-03',
      is_closed: 1,
      closed_at: '2026-03-31 23:59:59'
    })

    expect(() => assertPeriodWritable(db as never, 1, '2026-03')).toThrow(
      buildClosedPeriodVoucherEditMessage('2026-03')
    )
  })

  it('prevents reopening a period when a later period is already closed', () => {
    const db = createTestDb()

    db.periods.push(
      {
        ledger_id: 1,
        period: '2026-03',
        is_closed: 1,
        closed_at: '2026-03-31 23:59:59'
      },
      {
        ledger_id: 1,
        period: '2026-04',
        is_closed: 1,
        closed_at: '2026-04-30 23:59:59'
      }
    )

    expect(() => assertPeriodReopenAllowed(db as never, 1, '2026-03')).toThrow(
      '存在后续已结账期间（2026-04），请先反结账后续期间。'
    )
  })
})

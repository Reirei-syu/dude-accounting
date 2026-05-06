import { describe, expect, it } from 'vitest'
import {
  renumberVoucherNumbers,
  VoucherNumberRenumberValidationError,
  type VoucherNumberRow
} from './voucherNumberLifecycle'

class FakeVoucherNumberDb {
  vouchers: VoucherNumberRow[] = []
  updateCalls: Array<{ voucherId: number; voucherNumber: number }> = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized.startsWith(
        'SELECT id, ledger_id, period, voucher_date, voucher_number, voucher_word, status, deleted_from_status FROM vouchers WHERE ledger_id = ? AND period = ?'
      )
    ) {
      return {
        all: (ledgerId, period) =>
          this.vouchers
            .filter(
              (voucher) =>
                voucher.ledgerId === Number(ledgerId) && voucher.period === String(period)
            )
            .map((voucher) => ({
              id: voucher.id,
              ledger_id: voucher.ledgerId,
              period: voucher.period,
              voucher_date: voucher.voucherDate,
              voucher_number: voucher.voucherNumber,
              voucher_word: voucher.voucherWord,
              status: voucher.status,
              deleted_from_status: voucher.deletedFromStatus
            })),
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized ===
      "UPDATE vouchers SET voucher_number = ?, updated_at = datetime('now') WHERE id = ?"
    ) {
      return {
        all: () => [],
        run: (voucherNumber, voucherId) => {
          const voucher = this.vouchers.find((item) => item.id === Number(voucherId))
          if (!voucher) {
            return { changes: 0 }
          }

          const duplicate = this.vouchers.find(
            (item) =>
              item.id !== voucher.id &&
              item.status !== 3 &&
              voucher.status !== 3 &&
              item.ledgerId === voucher.ledgerId &&
              item.period === voucher.period &&
              item.voucherWord === voucher.voucherWord &&
              item.voucherNumber === Number(voucherNumber)
          )
          if (duplicate) {
            throw new Error(
              'UNIQUE constraint failed: vouchers.ledger_id, vouchers.period, vouchers.voucher_word, vouchers.voucher_number'
            )
          }

          voucher.voucherNumber = Number(voucherNumber)
          this.updateCalls.push({
            voucherId: voucher.id,
            voucherNumber: Number(voucherNumber)
          })
          return { changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeVoucherNumberDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }
}

function createVoucher(overrides: Partial<VoucherNumberRow>): VoucherNumberRow {
  return {
    id: 1,
    ledgerId: 1,
    period: '2026-01',
    voucherDate: '2026-01-01',
    voucherNumber: 1,
    voucherWord: '记',
    status: 0,
    deletedFromStatus: null,
    ...overrides
  }
}

describe('voucherNumberLifecycle service', () => {
  it('renumbers active normal and carry-forward vouchers by voucher word without changing deleted rows', () => {
    const db = new FakeVoucherNumberDb()
    db.vouchers.push(
      createVoucher({ id: 1, voucherNumber: 1, voucherWord: '记', status: 0 }),
      createVoucher({ id: 2, voucherNumber: 3, voucherWord: '记', status: 1 }),
      createVoucher({
        id: 3,
        voucherNumber: 2,
        voucherWord: '记',
        status: 3,
        deletedFromStatus: 0
      }),
      createVoucher({ id: 4, voucherNumber: 1, voucherWord: '结', status: 0 }),
      createVoucher({ id: 5, voucherNumber: 3, voucherWord: '结', status: 1 })
    )

    const result = renumberVoucherNumbers(db as never, 1, '2026-01')

    expect(result).toMatchObject({
      ledgerId: 1,
      period: '2026-01',
      totalCount: 4,
      updatedCount: 2,
      groups: [
        {
          voucherWord: '记',
          totalCount: 3,
          activeCount: 2,
          deletedCount: 1,
          updatedCount: 1,
          firstNumber: 1,
          lastNumber: 2
        },
        {
          voucherWord: '结',
          totalCount: 2,
          activeCount: 2,
          deletedCount: 0,
          updatedCount: 1,
          firstNumber: 1,
          lastNumber: 2
        }
      ]
    })
    expect(result.changes).toEqual([
      expect.objectContaining({ voucherId: 2, oldNumber: 3, newNumber: 2 }),
      expect.objectContaining({ voucherId: 5, oldNumber: 3, newNumber: 2 })
    ])
    expect(db.vouchers.map((voucher) => [voucher.id, voucher.voucherNumber])).toEqual([
      [1, 1],
      [2, 2],
      [3, 2],
      [4, 1],
      [5, 2]
    ])
  })

  it('does not write when voucher numbers are already continuous', () => {
    const db = new FakeVoucherNumberDb()
    db.vouchers.push(
      createVoucher({ id: 1, voucherNumber: 1, voucherWord: '记', status: 0 }),
      createVoucher({ id: 2, voucherNumber: 2, voucherWord: '记', status: 1 }),
      createVoucher({
        id: 3,
        voucherNumber: 3,
        voucherWord: '记',
        status: 3,
        deletedFromStatus: 1
      })
    )

    const result = renumberVoucherNumbers(db as never, 1, '2026-01')

    expect(result.updatedCount).toBe(0)
    expect(result.changes).toEqual([])
    expect(db.updateCalls).toEqual([])
  })

  it('uses temporary numbers before final numbers so soft-deleted rows do not violate the unique index', () => {
    const db = new FakeVoucherNumberDb()
    db.vouchers.push(
      createVoucher({ id: 1, voucherNumber: 1, voucherWord: '记', status: 0 }),
      createVoucher({
        id: 2,
        voucherNumber: 2,
        voucherWord: '记',
        status: 3,
        deletedFromStatus: 0
      }),
      createVoucher({ id: 3, voucherNumber: 3, voucherWord: '记', status: 1 })
    )

    expect(() => renumberVoucherNumbers(db as never, 1, '2026-01')).not.toThrow()
    expect(db.vouchers.map((voucher) => [voucher.id, voucher.voucherNumber])).toEqual([
      [1, 1],
      [2, 2],
      [3, 2]
    ])
    expect(db.updateCalls.slice(0, 2).every((call) => call.voucherNumber < 0)).toBe(true)
  })

  it('blocks active posted vouchers and deleted vouchers that came from posted state', () => {
    const postedDb = new FakeVoucherNumberDb()
    postedDb.vouchers.push(createVoucher({ id: 1, status: 2 }))

    expect(() => renumberVoucherNumbers(postedDb as never, 1, '2026-01')).toThrow(
      VoucherNumberRenumberValidationError
    )
    expect(() => renumberVoucherNumbers(postedDb as never, 1, '2026-01')).toThrow(
      '存在已记账凭证，不允许整理凭证号'
    )

    const deletedPostedDb = new FakeVoucherNumberDb()
    deletedPostedDb.vouchers.push(
      createVoucher({ id: 2, status: 3, deletedFromStatus: 2, voucherNumber: 2 })
    )

    expect(() => renumberVoucherNumbers(deletedPostedDb as never, 1, '2026-01')).toThrow(
      VoucherNumberRenumberValidationError
    )
    expect(() => renumberVoucherNumbers(deletedPostedDb as never, 1, '2026-01')).toThrow(
      '存在历史已记账的删除态凭证，不允许整理凭证号'
    )
  })
})

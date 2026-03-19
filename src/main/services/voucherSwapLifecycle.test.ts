import { describe, expect, it } from 'vitest'
import {
  applyVoucherSwapPlan,
  buildVoucherSwapPlan,
  listVoucherSwapEntriesByVoucherId,
  listVoucherSwapVouchers,
  type VoucherSwapEntry,
  type VoucherSwapVoucher
} from './voucherSwapLifecycle'

class FakeVoucherSwapDb {
  vouchers: Array<{
    id: number
    ledger_id: number
    period: string
    voucher_date: string
    status: number
    creator_id: number | null
    auditor_id: number | null
    bookkeeper_id: number | null
    attachment_count: number
    is_carry_forward: number
  }> = []
  entries: Array<{
    id: number
    voucher_id: number
    row_order: number
    summary: string
    subject_code: string
    debit_amount: number
    credit_amount: number
    auxiliary_item_id: number | null
    cash_flow_item_id: number | null
  }> = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized.startsWith(
        'SELECT id, ledger_id, period, voucher_date, status, creator_id, auditor_id, bookkeeper_id, attachment_count, is_carry_forward FROM vouchers WHERE id IN ('
      )
    ) {
      return {
        all: (...voucherIds) =>
          this.vouchers.filter((voucher) => voucherIds.map(Number).includes(voucher.id)),
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized.startsWith(
        'SELECT voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, auxiliary_item_id, cash_flow_item_id FROM voucher_entries WHERE voucher_id IN ('
      )
    ) {
      return {
        all: (...voucherIds) =>
          this.entries
            .filter((entry) => voucherIds.map(Number).includes(entry.voucher_id))
            .sort(
              (left, right) =>
                left.voucher_id - right.voucher_id ||
                left.row_order - right.row_order ||
                left.id - right.id
            ),
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized ===
      "UPDATE vouchers SET voucher_date = ?, status = ?, creator_id = ?, auditor_id = ?, bookkeeper_id = ?, attachment_count = ?, is_carry_forward = ?, updated_at = datetime('now') WHERE id = ?"
    ) {
      return {
        all: () => [],
        run: (
          voucherDate,
          status,
          creatorId,
          auditorId,
          bookkeeperId,
          attachmentCount,
          isCarryForward,
          voucherId
        ) => {
          const voucher = this.vouchers.find((item) => item.id === Number(voucherId))
          if (!voucher) {
            return { changes: 0 }
          }
          voucher.voucher_date = String(voucherDate)
          voucher.status = Number(status)
          voucher.creator_id = creatorId === null ? null : Number(creatorId)
          voucher.auditor_id = auditorId === null ? null : Number(auditorId)
          voucher.bookkeeper_id = bookkeeperId === null ? null : Number(bookkeeperId)
          voucher.attachment_count = Number(attachmentCount)
          voucher.is_carry_forward = Number(isCarryForward)
          return { changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM voucher_entries WHERE voucher_id = ?') {
      return {
        all: () => [],
        run: (voucherId) => {
          const before = this.entries.length
          this.entries = this.entries.filter((entry) => entry.voucher_id !== Number(voucherId))
          return { changes: before - this.entries.length }
        }
      }
    }

    if (
      normalized ===
      'INSERT INTO voucher_entries ( voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, auxiliary_item_id, cash_flow_item_id ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ) {
      return {
        all: () => [],
        run: (
          voucherId,
          rowOrder,
          summary,
          subjectCode,
          debitAmount,
          creditAmount,
          auxiliaryItemId,
          cashFlowItemId
        ) => {
          this.entries.push({
            id: this.entries.length + 100,
            voucher_id: Number(voucherId),
            row_order: Number(rowOrder),
            summary: String(summary),
            subject_code: String(subjectCode),
            debit_amount: Number(debitAmount),
            credit_amount: Number(creditAmount),
            auxiliary_item_id: auxiliaryItemId === null ? null : Number(auxiliaryItemId),
            cash_flow_item_id: cashFlowItemId === null ? null : Number(cashFlowItemId)
          })
          return { changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeVoucherSwapDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }
}

const createVoucher = (overrides: Partial<VoucherSwapVoucher>): VoucherSwapVoucher => ({
  id: 1,
  ledgerId: 1,
  period: '2026-03',
  voucherDate: '2026-03-01',
  status: 0,
  creatorId: 11,
  auditorId: null,
  bookkeeperId: null,
  attachmentCount: 0,
  isCarryForward: 0,
  ...overrides
})

const createEntry = (overrides: Partial<VoucherSwapEntry>): VoucherSwapEntry => ({
  rowOrder: 1,
  summary: '摘要',
  subjectCode: '1001',
  debitAmount: 1000,
  creditAmount: 0,
  auxiliaryItemId: null,
  cashFlowItemId: null,
  ...overrides
})

describe('voucherSwapLifecycle service', () => {
  it('lists swap vouchers and grouped entries', () => {
    const db = new FakeVoucherSwapDb()
    db.vouchers.push(
      {
        id: 1,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-01',
        status: 0,
        creator_id: 11,
        auditor_id: null,
        bookkeeper_id: null,
        attachment_count: 0,
        is_carry_forward: 0
      },
      {
        id: 2,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-02',
        status: 1,
        creator_id: 12,
        auditor_id: 13,
        bookkeeper_id: null,
        attachment_count: 2,
        is_carry_forward: 0
      }
    )
    db.entries.push(
      {
        id: 1,
        voucher_id: 1,
        row_order: 1,
        summary: '甲',
        subject_code: '1001',
        debit_amount: 8800,
        credit_amount: 0,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      },
      {
        id: 2,
        voucher_id: 2,
        row_order: 1,
        summary: '乙',
        subject_code: '6001',
        debit_amount: 0,
        credit_amount: 8800,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      }
    )

    const vouchers = listVoucherSwapVouchers(db as never, [1, 2])
    const groupedEntries = listVoucherSwapEntriesByVoucherId(db as never, [1, 2])

    expect(vouchers).toHaveLength(2)
    expect(vouchers[0]).toMatchObject({ id: 1, ledgerId: 1, voucherDate: '2026-03-01' })
    expect(groupedEntries.get(1)).toEqual([
      {
        rowOrder: 1,
        summary: '甲',
        subjectCode: '1001',
        debitAmount: 8800,
        creditAmount: 0,
        auxiliaryItemId: null,
        cashFlowItemId: null
      }
    ])
  })

  it('applies swap plan to vouchers and entries', () => {
    const db = new FakeVoucherSwapDb()
    db.vouchers.push(
      {
        id: 101,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-05',
        status: 0,
        creator_id: 1,
        auditor_id: null,
        bookkeeper_id: null,
        attachment_count: 1,
        is_carry_forward: 0
      },
      {
        id: 202,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-18',
        status: 2,
        creator_id: 8,
        auditor_id: 9,
        bookkeeper_id: 10,
        attachment_count: 3,
        is_carry_forward: 1
      }
    )
    db.entries.push(
      {
        id: 1,
        voucher_id: 101,
        row_order: 1,
        summary: '甲',
        subject_code: '1001',
        debit_amount: 8800,
        credit_amount: 0,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      },
      {
        id: 2,
        voucher_id: 202,
        row_order: 1,
        summary: '乙',
        subject_code: '6001',
        debit_amount: 0,
        credit_amount: 8800,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      }
    )

    const plan = buildVoucherSwapPlan(
      createVoucher({
        id: 101,
        voucherDate: '2026-03-05',
        status: 0,
        creatorId: 1,
        attachmentCount: 1,
        isCarryForward: 0
      }),
      createVoucher({
        id: 202,
        voucherDate: '2026-03-18',
        status: 2,
        creatorId: 8,
        auditorId: 9,
        bookkeeperId: 10,
        attachmentCount: 3,
        isCarryForward: 1
      }),
      [createEntry({ summary: '甲', subjectCode: '1001', debitAmount: 8800 })],
      [createEntry({ summary: '乙', subjectCode: '6001', debitAmount: 0, creditAmount: 8800 })]
    )

    applyVoucherSwapPlan(db as never, plan)

    expect(db.vouchers[0]).toMatchObject({
      id: 101,
      voucher_date: '2026-03-18',
      status: 2,
      creator_id: 8,
      auditor_id: 9,
      bookkeeper_id: 10
    })
    expect(db.vouchers[1]).toMatchObject({
      id: 202,
      voucher_date: '2026-03-05',
      status: 0,
      creator_id: 1,
      auditor_id: null,
      bookkeeper_id: null
    })
    expect(db.entries.filter((entry) => entry.voucher_id === 101)[0]).toMatchObject({
      summary: '乙',
      subject_code: '6001',
      credit_amount: 8800
    })
    expect(db.entries.filter((entry) => entry.voucher_id === 202)[0]).toMatchObject({
      summary: '甲',
      subject_code: '1001',
      debit_amount: 8800
    })
  })
})

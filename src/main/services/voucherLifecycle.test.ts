import { describe, expect, it } from 'vitest'
import {
  createVoucherWithEntries,
  prepareVoucherEntries,
  resolveVoucherCashFlowEntries,
  updateVoucherWithEntries,
  type VoucherCashFlowRule,
  type VoucherSubjectMeta
} from './voucherLifecycle'

type VoucherRow = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: number
  creator_id: number
  auditor_id: number | null
  bookkeeper_id: number | null
  is_carry_forward: number
}

type VoucherEntryRow = {
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  cash_flow_item_id: number | null
}

class FakeVoucherLifecycleDb {
  subjects = new Map<string, VoucherSubjectMeta>()
  cashFlowItems = new Set<number>()
  rules: VoucherCashFlowRule[] = []
  systemSettings = new Map<string, string>()
  vouchers: VoucherRow[] = []
  voucherEntries: VoucherEntryRow[] = []
  private nextVoucherId = 1

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      "SELECT s.code, s.is_cash_flow, EXISTS ( SELECT 1 FROM subjects child WHERE child.ledger_id = s.ledger_id AND child.code <> s.code AND (child.parent_code = s.code OR child.code LIKE s.code || '%') ) AS has_children FROM subjects s WHERE s.ledger_id = ? AND s.code = ?"
    ) {
      return {
        get: (_ledgerId, subjectCode) => this.subjects.get(String(subjectCode)),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      "SELECT subject_code, counterpart_subject_code, entry_direction, cash_flow_item_id FROM cash_flow_mappings WHERE ledger_id = ? AND counterpart_subject_code <> ''"
    ) {
      return {
        get: () => undefined,
        all: () =>
          this.rules.map((rule) => ({
            subject_code: rule.subjectCode,
            counterpart_subject_code: rule.counterpartSubjectCode,
            entry_direction: rule.entryDirection,
            cash_flow_item_id: rule.cashFlowItemId
          })),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?') {
      return {
        get: (_ledgerId, cashFlowItemId) =>
          this.cashFlowItems.has(Number(cashFlowItemId))
            ? { id: Number(cashFlowItemId) }
            : undefined,
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
    ) {
      return {
        get: (ledgerId, period) => ({
          max_num: this.vouchers
            .filter(
              (voucher) =>
                voucher.ledger_id === Number(ledgerId) && voucher.period === String(period)
            )
            .reduce((max, voucher) => Math.max(max, voucher.voucher_number), 0)
        }),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      "INSERT INTO vouchers ( ledger_id, period, voucher_date, voucher_number, voucher_word, status, creator_id, auditor_id, bookkeeper_id, is_carry_forward, updated_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          ledgerId,
          period,
          voucherDate,
          voucherNumber,
          voucherWord,
          status,
          creatorId,
          auditorId,
          bookkeeperId,
          isCarryForward
        ) => {
          const id = this.nextVoucherId++
          this.vouchers.push({
            id,
            ledger_id: Number(ledgerId),
            period: String(period),
            voucher_date: String(voucherDate),
            voucher_number: Number(voucherNumber),
            voucher_word: String(voucherWord),
            status: Number(status),
            creator_id: Number(creatorId),
            auditor_id: auditorId === null ? null : Number(auditorId),
            bookkeeper_id: bookkeeperId === null ? null : Number(bookkeeperId),
            is_carry_forward: Number(isCarryForward)
          })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (
      normalized ===
      'INSERT INTO voucher_entries ( voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id ) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          voucherId,
          rowOrder,
          summary,
          subjectCode,
          debitAmount,
          creditAmount,
          cashFlowItemId
        ) => {
          this.voucherEntries.push({
            voucher_id: Number(voucherId),
            row_order: Number(rowOrder),
            summary: String(summary),
            subject_code: String(subjectCode),
            debit_amount: Number(debitAmount),
            credit_amount: Number(creditAmount),
            cash_flow_item_id: cashFlowItemId === null ? null : Number(cashFlowItemId)
          })
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (
      normalized ===
      "UPDATE vouchers SET period = ?, voucher_date = ?, updated_at = datetime('now') WHERE id = ?"
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (period, voucherDate, voucherId) => {
          const voucher = this.vouchers.find((item) => item.id === Number(voucherId))
          if (!voucher) {
            return { lastInsertRowid: 0, changes: 0 }
          }
          voucher.period = String(period)
          voucher.voucher_date = String(voucherDate)
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM voucher_entries WHERE voucher_id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (voucherId) => {
          const before = this.voucherEntries.length
          this.voucherEntries = this.voucherEntries.filter(
            (entry) => entry.voucher_id !== Number(voucherId)
          )
          return { lastInsertRowid: 0, changes: before - this.voucherEntries.length }
        }
      }
    }

    if (normalized === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key) => {
          const value = this.systemSettings.get(String(key))
          return value === undefined ? undefined : { value }
        },
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    throw new Error(`Unhandled SQL in FakeVoucherLifecycleDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }
}

describe('voucherLifecycle service', () => {
  it('keeps internal cash transfers unassigned during matching', () => {
    const result = resolveVoucherCashFlowEntries(
      [
        {
          summary: '银行提现',
          subjectCode: '1002',
          debitCents: 0,
          creditCents: 250000,
          cashFlowItemId: null
        },
        {
          summary: '银行提现',
          subjectCode: '1001',
          debitCents: 250000,
          creditCents: 0,
          cashFlowItemId: null
        }
      ],
      new Map([
        ['1002', { is_cash_flow: 1 }],
        ['1001', { is_cash_flow: 1 }]
      ]),
      []
    )

    expect(result.error).toBeUndefined()
    expect(result.entries[0]?.cashFlowItemId).toBeNull()
    expect(result.entries[1]?.cashFlowItemId).toBeNull()
  })

  it('rejects non-leaf subjects while preparing entries', () => {
    const db = new FakeVoucherLifecycleDb()
    db.subjects.set('1002', {
      code: '1002',
      is_cash_flow: 1,
      has_children: 1
    })

    expect(() =>
      prepareVoucherEntries(db as never, 1, [
        {
          summary: '摘要',
          subjectCode: '1002',
          debitAmount: '10.00',
          creditAmount: '0',
          cashFlowItemId: null
        },
        {
          summary: '摘要',
          subjectCode: '1002',
          debitAmount: '0',
          creditAmount: '10.00',
          cashFlowItemId: null
        }
      ])
    ).toThrow('第1行必须使用末级科目：1002')
  })

  it('creates voucher with auto-bookkeep for carry-forward when allowed', () => {
    const db = new FakeVoucherLifecycleDb()
    db.subjects.set('1002', { code: '1002', is_cash_flow: 1, has_children: 0 })
    db.subjects.set('2202', { code: '2202', is_cash_flow: 0, has_children: 0 })
    db.cashFlowItems.add(1)
    db.rules.push({
      subjectCode: '1002',
      counterpartSubjectCode: '2202',
      entryDirection: 'outflow',
      cashFlowItemId: 1
    })

    const result = createVoucherWithEntries(db as never, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-20',
      voucherWord: '记',
      isCarryForward: true,
      entries: [
        {
          summary: '支付货款',
          subjectCode: '2202',
          debitAmount: '8800.00',
          creditAmount: '0',
          cashFlowItemId: null
        },
        {
          summary: '支付货款',
          subjectCode: '1002',
          debitAmount: '0',
          creditAmount: '8800.00',
          cashFlowItemId: null
        }
      ],
      creatorId: 9,
      allowSameMakerAuditor: true
    })

    expect(result).toEqual({
      voucherId: 1,
      voucherNumber: 1,
      status: 2
    })
    expect(db.vouchers[0]).toMatchObject({
      id: 1,
      status: 2,
      auditor_id: 9,
      bookkeeper_id: 9,
      is_carry_forward: 1
    })
    expect(db.voucherEntries[1]?.cash_flow_item_id).toBe(1)
  })

  it('updates voucher header and rewrites entries', () => {
    const db = new FakeVoucherLifecycleDb()
    db.vouchers.push({
      id: 1,
      ledger_id: 1,
      period: '2026-03',
      voucher_date: '2026-03-01',
      voucher_number: 3,
      voucher_word: '记',
      status: 0,
      creator_id: 8,
      auditor_id: null,
      bookkeeper_id: null,
      is_carry_forward: 0
    })
    db.voucherEntries.push({
      voucher_id: 1,
      row_order: 1,
      summary: '旧分录',
      subject_code: '2202',
      debit_amount: 100,
      credit_amount: 0,
      cash_flow_item_id: null
    })
    db.subjects.set('2202', { code: '2202', is_cash_flow: 0, has_children: 0 })
    db.subjects.set('1002', { code: '1002', is_cash_flow: 1, has_children: 0 })
    db.cashFlowItems.add(1)
    db.rules.push({
      subjectCode: '1002',
      counterpartSubjectCode: '2202',
      entryDirection: 'outflow',
      cashFlowItemId: 1
    })

    updateVoucherWithEntries(db as never, {
      voucherId: 1,
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-15',
      entries: [
        {
          summary: '支付货款',
          subjectCode: '2202',
          debitAmount: '50.00',
          creditAmount: '0',
          cashFlowItemId: null
        },
        {
          summary: '支付货款',
          subjectCode: '1002',
          debitAmount: '0',
          creditAmount: '50.00',
          cashFlowItemId: null
        }
      ]
    })

    expect(db.vouchers[0]).toMatchObject({
      id: 1,
      period: '2026-03',
      voucher_date: '2026-03-15'
    })
    expect(db.voucherEntries).toHaveLength(2)
    expect(db.voucherEntries[1]?.cash_flow_item_id).toBe(1)
  })
})

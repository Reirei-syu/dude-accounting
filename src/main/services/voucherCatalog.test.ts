import { describe, expect, it } from 'vitest'
import {
  getNextVoucherNumber,
  getVoucherLedgerId,
  listVoucherEntries,
  listVoucherSummaries
} from './voucherCatalog'

type VoucherRow = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: number
  creator_id: number | null
  auditor_id: number | null
  bookkeeper_id: number | null
}

type VoucherEntryRow = {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  auxiliary_item_id: number | null
  cash_flow_item_id: number | null
}

class FakeVoucherCatalogDb {
  vouchers: VoucherRow[] = []
  entries: VoucherEntryRow[] = []
  users = new Map<number, { username: string; real_name: string | null }>()
  subjects = new Map<string, string>()
  cashFlowItems = new Map<number, { code: string; name: string }>()

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

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
        all: () => []
      }
    }

    if (normalized === 'SELECT ledger_id FROM vouchers WHERE id = ?') {
      return {
        get: (voucherId) =>
          this.vouchers.find((voucher) => voucher.id === Number(voucherId))
            ? {
                ledger_id: this.vouchers.find((voucher) => voucher.id === Number(voucherId))
                  ?.ledger_id
              }
            : undefined,
        all: () => []
      }
    }

    if (
      normalized.startsWith(
        'SELECT v.id, v.ledger_id, v.period, v.voucher_date, v.voucher_number, v.voucher_word'
      )
    ) {
      return {
        get: () => undefined,
        all: (...args) => this.queryVoucherSummaries(normalized, args)
      }
    }

    if (
      normalized ===
      'SELECT ve.*, s.name AS subject_name, cfi.code AS cash_flow_code, cfi.name AS cash_flow_name FROM voucher_entries ve LEFT JOIN subjects s ON s.code = ve.subject_code AND s.ledger_id = (SELECT ledger_id FROM vouchers WHERE id = ve.voucher_id) LEFT JOIN cash_flow_items cfi ON cfi.id = ve.cash_flow_item_id WHERE ve.voucher_id = ? ORDER BY ve.row_order ASC'
    ) {
      return {
        get: () => undefined,
        all: (voucherId) =>
          this.entries
            .filter((entry) => entry.voucher_id === Number(voucherId))
            .sort((left, right) => left.row_order - right.row_order)
            .map((entry) => ({
              ...entry,
              subject_name: this.subjects.get(entry.subject_code) ?? null,
              cash_flow_code: entry.cash_flow_item_id
                ? (this.cashFlowItems.get(entry.cash_flow_item_id)?.code ?? null)
                : null,
              cash_flow_name: entry.cash_flow_item_id
                ? (this.cashFlowItems.get(entry.cash_flow_item_id)?.name ?? null)
                : null
            }))
      }
    }

    throw new Error(`Unhandled SQL in FakeVoucherCatalogDb: ${normalized}`)
  }

  private queryVoucherSummaries(sql: string, args: unknown[]): unknown[] {
    let vouchers = this.vouchers.filter((voucher) => voucher.ledger_id === Number(args[0]))
    const remainingArgs = args.slice(1)

    const statusArg = remainingArgs.find(
      (arg) => typeof arg === 'number' && [0, 1, 2, 3].includes(Number(arg))
    )
    if (statusArg !== undefined) {
      vouchers = vouchers.filter((voucher) => voucher.status === Number(statusArg))
    }

    const voucherIdArg =
      statusArg === undefined
        ? remainingArgs.find(
            (arg) =>
              typeof arg === 'number' && this.vouchers.some((voucher) => voucher.id === Number(arg))
          )
        : undefined
    if (voucherIdArg !== undefined) {
      vouchers = vouchers.filter((voucher) => voucher.id === Number(voucherIdArg))
    }

    const periodArg = remainingArgs.find(
      (arg) => typeof arg === 'string' && /^\d{4}-\d{2}$/.test(String(arg))
    )
    if (periodArg !== undefined) {
      vouchers = vouchers.filter((voucher) => voucher.period === String(periodArg))
    }

    const dateArgs = remainingArgs.filter(
      (arg) => typeof arg === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(arg))
    )
    if (dateArgs[0]) {
      vouchers = vouchers.filter((voucher) => voucher.voucher_date >= String(dateArgs[0]))
    }
    if (dateArgs[1]) {
      vouchers = vouchers.filter((voucher) => voucher.voucher_date <= String(dateArgs[1]))
    }

    const keywordArg = remainingArgs.find(
      (arg) => typeof arg === 'string' && String(arg).includes('%')
    )
    if (keywordArg !== undefined) {
      const keyword = String(keywordArg).replace(/%/g, '')
      vouchers = vouchers.filter((voucher) =>
        this.entries.some(
          (entry) => entry.voucher_id === voucher.id && entry.summary.includes(keyword)
        )
      )
    }

    if (
      statusArg === undefined &&
      !remainingArgs.some((arg) => typeof arg === 'string' && String(arg).includes('%')) &&
      !sql.includes('status = ?')
    ) {
      vouchers = vouchers.filter(
        (voucher) => voucher.status === 0 || voucher.status === 1 || voucher.status === 2
      )
    }

    return vouchers
      .map((voucher) => {
        const voucherEntries = this.entries
          .filter((entry) => entry.voucher_id === voucher.id)
          .sort((left, right) => left.row_order - right.row_order || left.id - right.id)
        const creator = voucher.creator_id ? this.users.get(voucher.creator_id) : null
        const auditor = voucher.auditor_id ? this.users.get(voucher.auditor_id) : null
        const bookkeeper = voucher.bookkeeper_id ? this.users.get(voucher.bookkeeper_id) : null

        return {
          ...voucher,
          first_summary: voucherEntries[0]?.summary ?? '',
          creator_name: creator?.real_name ?? creator?.username ?? null,
          auditor_name: auditor?.real_name ?? auditor?.username ?? null,
          bookkeeper_name: bookkeeper?.real_name ?? bookkeeper?.username ?? null,
          total_debit: voucherEntries.reduce((sum, entry) => sum + entry.debit_amount, 0),
          total_credit: voucherEntries.reduce((sum, entry) => sum + entry.credit_amount, 0)
        }
      })
      .sort((left, right) => {
        if (left.voucher_date !== right.voucher_date) {
          return right.voucher_date.localeCompare(left.voucher_date)
        }
        return right.voucher_number - left.voucher_number
      })
  }
}

describe('voucherCatalog service', () => {
  it('returns next voucher number within the same period', () => {
    const db = new FakeVoucherCatalogDb()
    db.vouchers.push(
      {
        id: 1,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-01',
        voucher_number: 2,
        voucher_word: '记',
        status: 0,
        creator_id: null,
        auditor_id: null,
        bookkeeper_id: null
      },
      {
        id: 2,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-02',
        voucher_number: 5,
        voucher_word: '记',
        status: 0,
        creator_id: null,
        auditor_id: null,
        bookkeeper_id: null
      }
    )

    expect(getNextVoucherNumber(db as never, 1, '2026-03')).toBe(6)
  })

  it('lists voucher summaries with filters and aggregates', () => {
    const db = new FakeVoucherCatalogDb()
    db.users.set(1, { username: 'zhangsan', real_name: '张三' })
    db.users.set(2, { username: 'lisi', real_name: null })
    db.vouchers.push(
      {
        id: 1,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-15',
        voucher_number: 3,
        voucher_word: '记',
        status: 0,
        creator_id: 1,
        auditor_id: null,
        bookkeeper_id: null
      },
      {
        id: 2,
        ledger_id: 1,
        period: '2026-03',
        voucher_date: '2026-03-20',
        voucher_number: 4,
        voucher_word: '记',
        status: 2,
        creator_id: 2,
        auditor_id: null,
        bookkeeper_id: null
      },
      {
        id: 3,
        ledger_id: 1,
        period: '2026-04',
        voucher_date: '2026-04-01',
        voucher_number: 1,
        voucher_word: '记',
        status: 3,
        creator_id: null,
        auditor_id: null,
        bookkeeper_id: null
      }
    )
    db.entries.push(
      {
        id: 1,
        voucher_id: 1,
        row_order: 1,
        summary: '支付货款',
        subject_code: '2202',
        debit_amount: 1000,
        credit_amount: 0,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      },
      {
        id: 2,
        voucher_id: 1,
        row_order: 2,
        summary: '支付货款',
        subject_code: '1002',
        debit_amount: 0,
        credit_amount: 1000,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      },
      {
        id: 3,
        voucher_id: 2,
        row_order: 1,
        summary: '销售收入',
        subject_code: '1002',
        debit_amount: 2000,
        credit_amount: 0,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      },
      {
        id: 4,
        voucher_id: 2,
        row_order: 2,
        summary: '销售收入',
        subject_code: '6001',
        debit_amount: 0,
        credit_amount: 2000,
        auxiliary_item_id: null,
        cash_flow_item_id: null
      }
    )

    const allRows = listVoucherSummaries(db as never, {
      ledgerId: 1,
      period: '2026-03',
      status: 'all'
    })

    expect(allRows).toHaveLength(2)

    const rows = listVoucherSummaries(db as never, {
      ledgerId: 1,
      period: '2026-03',
      status: 2
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 2,
      first_summary: '销售收入',
      creator_name: 'lisi',
      total_debit: 2000,
      total_credit: 2000
    })
  })

  it('returns voucher ledger id and entry details', () => {
    const db = new FakeVoucherCatalogDb()
    db.vouchers.push({
      id: 9,
      ledger_id: 2,
      period: '2026-03',
      voucher_date: '2026-03-10',
      voucher_number: 1,
      voucher_word: '记',
      status: 0,
      creator_id: null,
      auditor_id: null,
      bookkeeper_id: null
    })
    db.entries.push({
      id: 11,
      voucher_id: 9,
      row_order: 1,
      summary: '摘要',
      subject_code: '1002',
      debit_amount: 500,
      credit_amount: 0,
      auxiliary_item_id: null,
      cash_flow_item_id: 7
    })
    db.subjects.set('1002', '银行存款')
    db.cashFlowItems.set(7, { code: 'CF-01', name: '经营流出' })

    expect(getVoucherLedgerId(db as never, 9)).toBe(2)
    expect(listVoucherEntries(db as never, 9)).toEqual([
      {
        id: 11,
        voucher_id: 9,
        row_order: 1,
        summary: '摘要',
        subject_code: '1002',
        debit_amount: 500,
        credit_amount: 0,
        auxiliary_item_id: null,
        cash_flow_item_id: 7,
        subject_name: '银行存款',
        cash_flow_code: 'CF-01',
        cash_flow_name: '经营流出'
      }
    ])
  })
})

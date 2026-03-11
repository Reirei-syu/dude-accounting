import { describe, expect, it } from 'vitest'
import {
  getAuxiliaryBalances,
  getAuxiliaryDetail,
  getDetailLedger,
  getJournal,
  listSubjectBalances
} from './bookQuery'

type LedgerRecord = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
}

type SubjectRecord = {
  ledger_id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  balance_direction: number
  level: number
}

type InitialBalanceRecord = {
  ledger_id: number
  period: string
  subject_code: string
  debit_amount: number
  credit_amount: number
}

type VoucherRecord = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2 | 3
}

type VoucherEntryRecord = {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  auxiliary_item_id?: number | null
}

type AuxiliaryItemRecord = {
  id: number
  ledger_id: number
  category: string
  code: string
  name: string
}

type SubjectCustomAuxiliaryLinkRecord = {
  subject_code: string
  auxiliary_item_id: number
}

class FakeBookQueryDb {
  readonly ledgers: LedgerRecord[] = []
  readonly subjects: SubjectRecord[] = []
  readonly initialBalances: InitialBalanceRecord[] = []
  readonly vouchers: VoucherRecord[] = []
  readonly voucherEntries: VoucherEntryRecord[] = []
  readonly auxiliaryItems: AuxiliaryItemRecord[] = []
  readonly subjectCustomAuxiliaryLinks: SubjectCustomAuxiliaryLinkRecord[] = []

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.includes('FROM ledgers')) {
      return {
        get: (ledgerId) => this.ledgers.find((ledger) => ledger.id === Number(ledgerId)),
        all: () => []
      }
    }

    if (normalized.includes('FROM subjects s')) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.subjects
            .filter((subject) => subject.ledger_id === Number(ledgerId))
            .sort((left, right) => left.code.localeCompare(right.code))
            .map((subject) => ({
              code: subject.code,
              name: subject.name,
              category: subject.category,
              balance_direction: subject.balance_direction,
              level: subject.level,
              is_leaf: this.subjects.some(
                (candidate) =>
                  candidate.ledger_id === subject.ledger_id &&
                  candidate.code !== subject.code &&
                  (candidate.parent_code === subject.code ||
                    candidate.code.startsWith(subject.code))
              )
                ? 0
                : 1
            }))
      }
    }

    if (normalized.includes('FROM initial_balances')) {
      return {
        get: () => undefined,
        all: (ledgerId, period) =>
          this.initialBalances
            .filter((row) => row.ledger_id === Number(ledgerId) && row.period <= String(period))
            .sort((left, right) => left.period.localeCompare(right.period))
      }
    }

    if (normalized.includes('FROM subject_auxiliary_custom_items saci')) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.subjectCustomAuxiliaryLinks
            .map((link) => {
              const subject = this.subjects.find(
                (candidate) =>
                  candidate.ledger_id === Number(ledgerId) && candidate.code === link.subject_code
              )
              const auxiliary = this.auxiliaryItems.find(
                (candidate) =>
                  candidate.ledger_id === Number(ledgerId) &&
                  candidate.id === link.auxiliary_item_id
              )

              if (!subject || !auxiliary) {
                return null
              }

              return {
                subject_code: subject.code,
                auxiliary_item_id: auxiliary.id,
                auxiliary_category: auxiliary.category,
                auxiliary_code: auxiliary.code,
                auxiliary_name: auxiliary.name
              }
            })
            .filter((row) => row !== null)
      }
    }

    if (
      normalized.includes('FROM auxiliary_items') &&
      normalized.includes('WHERE ledger_id = ? AND id = ?')
    ) {
      return {
        get: (ledgerId, auxiliaryItemId) =>
          this.auxiliaryItems.find(
            (item) => item.ledger_id === Number(ledgerId) && item.id === Number(auxiliaryItemId)
          ),
        all: () => []
      }
    }

    if (normalized.includes('FROM vouchers v INNER JOIN voucher_entries ve')) {
      if (normalized.includes('INNER JOIN auxiliary_items ai ON ai.id = ve.auxiliary_item_id')) {
        const includeUnposted = normalized.includes('v.status IN (0, 1, 2)')
        return {
          get: () => undefined,
          all: (ledgerId, startDate, endDate) =>
            this.listAuxiliaryEntries(ledgerId, startDate, endDate, includeUnposted)
        }
      }

      const includeUnposted = normalized.includes('v.status IN (0, 1, 2)')
      return {
        get: () => undefined,
        all: (ledgerId, startDate, endDate) =>
          this.listEntries(ledgerId, startDate, endDate, includeUnposted)
      }
    }

    throw new Error(`Unhandled SQL in FakeBookQueryDb: ${normalized}`)
  }

  private listEntries(
    ledgerId: unknown,
    startDate: unknown,
    endDate: unknown,
    includeUnpostedVouchers: boolean
  ): unknown[] {
    const matchedVouchers = this.vouchers
      .filter(
        (voucher) =>
          voucher.ledger_id === Number(ledgerId) &&
          (includeUnpostedVouchers ? [0, 1, 2].includes(voucher.status) : voucher.status === 2) &&
          voucher.voucher_date >= String(startDate) &&
          voucher.voucher_date <= String(endDate)
      )
      .sort((left, right) => {
        if (left.voucher_date !== right.voucher_date) {
          return left.voucher_date.localeCompare(right.voucher_date)
        }
        if (left.voucher_word !== right.voucher_word) {
          return left.voucher_word.localeCompare(right.voucher_word)
        }
        return left.voucher_number - right.voucher_number
      })

    return matchedVouchers.flatMap((voucher) =>
      this.voucherEntries
        .filter((entry) => entry.voucher_id === voucher.id)
        .sort((left, right) => {
          if (left.row_order !== right.row_order) {
            return left.row_order - right.row_order
          }
          return left.id - right.id
        })
        .map((entry) => ({
          ...entry,
          voucher_date: voucher.voucher_date,
          period: voucher.period,
          voucher_number: voucher.voucher_number,
          voucher_word: voucher.voucher_word,
          voucher_status: voucher.status
        }))
    )
  }

  private listAuxiliaryEntries(
    ledgerId: unknown,
    startDate: unknown,
    endDate: unknown,
    includeUnpostedVouchers: boolean
  ): unknown[] {
    const entries = this.listEntries(
      ledgerId,
      startDate,
      endDate,
      includeUnpostedVouchers
    ) as Array<
      VoucherEntryRecord & {
        voucher_date: string
        period: string
        voucher_number: number
        voucher_word: string
        voucher_status: 0 | 1 | 2 | 3
      }
    >

    return entries
      .filter((entry) => typeof entry.auxiliary_item_id === 'number' && entry.auxiliary_item_id > 0)
      .map((entry) => {
        const auxiliary = this.auxiliaryItems.find((item) => item.id === entry.auxiliary_item_id)
        if (!auxiliary) {
          throw new Error(`Missing auxiliary item for entry ${entry.id}`)
        }

        return {
          ...entry,
          auxiliary_item_id: auxiliary.id,
          auxiliary_category: auxiliary.category,
          auxiliary_code: auxiliary.code,
          auxiliary_name: auxiliary.name
        }
      })
  }
}

function createDb(): FakeBookQueryDb {
  const db = new FakeBookQueryDb()

  db.ledgers.push(
    {
      id: 1,
      name: 'npo-ledger',
      standard_type: 'npo',
      start_period: '2026-01',
      current_period: '2026-03'
    },
    {
      id: 2,
      name: 'enterprise-ledger',
      standard_type: 'enterprise',
      start_period: '2026-01',
      current_period: '2026-03'
    }
  )

  db.subjects.push(
    {
      ledger_id: 1,
      code: '1001',
      name: 'cash',
      parent_code: null,
      category: 'asset',
      balance_direction: 1,
      level: 1
    },
    {
      ledger_id: 1,
      code: '4001',
      name: 'net-assets',
      parent_code: null,
      category: 'net_assets',
      balance_direction: -1,
      level: 1
    },
    {
      ledger_id: 1,
      code: '5201',
      name: 'activity-cost',
      parent_code: null,
      category: 'expense',
      balance_direction: 1,
      level: 1
    },
    {
      ledger_id: 1,
      code: '520101',
      name: 'office',
      parent_code: '5201',
      category: 'expense',
      balance_direction: 1,
      level: 2
    },
    {
      ledger_id: 1,
      code: '520102',
      name: 'travel',
      parent_code: '5201',
      category: 'expense',
      balance_direction: 1,
      level: 2
    },
    {
      ledger_id: 1,
      code: '5901',
      name: 'other-expense',
      parent_code: null,
      category: 'expense',
      balance_direction: 1,
      level: 1
    },
    {
      ledger_id: 1,
      code: '1501',
      name: 'fixed-assets',
      parent_code: null,
      category: 'asset',
      balance_direction: 1,
      level: 1
    },
    {
      ledger_id: 1,
      code: '2201',
      name: 'accounts-payable',
      parent_code: null,
      category: 'liability',
      balance_direction: -1,
      level: 1
    }
  )

  db.initialBalances.push(
    {
      ledger_id: 1,
      period: '2026-01',
      subject_code: '1001',
      debit_amount: 100_000,
      credit_amount: 0
    },
    {
      ledger_id: 1,
      period: '2026-01',
      subject_code: '4001',
      debit_amount: 0,
      credit_amount: 100_000
    }
  )

  db.vouchers.push(
    {
      id: 1,
      ledger_id: 1,
      period: '2026-02',
      voucher_date: '2026-02-15',
      voucher_number: 1,
      voucher_word: 'J',
      status: 2
    },
    {
      id: 2,
      ledger_id: 1,
      period: '2026-03',
      voucher_date: '2026-03-05',
      voucher_number: 2,
      voucher_word: 'J',
      status: 2
    },
    {
      id: 3,
      ledger_id: 1,
      period: '2026-03',
      voucher_date: '2026-03-20',
      voucher_number: 3,
      voucher_word: 'J',
      status: 2
    },
    {
      id: 4,
      ledger_id: 1,
      period: '2026-03',
      voucher_date: '2026-03-25',
      voucher_number: 4,
      voucher_word: 'J',
      status: 1
    },
    {
      id: 5,
      ledger_id: 1,
      period: '2026-01',
      voucher_date: '2026-01-08',
      voucher_number: 5,
      voucher_word: 'J',
      status: 2
    }
  )

  db.auxiliaryItems.push(
    {
      id: 1,
      ledger_id: 1,
      category: 'department',
      code: 'D001',
      name: 'admin'
    },
    {
      id: 2,
      ledger_id: 1,
      category: 'department',
      code: 'D002',
      name: 'fundraising'
    },
    {
      id: 3,
      ledger_id: 1,
      category: 'custom',
      code: 'FA001',
      name: 'fixed-asset-card'
    }
  )

  db.subjectCustomAuxiliaryLinks.push({
    subject_code: '1501',
    auxiliary_item_id: 3
  })

  db.voucherEntries.push(
    {
      id: 1,
      voucher_id: 1,
      row_order: 1,
      summary: 'feb-office',
      subject_code: '520101',
      debit_amount: 3_000,
      credit_amount: 0,
      auxiliary_item_id: 1
    },
    {
      id: 2,
      voucher_id: 1,
      row_order: 2,
      summary: 'feb-office',
      subject_code: '1001',
      debit_amount: 0,
      credit_amount: 3_000
    },
    {
      id: 3,
      voucher_id: 2,
      row_order: 1,
      summary: 'mar-travel',
      subject_code: '520102',
      debit_amount: 2_000,
      credit_amount: 0,
      auxiliary_item_id: 1
    },
    {
      id: 4,
      voucher_id: 2,
      row_order: 2,
      summary: 'mar-travel',
      subject_code: '1001',
      debit_amount: 0,
      credit_amount: 2_000
    },
    {
      id: 5,
      voucher_id: 3,
      row_order: 1,
      summary: 'donation',
      subject_code: '1001',
      debit_amount: 10_000,
      credit_amount: 0
    },
    {
      id: 6,
      voucher_id: 3,
      row_order: 2,
      summary: 'donation',
      subject_code: '4001',
      debit_amount: 0,
      credit_amount: 10_000
    },
    {
      id: 7,
      voucher_id: 4,
      row_order: 1,
      summary: 'draft-travel',
      subject_code: '520102',
      debit_amount: 1_000,
      credit_amount: 0,
      auxiliary_item_id: 2
    },
    {
      id: 8,
      voucher_id: 4,
      row_order: 2,
      summary: 'draft-travel',
      subject_code: '1001',
      debit_amount: 0,
      credit_amount: 1_000
    },
    {
      id: 9,
      voucher_id: 5,
      row_order: 1,
      summary: 'buy-fixed-asset',
      subject_code: '1501',
      debit_amount: 50_000,
      credit_amount: 0
    },
    {
      id: 10,
      voucher_id: 5,
      row_order: 2,
      summary: 'buy-fixed-asset',
      subject_code: '2201',
      debit_amount: 0,
      credit_amount: 50_000
    }
  )

  return db
}

describe('bookQuery service', () => {
  it('lists subject balances for a custom date range', () => {
    const db = createDb()

    const rows = listSubjectBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })

    expect(rows.find((row) => row.subject_code === '1001')).toMatchObject({
      subject_code: '1001',
      is_leaf: 1,
      opening_debit_amount: 97_000,
      period_debit_amount: 10_000,
      period_credit_amount: 2_000,
      ending_debit_amount: 105_000
    })

    expect(rows.find((row) => row.subject_code === '5201')).toMatchObject({
      subject_code: '5201',
      is_leaf: 0,
      opening_debit_amount: 3_000,
      period_debit_amount: 2_000,
      ending_debit_amount: 5_000
    })
  })

  it('includes unposted vouchers only when the option is checked', () => {
    const db = createDb()

    const postedOnly = listSubjectBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })
    const includeUnposted = listSubjectBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      includeUnpostedVouchers: true
    })

    expect(postedOnly.find((row) => row.subject_code === '1001')).toMatchObject({
      period_credit_amount: 2_000,
      ending_debit_amount: 105_000
    })
    expect(includeUnposted.find((row) => row.subject_code === '1001')).toMatchObject({
      period_credit_amount: 3_000,
      ending_debit_amount: 104_000
    })
  })

  it('hides zero-balance subjects by default and shows them when requested', () => {
    const db = createDb()

    const defaultRows = listSubjectBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })
    const fullRows = listSubjectBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      includeZeroBalance: true
    })

    expect(defaultRows.some((row) => row.subject_code === '5901')).toBe(false)
    expect(fullRows.find((row) => row.subject_code === '5901')).toMatchObject({
      opening_debit_amount: 0,
      opening_credit_amount: 0,
      period_debit_amount: 0,
      period_credit_amount: 0,
      ending_debit_amount: 0,
      ending_credit_amount: 0
    })
  })

  it('still supports keyword filtering on the new range query', () => {
    const db = createDb()

    expect(
      listSubjectBalances(db as never, {
        ledgerId: 1,
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        includeZeroBalance: true,
        keyword: 'travel'
      })
    ).toMatchObject([
      {
        subject_code: '520102',
        subject_name: 'travel'
      }
    ])
  })

  it('builds detail ledger rows with opening balance and running balance', () => {
    const db = createDb()

    const detail = getDetailLedger(db as never, {
      ledgerId: 1,
      subjectCode: '1001',
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })

    expect(detail.subject).toMatchObject({
      code: '1001',
      name: 'cash',
      balance_direction: 1
    })
    expect(detail.rows).toHaveLength(3)
    expect(detail.rows[0]).toMatchObject({
      row_type: 'opening',
      balance_amount: 97_000,
      balance_side: 'debit'
    })
    expect(detail.rows[1]).toMatchObject({
      row_type: 'entry',
      voucher_id: 2,
      voucher_date: '2026-03-05',
      voucher_number: 2,
      voucher_word: 'J',
      summary: 'mar-travel',
      credit_amount: 2_000,
      balance_amount: 95_000
    })
  })

  it('can align detail ledger with unposted subject-balance queries when requested', () => {
    const db = createDb()

    const detail = getDetailLedger(db as never, {
      ledgerId: 1,
      subjectCode: '1001',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      includeUnpostedVouchers: true
    })

    expect(detail.rows.at(-1)).toMatchObject({
      voucher_id: 4,
      summary: 'draft-travel',
      balance_amount: 104_000
    })
  })

  it('rejects non-npo ledgers in the pilot phase', () => {
    const db = createDb()

    expect(() =>
      listSubjectBalances(db as never, {
        ledgerId: 2,
        startDate: '2026-03-01',
        endDate: '2026-03-31'
      })
    ).toThrow()
  })

  it('supports detail ledger queries for parent subjects by aggregating descendant entries', () => {
    const db = createDb()

    const detail = getDetailLedger(db as never, {
      ledgerId: 1,
      subjectCode: '5201',
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })

    expect(detail.subject).toMatchObject({
      code: '5201',
      name: 'activity-cost',
      balance_direction: 1
    })
    expect(detail.rows).toHaveLength(2)
    expect(detail.rows[0]).toMatchObject({
      row_type: 'opening',
      balance_amount: 3_000,
      balance_side: 'debit'
    })
    expect(detail.rows[1]).toMatchObject({
      voucher_id: 2,
      summary: 'mar-travel',
      debit_amount: 2_000,
      balance_amount: 5_000
    })
  })

  it('lists journal rows for a date range and subject code range', () => {
    const db = createDb()

    const rows = getJournal(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      subjectCodeStart: '5201',
      subjectCodeEnd: '520199'
    })

    expect(rows).toEqual([
      expect.objectContaining({
        voucher_id: 2,
        voucher_date: '2026-03-05',
        summary: 'mar-travel',
        subject_code: '520102',
        subject_name: 'travel',
        debit_amount: 2_000,
        credit_amount: 0
      })
    ])
  })

  it('includes unposted vouchers in journal only when requested', () => {
    const db = createDb()

    const postedOnly = getJournal(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })
    const includeUnposted = getJournal(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      includeUnpostedVouchers: true
    })

    expect(postedOnly.some((row) => row.voucher_id === 4)).toBe(false)
    expect(includeUnposted.some((row) => row.voucher_id === 4)).toBe(true)
  })

  it('lists auxiliary balance rows grouped by subject and auxiliary item', () => {
    const db = createDb()

    const rows = getAuxiliaryBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      subjectCodeStart: '5201',
      subjectCodeEnd: '520199'
    })

    expect(rows).toEqual([
      expect.objectContaining({
        subject_code: '520101',
        auxiliary_item_id: 1,
        auxiliary_code: 'D001',
        opening_debit_amount: 3_000,
        ending_debit_amount: 3_000
      }),
      expect.objectContaining({
        subject_code: '520102',
        auxiliary_item_id: 1,
        auxiliary_code: 'D001',
        period_debit_amount: 2_000,
        ending_debit_amount: 2_000
      })
    ])
  })

  it('builds auxiliary detail rows with running balance and optional unposted entries', () => {
    const db = createDb()

    const detail = getAuxiliaryDetail(db as never, {
      ledgerId: 1,
      subjectCode: '5201',
      auxiliaryItemId: 1,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })

    expect(detail.auxiliary).toMatchObject({
      id: 1,
      code: 'D001',
      name: 'admin'
    })
    expect(detail.rows[0]).toMatchObject({
      row_type: 'opening',
      balance_amount: 3_000
    })
    expect(detail.rows[1]).toMatchObject({
      voucher_id: 2,
      summary: 'mar-travel',
      debit_amount: 2_000,
      balance_amount: 5_000
    })

    const includeUnposted = getAuxiliaryDetail(db as never, {
      ledgerId: 1,
      subjectCode: '5201',
      auxiliaryItemId: 2,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      includeUnpostedVouchers: true
    })

    expect(includeUnposted.rows.at(-1)).toMatchObject({
      voucher_id: 4,
      summary: 'draft-travel',
      balance_amount: 1_000
    })
  })

  it('infers auxiliary balance rows from unique custom subject bindings', () => {
    const db = createDb()

    const rows = getAuxiliaryBalances(db as never, {
      ledgerId: 1,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      subjectCodeStart: '1501',
      subjectCodeEnd: '1501'
    })

    expect(rows).toEqual([
      expect.objectContaining({
        subject_code: '1501',
        auxiliary_item_id: 3,
        auxiliary_category: 'custom',
        auxiliary_code: 'FA001',
        period_debit_amount: 50_000,
        ending_debit_amount: 50_000
      })
    ])
  })

  it('builds auxiliary detail from unique custom subject bindings even without entry auxiliary ids', () => {
    const db = createDb()

    const detail = getAuxiliaryDetail(db as never, {
      ledgerId: 1,
      subjectCode: '1501',
      auxiliaryItemId: 3,
      startDate: '2026-01-01',
      endDate: '2026-01-31'
    })

    expect(detail.auxiliary).toMatchObject({
      id: 3,
      category: 'custom',
      code: 'FA001',
      name: 'fixed-asset-card'
    })
    expect(detail.rows).toHaveLength(2)
    expect(detail.rows[1]).toMatchObject({
      voucher_id: 5,
      summary: 'buy-fixed-asset',
      debit_amount: 50_000,
      balance_amount: 50_000
    })
  })
})

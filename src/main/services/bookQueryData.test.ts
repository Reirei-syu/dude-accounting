import { describe, expect, it } from 'vitest'
import {
  getEffectiveLedgerStartPeriod,
  listResolvedAuxiliaryLedgerEntries,
  type LedgerRow
} from './bookQueryData'

class FakeBookQueryDataDb {
  readonly directAuxiliaryRows: Array<{
    id: number
    voucher_id: number
    row_order: number
    summary: string
    subject_code: string
    debit_amount: number
    credit_amount: number
    voucher_date: string
    period: string
    voucher_number: number
    voucher_word: string
    voucher_status: 0 | 1 | 2
    auxiliary_item_id: number
    auxiliary_category: string
    auxiliary_code: string
    auxiliary_name: string
  }> = []
  readonly ledgerRows: Array<{
    id: number
    voucher_id: number
    row_order: number
    summary: string
    subject_code: string
    debit_amount: number
    credit_amount: number
    voucher_date: string
    period: string
    voucher_number: number
    voucher_word: string
    voucher_status: 0 | 1 | 2
  }> = []
  readonly customAuxiliaryRows: Array<{
    subject_code: string
    auxiliary_item_id: number
    auxiliary_category: string
    auxiliary_code: string
    auxiliary_name: string
  }> = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
    get: (...args: unknown[]) => unknown
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized.includes('FROM vouchers v') &&
      normalized.includes('INNER JOIN auxiliary_items ai ON ai.id = ve.auxiliary_item_id')
    ) {
      return {
        all: () => this.directAuxiliaryRows,
        get: () => undefined
      }
    }

    if (
      normalized.includes('FROM vouchers v') &&
      normalized.includes('INNER JOIN voucher_entries ve ON ve.voucher_id = v.id')
    ) {
      return {
        all: () => this.ledgerRows,
        get: () => undefined
      }
    }

    if (normalized.includes('FROM subject_auxiliary_custom_items saci')) {
      return {
        all: () => this.customAuxiliaryRows,
        get: () => undefined
      }
    }

    throw new Error(`Unhandled SQL in FakeBookQueryDataDb: ${normalized}`)
  }
}

describe('bookQueryData service', () => {
  it('picks the earliest valid ledger start period candidate', () => {
    const ledger: LedgerRow = {
      id: 1,
      name: '测试账套',
      standard_type: 'enterprise',
      start_period: '2026-03',
      current_period: '2026-05'
    }

    expect(getEffectiveLedgerStartPeriod(ledger, '2026-01')).toBe('2026-01')
    expect(getEffectiveLedgerStartPeriod(ledger, '2026-07')).toBe('2026-03')
  })

  it('infers auxiliary entries from unique custom bindings when direct auxiliary is missing', () => {
    const db = new FakeBookQueryDataDb()
    db.ledgerRows.push({
      id: 1,
      voucher_id: 10,
      row_order: 1,
      summary: '购置设备',
      subject_code: '1601',
      debit_amount: 80000,
      credit_amount: 0,
      voucher_date: '2026-03-10',
      period: '2026-03',
      voucher_number: 5,
      voucher_word: '记',
      voucher_status: 2
    })
    db.customAuxiliaryRows.push({
      subject_code: '1601',
      auxiliary_item_id: 101,
      auxiliary_category: 'custom',
      auxiliary_code: 'FA001',
      auxiliary_name: '设备卡片'
    })

    expect(
      listResolvedAuxiliaryLedgerEntries(db as never, 1, '2026-03-01', '2026-03-31', false)
    ).toEqual([
      {
        id: 1,
        voucher_id: 10,
        row_order: 1,
        summary: '购置设备',
        subject_code: '1601',
        debit_amount: 80000,
        credit_amount: 0,
        voucher_date: '2026-03-10',
        period: '2026-03',
        voucher_number: 5,
        voucher_word: '记',
        voucher_status: 2,
        auxiliary_item_id: 101,
        auxiliary_category: 'custom',
        auxiliary_code: 'FA001',
        auxiliary_name: '设备卡片'
      }
    ])
  })
})

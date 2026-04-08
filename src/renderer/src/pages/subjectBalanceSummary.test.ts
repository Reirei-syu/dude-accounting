import { describe, expect, it } from 'vitest'
import { buildSubjectBalanceDisplayRows, type SubjectBalanceBaseRow } from './subjectBalanceSummary'

const sampleRows: SubjectBalanceBaseRow[] = [
  {
    subject_code: '1001',
    subject_name: '库存现金',
    category: 'asset',
    balance_direction: 1,
    level: 1,
    is_leaf: 1,
    opening_debit_amount: 10000,
    opening_credit_amount: 0,
    period_debit_amount: 2000,
    period_credit_amount: 500,
    ending_debit_amount: 11500,
    ending_credit_amount: 0
  },
  {
    subject_code: '2202',
    subject_name: '应付账款',
    category: 'liability',
    balance_direction: -1,
    level: 1,
    is_leaf: 1,
    opening_debit_amount: 0,
    opening_credit_amount: 8000,
    period_debit_amount: 400,
    period_credit_amount: 1200,
    ending_debit_amount: 0,
    ending_credit_amount: 8800
  },
  {
    subject_code: '4001',
    subject_name: '实收资本',
    category: 'equity',
    balance_direction: -1,
    level: 1,
    is_leaf: 1,
    opening_debit_amount: 0,
    opening_credit_amount: 5000,
    period_debit_amount: 0,
    period_credit_amount: 0,
    ending_debit_amount: 0,
    ending_credit_amount: 5000
  },
  {
    subject_code: '1001-1',
    subject_name: '库存现金-子科目',
    category: 'asset',
    balance_direction: 1,
    level: 2,
    is_leaf: 0,
    opening_debit_amount: 10000,
    opening_credit_amount: 0,
    period_debit_amount: 2000,
    period_credit_amount: 500,
    ending_debit_amount: 11500,
    ending_credit_amount: 0
  }
]

describe('subjectBalanceSummary', () => {
  it('appends subtotal rows and a total row without double counting parent rows', () => {
    const rows = buildSubjectBalanceDisplayRows(sampleRows, 'enterprise')

    const assetSubtotal = rows.find((row) => row.subject_name === '资产合计')
    const liabilitySubtotal = rows.find((row) => row.subject_name === '负债合计')
    const equitySubtotal = rows.find((row) => row.subject_name === '所有者权益合计')
    const totalRow = rows.find((row) => row.subject_name === '借贷总计')

    expect(assetSubtotal?.rowType).toBe('subtotal')
    expect(assetSubtotal?.opening_debit_amount).toBe(10000)
    expect(assetSubtotal?.period_debit_amount).toBe(2000)
    expect(assetSubtotal?.period_credit_amount).toBe(500)

    expect(liabilitySubtotal?.opening_credit_amount).toBe(8000)
    expect(liabilitySubtotal?.ending_credit_amount).toBe(8800)

    expect(equitySubtotal?.opening_credit_amount).toBe(5000)
    expect(totalRow?.rowType).toBe('total')
    expect(totalRow?.opening_debit_amount).toBe(10000)
    expect(totalRow?.opening_credit_amount).toBe(13000)
    expect(totalRow?.period_debit_amount).toBe(2400)
    expect(totalRow?.period_credit_amount).toBe(1700)
  })

  it('uses net assets label for npo ledgers', () => {
    const rows = buildSubjectBalanceDisplayRows(
      [
        {
          ...sampleRows[0],
          category: 'net_assets',
          subject_name: '非限定性净资产'
        }
      ],
      'npo'
    )

    expect(rows.some((row) => row.subject_name === '净资产合计')).toBe(true)
    expect(rows.some((row) => row.subject_name === '所有者权益合计')).toBe(false)
  })
})

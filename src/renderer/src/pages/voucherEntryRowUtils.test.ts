import { describe, expect, it } from 'vitest'
import {
  buildNextVoucherEntryRow,
  filterVoucherRowsForSave,
  inheritSummaryFromPreviousRow,
  type VoucherEntryRowDraft
} from './voucherEntryRowUtils'

const createRow = (overrides: Partial<VoucherEntryRowDraft> = {}): VoucherEntryRowDraft => ({
  summary: '',
  subjectInput: '',
  subjectCode: '',
  debit: '',
  credit: '',
  cashFlowItemId: null,
  ...overrides
})

describe('voucherEntryRowUtils', () => {
  it('copies the previous summary into a newly appended row', () => {
    const previousRow = createRow({ summary: 'Office supplies' })

    const nextRow = buildNextVoucherEntryRow(previousRow, () => createRow())

    expect(nextRow.summary).toBe('Office supplies')
  })

  it('fills the next empty row summary from the previous row without overwriting content', () => {
    const rows = [
      createRow({ summary: 'Payroll accrual', debit: '100.00' }),
      createRow(),
      createRow({ summary: 'Existing summary' }),
      createRow({ subjectInput: '1001 Bank deposit' })
    ]

    const nextRows = inheritSummaryFromPreviousRow(rows, 1)
    const unchangedSummaryRows = inheritSummaryFromPreviousRow(rows, 2)
    const unchangedContentRows = inheritSummaryFromPreviousRow(rows, 3)

    expect(nextRows[1].summary).toBe('Payroll accrual')
    expect(unchangedSummaryRows).toBe(rows)
    expect(unchangedContentRows).toBe(rows)
  })

  it('drops rows without positive amounts before save', () => {
    const rows = [
      createRow({ summary: 'Keep debit row', subjectCode: '1001', debit: '88.00' }),
      createRow({ summary: 'Keep credit row', subjectCode: '6001', credit: '88.00' }),
      createRow({ summary: 'Remove empty amount row', subjectCode: '2202' }),
      createRow({ summary: 'Remove zero debit row', subjectCode: '1002', debit: '0.00' }),
      createRow({ summary: 'Remove zero amount row', subjectCode: '1002', debit: '0', credit: '0' })
    ]

    expect(filterVoucherRowsForSave(rows)).toEqual([rows[0], rows[1]])
  })
})

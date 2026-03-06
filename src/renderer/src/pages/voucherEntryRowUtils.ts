import Decimal from 'decimal.js'

export interface VoucherEntryRowDraft {
  summary: string
  subjectInput: string
  subjectCode: string
  debit: string
  credit: string
  cashFlowItemId: number | null
}

const hasPositiveAmount = (value: string): boolean => {
  const text = value.trim()
  if (text === '') return false

  try {
    return new Decimal(text).greaterThan(0)
  } catch {
    return false
  }
}

const hasNonSummaryContent = (row: VoucherEntryRowDraft): boolean =>
  row.subjectInput.trim() !== '' ||
  row.subjectCode.trim() !== '' ||
  row.debit.trim() !== '' ||
  row.credit.trim() !== '' ||
  row.cashFlowItemId !== null

export function buildNextVoucherEntryRow<T extends VoucherEntryRowDraft>(
  previousRow: T | undefined,
  createRow: () => T
): T {
  const nextRow = createRow()
  const previousSummary = previousRow?.summary.trim() ?? ''

  if (previousSummary !== '') {
    nextRow.summary = previousRow?.summary ?? ''
  }

  return nextRow
}

export function inheritSummaryFromPreviousRow<T extends VoucherEntryRowDraft>(
  rows: T[],
  rowIndex: number
): T[] {
  if (rowIndex <= 0 || rowIndex >= rows.length) {
    return rows
  }

  const currentRow = rows[rowIndex]
  const previousRow = rows[rowIndex - 1]
  const previousSummary = previousRow.summary.trim()

  if (
    previousSummary === '' ||
    currentRow.summary.trim() !== '' ||
    hasNonSummaryContent(currentRow)
  ) {
    return rows
  }

  const nextRows = [...rows]
  nextRows[rowIndex] = {
    ...currentRow,
    summary: previousRow.summary
  }

  return nextRows
}

export function filterVoucherRowsForSave<T extends VoucherEntryRowDraft>(rows: T[]): T[] {
  return rows.filter((row) => hasPositiveAmount(row.debit) || hasPositiveAmount(row.credit))
}

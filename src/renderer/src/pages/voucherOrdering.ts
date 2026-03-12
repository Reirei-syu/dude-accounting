export interface VoucherOrderItem {
  id: number
  voucher_number: number
  voucher_word: string
  voucher_date: string
}

const VOUCHER_WORD_PRIORITY: Record<string, number> = {
  记: 0,
  结: 1
}

function getVoucherWordPriority(voucherWord: string): number {
  return VOUCHER_WORD_PRIORITY[voucherWord] ?? 9
}

export function compareVouchersForDisplay<T extends VoucherOrderItem>(left: T, right: T): number {
  const wordPriorityDelta =
    getVoucherWordPriority(left.voucher_word) - getVoucherWordPriority(right.voucher_word)
  if (wordPriorityDelta !== 0) {
    return wordPriorityDelta
  }

  if (left.voucher_number !== right.voucher_number) {
    return left.voucher_number - right.voucher_number
  }

  if (left.voucher_date !== right.voucher_date) {
    return left.voucher_date.localeCompare(right.voucher_date)
  }

  return left.id - right.id
}

export function sortVouchersForDisplay<T extends VoucherOrderItem>(rows: T[]): T[] {
  return [...rows].sort(compareVouchersForDisplay)
}

export function getDefaultVoucherDateForNewVoucher(
  activePeriod: string,
  rows: VoucherOrderItem[],
  strategy: 'last_voucher_date' | 'period_start' = 'last_voucher_date'
): string {
  if (strategy === 'period_start') {
    return `${activePeriod}-01`
  }
  const sortedRows = sortVouchersForDisplay(rows)
  const latestVoucher = sortedRows[sortedRows.length - 1]
  return latestVoucher?.voucher_date ?? `${activePeriod}-01`
}

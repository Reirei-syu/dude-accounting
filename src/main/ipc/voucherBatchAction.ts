export type VoucherBatchAction =
  | 'audit'
  | 'bookkeep'
  | 'unbookkeep'
  | 'unaudit'
  | 'delete'
  | 'restoreDelete'
  | 'purgeDelete'

export interface VoucherBatchTarget {
  status: number
}

export function isVoucherEligibleForBatchAction(
  action: VoucherBatchAction,
  status: number
): boolean {
  switch (action) {
    case 'audit':
      return status === 0
    case 'bookkeep':
      return status === 1
    case 'unbookkeep':
      return status === 2
    case 'unaudit':
      return status === 1
    case 'delete':
      return status === 0 || status === 1
    case 'restoreDelete':
      return status === 3
    case 'purgeDelete':
      return status === 3
    default:
      return false
  }
}

export function splitVouchersByBatchAction<T extends VoucherBatchTarget>(
  action: VoucherBatchAction,
  vouchers: T[]
): { applicable: T[]; skipped: T[] } {
  const applicable: T[] = []
  const skipped: T[] = []

  for (const voucher of vouchers) {
    if (isVoucherEligibleForBatchAction(action, voucher.status)) {
      applicable.push(voucher)
    } else {
      skipped.push(voucher)
    }
  }

  return { applicable, skipped }
}

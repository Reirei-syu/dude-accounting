export interface VoucherSwapVoucher {
  id: number
  ledgerId: number
  period: string
  voucherDate: string
  status: number
  creatorId: number | null
  auditorId: number | null
  bookkeeperId: number | null
  attachmentCount: number
  isCarryForward: number
}

export interface VoucherSwapEntry {
  rowOrder: number
  summary: string
  subjectCode: string
  debitAmount: number
  creditAmount: number
  auxiliaryItemId: number | null
  cashFlowItemId: number | null
}

export interface VoucherSwapVoucherUpdate {
  voucherDate: string
  status: number
  creatorId: number | null
  auditorId: number | null
  bookkeeperId: number | null
  attachmentCount: number
  isCarryForward: number
}

export interface VoucherSwapPlan {
  firstVoucherId: number
  secondVoucherId: number
  firstVoucherUpdate: VoucherSwapVoucherUpdate
  secondVoucherUpdate: VoucherSwapVoucherUpdate
  firstVoucherEntries: VoucherSwapEntry[]
  secondVoucherEntries: VoucherSwapEntry[]
}

const cloneEntry = (entry: VoucherSwapEntry): VoucherSwapEntry => ({ ...entry })

const buildVoucherUpdate = (voucher: VoucherSwapVoucher): VoucherSwapVoucherUpdate => ({
  voucherDate: voucher.voucherDate,
  status: voucher.status,
  creatorId: voucher.creatorId,
  auditorId: voucher.auditorId,
  bookkeeperId: voucher.bookkeeperId,
  attachmentCount: voucher.attachmentCount,
  isCarryForward: voucher.isCarryForward
})

export function buildVoucherSwapPlan(
  firstVoucher: VoucherSwapVoucher,
  secondVoucher: VoucherSwapVoucher,
  firstEntries: VoucherSwapEntry[],
  secondEntries: VoucherSwapEntry[]
): VoucherSwapPlan {
  return {
    firstVoucherId: firstVoucher.id,
    secondVoucherId: secondVoucher.id,
    firstVoucherUpdate: buildVoucherUpdate(secondVoucher),
    secondVoucherUpdate: buildVoucherUpdate(firstVoucher),
    firstVoucherEntries: secondEntries.map(cloneEntry),
    secondVoucherEntries: firstEntries.map(cloneEntry)
  }
}

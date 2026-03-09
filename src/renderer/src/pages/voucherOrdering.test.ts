import { describe, expect, it } from 'vitest'
import {
  getDefaultVoucherDateForNewVoucher,
  sortVouchersForDisplay,
  type VoucherOrderItem
} from './voucherOrdering'

describe('voucherOrdering', () => {
  it('sorts normal vouchers before carry-forward vouchers and then by voucher number', () => {
    const rows: VoucherOrderItem[] = [
      { id: 4, voucher_number: 2, voucher_word: '结', voucher_date: '2026-03-31' },
      { id: 2, voucher_number: 2, voucher_word: '记', voucher_date: '2026-03-08' },
      { id: 3, voucher_number: 1, voucher_word: '结', voucher_date: '2026-03-31' },
      { id: 1, voucher_number: 1, voucher_word: '记', voucher_date: '2026-03-03' }
    ]

    expect(sortVouchersForDisplay(rows).map((row) => `${row.voucher_word}-${row.voucher_number}`)).toEqual([
      '记-1',
      '记-2',
      '结-1',
      '结-2'
    ])
  })

  it('uses the previous voucher date as the default new voucher date', () => {
    expect(getDefaultVoucherDateForNewVoucher('2026-03', [])).toBe('2026-03-01')
    expect(
      getDefaultVoucherDateForNewVoucher('2026-03', [
        { id: 2, voucher_number: 2, voucher_word: '记', voucher_date: '2026-03-08' },
        { id: 3, voucher_number: 1, voucher_word: '结', voucher_date: '2026-03-31' },
        { id: 1, voucher_number: 1, voucher_word: '记', voucher_date: '2026-03-03' }
      ])
    ).toBe('2026-03-31')
  })
})

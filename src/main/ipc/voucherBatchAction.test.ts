import { describe, expect, it } from 'vitest'
import {
  isVoucherEligibleForBatchAction,
  splitVouchersByBatchAction,
  type VoucherBatchAction
} from './voucherBatchAction'

describe('voucher batch action helpers', () => {
  it.each<[VoucherBatchAction, number, boolean]>([
    ['audit', 0, true],
    ['audit', 1, false],
    ['audit', 2, false],
    ['audit', 3, false],
    ['bookkeep', 0, false],
    ['bookkeep', 1, true],
    ['bookkeep', 2, false],
    ['bookkeep', 3, false],
    ['unbookkeep', 0, false],
    ['unbookkeep', 1, false],
    ['unbookkeep', 2, true],
    ['unbookkeep', 3, false],
    ['unaudit', 0, false],
    ['unaudit', 1, true],
    ['unaudit', 2, false],
    ['unaudit', 3, false],
    ['delete', 0, true],
    ['delete', 1, true],
    ['delete', 2, false],
    ['delete', 3, false],
    ['restoreDelete', 0, false],
    ['restoreDelete', 1, false],
    ['restoreDelete', 2, false],
    ['restoreDelete', 3, true],
    ['purgeDelete', 0, false],
    ['purgeDelete', 1, false],
    ['purgeDelete', 2, false],
    ['purgeDelete', 3, true]
  ])('checks %s eligibility for status %s', (action, status, expected) => {
    expect(isVoucherEligibleForBatchAction(action, status)).toBe(expected)
  })

  it('splits mixed vouchers into applicable and skipped groups', () => {
    const vouchers = [
      { id: 1, status: 0 },
      { id: 2, status: 1 },
      { id: 3, status: 2 },
      { id: 4, status: 0 }
    ]

    const result = splitVouchersByBatchAction('audit', vouchers)

    expect(result.applicable.map((voucher) => voucher.id)).toEqual([1, 4])
    expect(result.skipped.map((voucher) => voucher.id)).toEqual([2, 3])
  })
})

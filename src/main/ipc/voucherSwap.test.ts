import { describe, expect, it } from 'vitest'
import { buildVoucherSwapPlan, type VoucherSwapEntry, type VoucherSwapVoucher } from './voucherSwap'

const createVoucher = (overrides: Partial<VoucherSwapVoucher>): VoucherSwapVoucher => ({
  id: 1,
  ledgerId: 1,
  period: '2026-03',
  voucherDate: '2026-03-01',
  status: 0,
  creatorId: 11,
  auditorId: null,
  bookkeeperId: null,
  attachmentCount: 0,
  isCarryForward: 0,
  ...overrides
})

const createEntry = (overrides: Partial<VoucherSwapEntry>): VoucherSwapEntry => ({
  rowOrder: 1,
  summary: '\u6458\u8981',
  subjectCode: '1001',
  debitAmount: 1000,
  creditAmount: 0,
  auxiliaryItemId: null,
  cashFlowItemId: null,
  ...overrides
})

describe('buildVoucherSwapPlan', () => {
  it('swaps voucher contents while keeping voucher ids fixed', () => {
    const firstVoucher = createVoucher({
      id: 101,
      voucherDate: '2026-03-05',
      status: 0,
      creatorId: 1,
      auditorId: null,
      bookkeeperId: null,
      attachmentCount: 1,
      isCarryForward: 0
    })
    const secondVoucher = createVoucher({
      id: 202,
      voucherDate: '2026-03-18',
      status: 2,
      creatorId: 8,
      auditorId: 9,
      bookkeeperId: 10,
      attachmentCount: 3,
      isCarryForward: 1
    })

    const firstEntries = [
      createEntry({ summary: '\u7532', subjectCode: '1001', debitAmount: 8800 })
    ]
    const secondEntries = [
      createEntry({ summary: '\u4e59', subjectCode: '6001', debitAmount: 0, creditAmount: 8800 })
    ]

    const plan = buildVoucherSwapPlan(firstVoucher, secondVoucher, firstEntries, secondEntries)

    expect(plan.firstVoucherId).toBe(101)
    expect(plan.secondVoucherId).toBe(202)
    expect(plan.firstVoucherUpdate).toEqual({
      voucherDate: '2026-03-18',
      status: 2,
      creatorId: 8,
      auditorId: 9,
      bookkeeperId: 10,
      attachmentCount: 3,
      isCarryForward: 1
    })
    expect(plan.secondVoucherUpdate).toEqual({
      voucherDate: '2026-03-05',
      status: 0,
      creatorId: 1,
      auditorId: null,
      bookkeeperId: null,
      attachmentCount: 1,
      isCarryForward: 0
    })
    expect(plan.firstVoucherEntries).toEqual(secondEntries)
    expect(plan.secondVoucherEntries).toEqual(firstEntries)
  })

  it('returns cloned entry snapshots instead of sharing references', () => {
    const firstEntries = [createEntry({ rowOrder: 1, summary: '\u7b2c\u4e00\u6761' })]
    const secondEntries = [createEntry({ rowOrder: 2, summary: '\u7b2c\u4e8c\u6761' })]

    const plan = buildVoucherSwapPlan(
      createVoucher({ id: 1 }),
      createVoucher({ id: 2 }),
      firstEntries,
      secondEntries
    )

    expect(plan.firstVoucherEntries).toEqual(secondEntries)
    expect(plan.secondVoucherEntries).toEqual(firstEntries)
    expect(plan.firstVoucherEntries[0]).not.toBe(secondEntries[0])
    expect(plan.secondVoucherEntries[0]).not.toBe(firstEntries[0])
  })
})

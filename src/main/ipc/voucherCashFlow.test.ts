import { describe, expect, it } from 'vitest'

import { resolveVoucherCashFlowEntries } from './voucher'

describe('resolveVoucherCashFlowEntries', () => {
  it('keeps internal cash transfers unassigned during voucher updates', () => {
    const result = resolveVoucherCashFlowEntries(
      [
        {
          summary: '银行提现',
          subjectCode: '1002',
          debitCents: 0,
          creditCents: 250000,
          cashFlowItemId: null
        },
        {
          summary: '银行提现',
          subjectCode: '1001',
          debitCents: 250000,
          creditCents: 0,
          cashFlowItemId: null
        }
      ],
      new Map([
        ['1002', { is_cash_flow: 1 }],
        ['1001', { is_cash_flow: 1 }]
      ]),
      []
    )

    expect(result.error).toBeUndefined()
    expect(result.entries[0].cashFlowItemId).toBeNull()
    expect(result.entries[1].cashFlowItemId).toBeNull()
  })

  it('still reports missing rules when a cash flow subject has non-cash counterpart', () => {
    const result = resolveVoucherCashFlowEntries(
      [
        {
          summary: '支付货款',
          subjectCode: '1002',
          debitCents: 0,
          creditCents: 880000,
          cashFlowItemId: null
        },
        {
          summary: '支付货款',
          subjectCode: '2202',
          debitCents: 880000,
          creditCents: 0,
          cashFlowItemId: null
        }
      ],
      new Map([
        ['1002', { is_cash_flow: 1 }],
        ['2202', { is_cash_flow: 0 }]
      ]),
      []
    )

    expect(result.error).toContain('未命中现金流量匹配规则')
  })
})

import { describe, expect, it } from 'vitest'
import { assertVoucherSwapAllowed, normalizeEmergencyReversalPayload } from './voucherControl'

describe('voucherControl service', () => {
  it('requires reason and approval tag for emergency reversal', () => {
    expect(() => normalizeEmergencyReversalPayload({ reason: ' ', approvalTag: 'A-1' })).toThrow(
      '管理员紧急逆转必须填写原因'
    )
    expect(() => normalizeEmergencyReversalPayload({ reason: '补录冲销', approvalTag: '' })).toThrow(
      '管理员紧急逆转必须填写审批标记'
    )
    expect(
      normalizeEmergencyReversalPayload({ reason: '补录冲销', approvalTag: 'A-1' })
    ).toEqual({
      reason: '补录冲销',
      approvalTag: 'A-1'
    })
  })

  it('blocks swapping posted or deleted vouchers', () => {
    expect(() => assertVoucherSwapAllowed([{ status: 0 }, { status: 2 }])).toThrow(
      '已记账凭证不允许交换位置'
    )
    expect(() => assertVoucherSwapAllowed([{ status: 1 }, { status: 3 }])).toThrow(
      '已删除凭证不允许交换位置'
    )
    expect(() => assertVoucherSwapAllowed([{ status: 0 }, { status: 1 }])).not.toThrow()
  })
})

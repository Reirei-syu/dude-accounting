export interface EmergencyReversalInput {
  reason?: string | null
  approvalTag?: string | null
}

export interface EmergencyReversalPayload {
  reason: string
  approvalTag: string
}

export interface VoucherStatusCarrier {
  status: number
}

export function normalizeEmergencyReversalPayload(
  input: EmergencyReversalInput
): EmergencyReversalPayload {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const approvalTag = typeof input.approvalTag === 'string' ? input.approvalTag.trim() : ''

  if (!reason) {
    throw new Error('反记账必须填写原因')
  }

  if (!approvalTag) {
    throw new Error('反记账必须填写审批标记')
  }

  return { reason, approvalTag }
}

export function assertVoucherSwapAllowed(vouchers: VoucherStatusCarrier[]): void {
  if (vouchers.some((voucher) => voucher.status === 2)) {
    throw new Error('已记账凭证不允许交换位置')
  }

  if (vouchers.some((voucher) => voucher.status === 3)) {
    throw new Error('已删除凭证不允许交换位置')
  }
}

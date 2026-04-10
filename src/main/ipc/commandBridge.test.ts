import { describe, expect, it } from 'vitest'
import { toLegacySuccess } from './commandBridge'

describe('commandBridge', () => {
  it('preserves command error code and details in legacy error payloads', () => {
    const result = toLegacySuccess({
      status: 'error',
      data: null,
      error: {
        code: 'RISK_CONFIRMATION_REQUIRED',
        message: '当前账套仍缺少已校验备份或电子档案导出，请显式确认风险后再继续删除。',
        details: {
          riskConfirmed: false
        }
      }
    })

    expect(result).toEqual({
      success: false,
      error: '当前账套仍缺少已校验备份或电子档案导出，请显式确认风险后再继续删除。',
      errorCode: 'RISK_CONFIRMATION_REQUIRED',
      errorDetails: {
        riskConfirmed: false
      }
    })
  })
})

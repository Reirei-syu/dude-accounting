import { describe, expect, it } from 'vitest'
import { buildValidationFeedback } from './backupValidationFeedback'

describe('backupValidationFeedback', () => {
  it('marks successful validation as reloadable success feedback', () => {
    expect(
      buildValidationFeedback(
        {
          success: true,
          valid: true,
          actualChecksum: 'checksum-1'
        },
        '校验通过',
        '校验失败'
      )
    ).toEqual({
      shouldReload: true,
      message: {
        type: 'success',
        text: '校验通过'
      }
    })
  })

  it('marks failed validation with checksum output as reloadable error feedback', () => {
    expect(
      buildValidationFeedback(
        {
          success: false,
          valid: false,
          actualChecksum: 'checksum-2',
          error: '校验不通过'
        },
        '校验通过',
        '校验失败'
      )
    ).toEqual({
      shouldReload: true,
      message: {
        type: 'error',
        text: '校验不通过'
      }
    })
  })

  it('keeps non-validation command failures as non-reloadable errors', () => {
    expect(
      buildValidationFeedback(
        {
          success: false,
          error: '归档记录不存在'
        },
        '校验通过',
        '校验失败'
      )
    ).toEqual({
      shouldReload: false,
      message: {
        type: 'error',
        text: '归档记录不存在'
      }
    })
  })
})

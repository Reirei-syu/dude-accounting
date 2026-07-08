import { describe, expect, it } from 'vitest'
import { looksLikeMojibake, normalizeUserTextOrThrow, recoverMojibake } from './mojibake'

describe('mojibake recovery helpers', () => {
  it('keeps normal Chinese text unchanged', () => {
    expect(recoverMojibake('收到基本户利息').text).toBe('收到基本户利息')
    expect(recoverMojibake('收到基本户利息').recovered).toBe(false)
  })

  it('recovers utf8 text that was decoded as gb18030', () => {
    expect(recoverMojibake('鏀粯瀵硅处鍗曟墜缁垂').text).toBe('支付对账单手续费')
  })

  it('detects replacement-character corruption as unrecoverable for write paths', () => {
    expect(looksLikeMojibake('�յ���������Ϣ')).toBe(true)
    expect(() =>
      normalizeUserTextOrThrow('�յ���������Ϣ', {
        field: 'entries[1].summary',
        label: '第1行摘要'
      })
    ).toThrow('疑似包含中文乱码')
  })
})

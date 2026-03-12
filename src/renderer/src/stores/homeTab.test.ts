import { describe, expect, it } from 'vitest'
import * as uiStore from './uiStore'

describe('home tab presets', () => {
  it('resolves supported home tab presets and rejects unknown presets', () => {
    const getHomeTabPreset = (
      uiStore as {
        getHomeTabPreset?: (
          key: string
        ) => { id: string; title: string; componentType: string } | null
      }
    ).getHomeTabPreset

    expect(typeof getHomeTabPreset).toBe('function')
    expect(getHomeTabPreset?.('voucher-entry')).toEqual({
      id: 'voucher-entry',
      title: '凭证录入',
      componentType: 'VoucherEntry'
    })
    expect(getHomeTabPreset?.('unknown')).toBeNull()
  })
})

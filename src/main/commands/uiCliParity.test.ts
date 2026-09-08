import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { getCommandMetadata } from './catalog'

describe('UI / CLI parity catalog', () => {
  it('共享接口清单中的每个方法都有 CLI 映射', () => {
    // preload 和主程序的真实注册另由 registrationContract.test.ts 执行验证。
    const mappedMethods = new Set<string>(
      getCommandMetadata().flatMap((item) => [...item.uiMethods, ...item.uiAssistedMethods])
    )
    const missing = Object.keys(IPC_CHANNELS)
      .map((channel) => `window.api.${channel.replace(':', '.')}`)
      .filter((method) => !mappedMethods.has(method))
    expect(missing).toEqual([])
  })
})

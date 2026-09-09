import { beforeEach, describe, expect, it } from 'vitest'
import { resolveStartupTabPreset, useUIStore } from './uiStore'

describe('首页导航与启动偏好', () => {
  beforeEach(() => useUIStore.getState().resetWorkspace())

  it('缺失或失效的启动偏好回退首页，已有有效偏好保持不变', () => {
    for (const key of [undefined, '', 'removed-page']) {
      expect(resolveStartupTabPreset(key).componentType).toBe('Home')
    }
    for (const key of [
      'voucher-entry',
      'voucher-list',
      'voucher-query',
      'subject-balance',
      'report-query'
    ]) {
      expect(resolveStartupTabPreset(key).id).toBe(key)
    }
  })

  it('首页占用空白标签后仍被重复导航复用，并收起已打开的功能菜单', () => {
    useUIStore.getState().addBlankTab()
    const blankId = useUIStore.getState().activeTabId
    useUIStore.getState().openTab(resolveStartupTabPreset('home'))
    expect(useUIStore.getState().activeTabId).toBe(blankId)
    useUIStore.getState().openTab(resolveStartupTabPreset('voucher-query'))
    useUIStore.getState().addBlankTab()
    useUIStore.getState().setSuspended('accounting')
    useUIStore.getState().openTab(resolveStartupTabPreset('home'))
    expect(useUIStore.getState().tabs.filter((tab) => tab.componentType === 'Home')).toHaveLength(1)
    expect(useUIStore.getState().activeTabId).toBe(blankId)
    expect(useUIStore.getState().isMenuSuspended).toBe(false)
    expect(useUIStore.getState().tabs).toHaveLength(3)
  })

  it('关闭首页后可以重新打开，其他业务页仍支持空白标签中的多个实例', () => {
    useUIStore.getState().openTab(resolveStartupTabPreset('home'))
    useUIStore.getState().closeTab('home')
    useUIStore.getState().openTab(resolveStartupTabPreset('home'))
    expect(useUIStore.getState().tabs).toHaveLength(1)
    useUIStore.getState().openTab(resolveStartupTabPreset('voucher-entry'))
    useUIStore.getState().addBlankTab()
    useUIStore.getState().openTab(resolveStartupTabPreset('voucher-entry'))
    expect(
      useUIStore.getState().tabs.filter((tab) => tab.componentType === 'VoucherEntry')
    ).toHaveLength(2)
  })
})

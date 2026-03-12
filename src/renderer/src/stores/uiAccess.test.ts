import { describe, expect, it } from 'vitest'
import * as uiStore from './uiStore'

type TestUser = {
  isAdmin: boolean
  permissions: Record<string, boolean>
}

const regularUser: TestUser = {
  isAdmin: false,
  permissions: {
    system_settings: false,
    ledger_settings: false
  }
}

const systemSettingsUser: TestUser = {
  isAdmin: false,
  permissions: {
    system_settings: true,
    ledger_settings: false
  }
}

const adminUser: TestUser = {
  isAdmin: true,
  permissions: {}
}

describe('ui access control', () => {
  it('hides permission-gated main modules for regular users without authorization', () => {
    const getVisibleMainModules = (
      uiStore as {
        getVisibleMainModules?: (
          user: typeof regularUser
        ) => Array<{ id: string; label: string }>
      }
    ).getVisibleMainModules

    expect(typeof getVisibleMainModules).toBe('function')
    expect(getVisibleMainModules?.(regularUser).map((item) => item.id)).toEqual([
      'accounting',
      'ledger-query',
      'reports'
    ])
  })

  it('hides system settings submenu for users without system settings permission', () => {
    const getVisibleModuleSubMenus = (
      uiStore as {
        getVisibleModuleSubMenus?: (
          module: string,
          standardType: 'enterprise' | 'npo',
          user: typeof regularUser
        ) => Array<{ id: string }>
      }
    ).getVisibleModuleSubMenus

    expect(typeof getVisibleModuleSubMenus).toBe('function')
    expect(getVisibleModuleSubMenus?.('system-settings', 'enterprise', regularUser)).toEqual([])
  })

  it('shows system settings module and submenu after authorization is granted', () => {
    const getVisibleMainModules = (
      uiStore as {
        getVisibleMainModules?: (
          user: typeof systemSettingsUser
        ) => Array<{ id: string; label: string }>
      }
    ).getVisibleMainModules
    const getVisibleModuleSubMenus = (
      uiStore as {
        getVisibleModuleSubMenus?: (
          module: string,
          standardType: 'enterprise' | 'npo',
          user: typeof systemSettingsUser
        ) => Array<{ id: string }>
      }
    ).getVisibleModuleSubMenus

    expect(getVisibleMainModules?.(systemSettingsUser).map((item) => item.id)).toContain(
      'system-settings'
    )
    expect(
      getVisibleModuleSubMenus?.('system-settings', 'enterprise', systemSettingsUser).map(
        (item) => item.id
      )
    ).toContain('system-params')
  })

  it('keeps all modules visible for administrators', () => {
    const getVisibleMainModules = (
      uiStore as {
        getVisibleMainModules?: (
          user: typeof regularUser
        ) => Array<{ id: string; label: string }>
      }
    ).getVisibleMainModules

    expect(
      getVisibleMainModules?.(adminUser).map((item) => item.id)
    ).toEqual(['ledger-settings', 'accounting', 'ledger-query', 'reports', 'system-settings'])
  })
})

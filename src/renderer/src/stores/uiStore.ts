import { create } from 'zustand'

export interface TabItem {
  id: string
  title: string
  componentType: string
  params?: Record<string, unknown>
}

export const BLANK_TAB_COMPONENT = '__blank_tab__'

export type AccountingStandardType = 'enterprise' | 'npo'
type MainModule = 'ledger-settings' | 'accounting' | 'ledger-query' | 'reports' | 'system-settings'

const isBlankTab = (tab: TabItem): boolean => tab.componentType === BLANK_TAB_COMPONENT

interface SubMenuItem {
  id: string
  title: string
  componentType: string
}

const REPORT_SUB_MENUS: Record<AccountingStandardType, SubMenuItem[]> = {
  enterprise: [
    { id: 'report-query', title: '报表查询', componentType: 'ReportQuery' },
    { id: 'balance-sheet', title: '资产负债表', componentType: 'BalanceSheet' },
    { id: 'income-statement', title: '利润表', componentType: 'IncomeStatement' },
    { id: 'cashflow-statement', title: '现金流量表', componentType: 'CashFlowStatement' },
    { id: 'equity-statement', title: '所有者权益变动表', componentType: 'EquityStatement' }
  ],
  npo: [
    { id: 'report-query', title: '报表查询', componentType: 'ReportQuery' },
    { id: 'balance-sheet', title: '资产负债表', componentType: 'BalanceSheet' },
    { id: 'activity-statement', title: '业务活动表', componentType: 'ActivityStatement' },
    { id: 'cashflow-statement', title: '现金流量表', componentType: 'CashFlowStatement' }
  ]
}

const BASE_MODULE_SUB_MENUS: Omit<Record<MainModule, SubMenuItem[]>, 'reports'> = {
  'ledger-settings': [
    { id: 'subject-settings', title: '会计科目设置', componentType: 'SubjectSettings' },
    { id: 'auxiliary-settings', title: '辅助账设置', componentType: 'AuxiliarySettings' },
    { id: 'initial-balance', title: '期初数录入', componentType: 'InitialBalance' },
    { id: 'cashflow-mapping', title: '现金流量匹配设置', componentType: 'CashFlowMapping' },
    { id: 'pl-carryforward', title: '期末损益结转设置', componentType: 'PLCarryForward' }
  ],
  accounting: [
    { id: 'voucher-entry', title: '凭证录入', componentType: 'VoucherEntry' },
    { id: 'voucher-list', title: '凭证管理', componentType: 'VoucherList' },
    { id: 'voucher-query', title: '凭证查询', componentType: 'VoucherQuery' },
    { id: 'pl-settle', title: '期末损益结转', componentType: 'PLSettle' },
    { id: 'period-close', title: '结账', componentType: 'PeriodClose' }
  ],
  'ledger-query': [
    { id: 'subject-balance', title: '科目余额表', componentType: 'SubjectBalance' },
    { id: 'detail-ledger', title: '科目明细账', componentType: 'DetailLedger' },
    { id: 'journal', title: '序时账', componentType: 'Journal' },
    { id: 'auxiliary-balance', title: '辅助余额表', componentType: 'AuxiliaryBalance' },
    { id: 'auxiliary-detail', title: '辅助明细账', componentType: 'AuxiliaryDetail' }
  ],
  'system-settings': [
    { id: 'system-params', title: '系统参数设置', componentType: 'SystemParams' },
    { id: 'user-management', title: '账号管理', componentType: 'UserManagement' },
    { id: 'accounting-standard', title: '会计准则设置', componentType: 'AccountingStandard' },
    { id: 'backup', title: '账套备份', componentType: 'Backup' }
  ]
}

export function getModuleSubMenus(
  module: MainModule,
  standardType: AccountingStandardType = 'enterprise'
): SubMenuItem[] {
  if (module === 'reports') {
    return REPORT_SUB_MENUS[standardType]
  }
  return BASE_MODULE_SUB_MENUS[module]
}

interface UIState {
  tabs: TabItem[]
  activeTabId: string | null
  isMenuSuspended: boolean
  suspendedModule: MainModule | null

  openTab: (tab: TabItem) => void
  addBlankTab: () => void
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setSuspended: (module: MainModule | null) => void
}

export const useUIStore = create<UIState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isMenuSuspended: false,
  suspendedModule: null,

  openTab: (tab) => {
    const { tabs, activeTabId } = get()
    const activeIndex = tabs.findIndex((item) => item.id === activeTabId)

    if (activeIndex >= 0 && isBlankTab(tabs[activeIndex])) {
      const blankId = tabs[activeIndex].id
      const nextTabs = [...tabs]
      nextTabs[activeIndex] = { ...tab, id: blankId }
      set({
        tabs: nextTabs,
        activeTabId: blankId,
        isMenuSuspended: false,
        suspendedModule: null
      })
      return
    }

    const existing = tabs.find((item) => !isBlankTab(item) && item.id === tab.id)
    if (existing) {
      const nextTabs = tabs.map((item) => (item.id === tab.id ? { ...item, ...tab } : item))
      set({
        tabs: nextTabs,
        activeTabId: tab.id,
        isMenuSuspended: false,
        suspendedModule: null
      })
    } else {
      set({
        tabs: [...tabs, tab],
        activeTabId: tab.id,
        isMenuSuspended: false,
        suspendedModule: null
      })
    }
  },

  addBlankTab: () => {
    const { tabs } = get()
    const blankId = `blank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const blankTab: TabItem = {
      id: blankId,
      title: '空白标签',
      componentType: BLANK_TAB_COMPONENT
    }

    set({
      tabs: [...tabs, blankTab],
      activeTabId: blankId,
      isMenuSuspended: false,
      suspendedModule: null
    })
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get()
    const newTabs = tabs.filter((item) => item.id !== tabId)
    let newActiveId = activeTabId
    if (activeTabId === tabId) {
      const closedIndex = tabs.findIndex((item) => item.id === tabId)
      if (newTabs.length > 0) {
        newActiveId = newTabs[Math.min(closedIndex, newTabs.length - 1)].id
      } else {
        newActiveId = null
      }
    }
    set({ tabs: newTabs, activeTabId: newActiveId })
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setSuspended: (module) =>
    set({
      isMenuSuspended: module !== null,
      suspendedModule: module
    })
}))

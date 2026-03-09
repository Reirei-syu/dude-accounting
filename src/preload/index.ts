import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  auth: {
    login: (username: string, password: string) =>
      ipcRenderer.invoke('auth:login', username, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getUsers: () => ipcRenderer.invoke('auth:getUsers'),
    createUser: (data: {
      username: string
      realName: string
      password: string
      permissions: Record<string, boolean>
    }) => ipcRenderer.invoke('auth:createUser', data),
    updateUser: (data: {
      id: number
      realName?: string
      password?: string
      permissions?: Record<string, boolean>
    }) => ipcRenderer.invoke('auth:updateUser', data),
    deleteUser: (userId: number) => ipcRenderer.invoke('auth:deleteUser', userId)
  },
  ledger: {
    getAll: () => ipcRenderer.invoke('ledger:getAll'),
    create: (data: { name: string; standardType: 'enterprise' | 'npo'; startPeriod: string }) =>
      ipcRenderer.invoke('ledger:create', data),
    update: (data: { id: number; name?: string; currentPeriod?: string }) =>
      ipcRenderer.invoke('ledger:update', data),
    delete: (id: number) => ipcRenderer.invoke('ledger:delete', id),
    getPeriods: (ledgerId: number) => ipcRenderer.invoke('ledger:getPeriods', ledgerId),
    getStandardTemplates: () => ipcRenderer.invoke('ledger:getStandardTemplates'),
    applyStandardTemplate: (data: { ledgerId: number; standardType: 'enterprise' | 'npo' }) =>
      ipcRenderer.invoke('ledger:applyStandardTemplate', data)
  },
  subject: {
    getAll: (ledgerId: number) => ipcRenderer.invoke('subject:getAll', ledgerId),
    search: (ledgerId: number, keyword: string) =>
      ipcRenderer.invoke('subject:search', ledgerId, keyword),
    create: (data: {
      ledgerId: number
      parentCode: string | null
      code: string
      name: string
      auxiliaryCategories: string[]
      customAuxiliaryItemIds?: number[]
      isCashFlow: boolean
    }) => ipcRenderer.invoke('subject:create', data),
    update: (data: {
      subjectId: number
      name?: string
      auxiliaryCategories?: string[]
      customAuxiliaryItemIds?: number[]
      isCashFlow?: boolean
    }) => ipcRenderer.invoke('subject:update', data),
    delete: (id: number) => ipcRenderer.invoke('subject:delete', id)
  },
  auxiliary: {
    getAll: (ledgerId: number) => ipcRenderer.invoke('auxiliary:getAll', ledgerId),
    getByCategory: (ledgerId: number, category: string) =>
      ipcRenderer.invoke('auxiliary:getByCategory', ledgerId, category),
    create: (data: { ledgerId: number; category: string; code: string; name: string }) =>
      ipcRenderer.invoke('auxiliary:create', data),
    update: (data: { id: number; code?: string; name?: string }) =>
      ipcRenderer.invoke('auxiliary:update', data),
    delete: (id: number) => ipcRenderer.invoke('auxiliary:delete', id)
  },
  cashflow: {
    getItems: (ledgerId: number) => ipcRenderer.invoke('cashflow:getItems', ledgerId),
    getMappings: (ledgerId: number) => ipcRenderer.invoke('cashflow:getMappings', ledgerId),
    createMapping: (data: {
      ledgerId: number
      subjectCode: string
      counterpartSubjectCode: string
      entryDirection: 'inflow' | 'outflow'
      cashFlowItemId: number
    }) => ipcRenderer.invoke('cashflow:createMapping', data),
    updateMapping: (data: {
      id: number
      subjectCode: string
      counterpartSubjectCode: string
      entryDirection: 'inflow' | 'outflow'
      cashFlowItemId: number
    }) => ipcRenderer.invoke('cashflow:updateMapping', data),
    deleteMapping: (id: number) => ipcRenderer.invoke('cashflow:deleteMapping', id)
  },
  plCarryForward: {
    listRules: (ledgerId: number) => ipcRenderer.invoke('plCarryForward:listRules', ledgerId),
    saveRules: (data: {
      ledgerId: number
      rules: Array<{
        fromSubjectCode: string
        toSubjectCode: string
      }>
    }) => ipcRenderer.invoke('plCarryForward:saveRules', data),
    preview: (data: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) =>
      ipcRenderer.invoke('plCarryForward:preview', data),
    execute: (data: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) =>
      ipcRenderer.invoke('plCarryForward:execute', data)
  },
  voucher: {
    getNextNumber: (ledgerId: number, period: string) =>
      ipcRenderer.invoke('voucher:getNextNumber', ledgerId, period),
    list: (query: {
      ledgerId: number
      period?: string
      dateFrom?: string
      dateTo?: string
      keyword?: string
      status?: 'all' | 0 | 1 | 2 | 3
    }) => ipcRenderer.invoke('voucher:list', query),
    getEntries: (voucherId: number) => ipcRenderer.invoke('voucher:getEntries', voucherId),
    batchAction: (payload: {
      action:
        | 'audit'
        | 'bookkeep'
        | 'unbookkeep'
        | 'unaudit'
        | 'delete'
        | 'restoreDelete'
        | 'purgeDelete'
      voucherIds: number[]
      reason?: string
      approvalTag?: string
    }) => ipcRenderer.invoke('voucher:batchAction', payload),
    swapPositions: (payload: { voucherIds: [number, number] | number[] }) =>
      ipcRenderer.invoke('voucher:swapPositions', payload),
    save: (data: {
      ledgerId: number
      voucherDate: string
      voucherWord?: string
      isCarryForward?: boolean
      entries: Array<{
        summary: string
        subjectCode: string
        debitAmount: string
        creditAmount: string
        cashFlowItemId: number | null
      }>
    }) => ipcRenderer.invoke('voucher:save', data),
    update: (data: {
      voucherId: number
      ledgerId: number
      voucherDate: string
      entries: Array<{
        summary: string
        subjectCode: string
        debitAmount: string
        creditAmount: string
        cashFlowItemId: number | null
      }>
    }) => ipcRenderer.invoke('voucher:update', data)
  },
  initialBalance: {
    list: (ledgerId: number, period: string) =>
      ipcRenderer.invoke('initialBalance:list', ledgerId, period),
    save: (data: {
      ledgerId: number
      period: string
      entries: Array<{
        subjectCode: string
        debitAmount: string
        creditAmount: string
      }>
    }) => ipcRenderer.invoke('initialBalance:save', data)
  },
  period: {
    getStatus: (ledgerId: number, period: string) =>
      ipcRenderer.invoke('period:getStatus', ledgerId, period),
    close: (data: { ledgerId: number; period: string }) => ipcRenderer.invoke('period:close', data),
    reopen: (data: { ledgerId: number; period: string }) =>
      ipcRenderer.invoke('period:reopen', data)
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },
  auditLog: {
    list: (filters?: {
      ledgerId?: number
      module?: string
      action?: string
      userId?: number
      keyword?: string
      limit?: number
    }) => ipcRenderer.invoke('auditLog:list', filters),
    export: (payload?: {
      filters?: {
        ledgerId?: number
        module?: string
        action?: string
        userId?: number
        keyword?: string
        limit?: number
      }
      filePath?: string
    }) => ipcRenderer.invoke('auditLog:export', payload)
  },
  backup: {
    create: (payload: { ledgerId: number; fiscalYear?: string | null }) =>
      ipcRenderer.invoke('backup:create', payload),
    list: (ledgerId?: number) => ipcRenderer.invoke('backup:list', ledgerId),
    validate: (backupId: number) => ipcRenderer.invoke('backup:validate', backupId),
    restore: (backupId: number) => ipcRenderer.invoke('backup:restore', backupId)
  },
  archive: {
    export: (payload: { ledgerId: number; fiscalYear: string }) =>
      ipcRenderer.invoke('archive:export', payload),
    list: (ledgerId?: number) => ipcRenderer.invoke('archive:list', ledgerId),
    getManifest: (exportId: number) => ipcRenderer.invoke('archive:getManifest', exportId)
  },
  eVoucher: {
    import: (payload: {
      ledgerId: number
      sourcePath: string
      sourceNumber?: string | null
      sourceDate?: string | null
      amountCents?: number | null
    }) => ipcRenderer.invoke('eVoucher:import', payload),
    list: (ledgerId: number) => ipcRenderer.invoke('eVoucher:list', ledgerId),
    verify: (payload: {
      recordId: number
      verificationStatus?: 'verified' | 'failed'
      verificationMethod?: string
      verificationMessage?: string
    }) => ipcRenderer.invoke('eVoucher:verify', payload),
    parse: (payload: {
      recordId: number
      sourceNumber?: string | null
      sourceDate?: string | null
      amountCents?: number | null
      counterpartName?: string | null
    }) => ipcRenderer.invoke('eVoucher:parse', payload),
    convert: (payload: { recordId: number; voucherDate?: string; voucherWord?: string }) =>
      ipcRenderer.invoke('eVoucher:convert', payload)
  },
  reporting: {
    generate: (payload: {
      ledgerId: number
      reportType:
        | 'balance_sheet'
        | 'income_statement'
        | 'activity_statement'
        | 'cashflow_statement'
      month?: string
      startPeriod?: string
      endPeriod?: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('reporting:generate', payload),
    list: (filters: {
      ledgerId: number
      reportTypes?: Array<
        'balance_sheet' | 'income_statement' | 'activity_statement' | 'cashflow_statement'
      >
      periods?: string[]
    }) => ipcRenderer.invoke('reporting:list', filters),
    getDetail: (payload: { snapshotId: number; ledgerId?: number }) =>
      ipcRenderer.invoke('reporting:getDetail', payload),
    export: (payload: { snapshotId: number; ledgerId?: number; format: 'xlsx' | 'pdf' }) =>
      ipcRenderer.invoke('reporting:export', payload),
    delete: (payload: { snapshotId: number; ledgerId: number }) =>
      ipcRenderer.invoke('reporting:delete', payload)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Type-safe API for renderer process
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
    }) => ipcRenderer.invoke('voucher:list', query),
    getEntries: (voucherId: number) => ipcRenderer.invoke('voucher:getEntries', voucherId),
    batchAction: (payload: {
      action: 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'
      voucherIds: number[]
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
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

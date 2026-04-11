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
      ledgerIds?: number[]
    }) => ipcRenderer.invoke('auth:createUser', data),
    updateUser: (data: {
      id: number
      realName?: string
      password?: string
      permissions?: Record<string, boolean>
      ledgerIds?: number[]
    }) => ipcRenderer.invoke('auth:updateUser', data),
    deleteUser: (userId: number) => ipcRenderer.invoke('auth:deleteUser', userId)
  },
  ledger: {
    getAll: () => ipcRenderer.invoke('ledger:getAll'),
    create: (data: { name: string; standardType: 'enterprise' | 'npo'; startPeriod: string }) =>
      ipcRenderer.invoke('ledger:create', data),
    update: (data: { id: number; name?: string; currentPeriod?: string }) =>
      ipcRenderer.invoke('ledger:update', data),
    delete: (payload: { ledgerId: number; riskAcknowledged?: boolean }) =>
      ipcRenderer.invoke('ledger:delete', payload),
    getDeletionRisk: (ledgerId: number) => ipcRenderer.invoke('ledger:getDeletionRisk', ledgerId),
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
      voucherId?: number
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
    getSystemParams: () => ipcRenderer.invoke('settings:getSystemParams'),
    getRuntimeDefaults: () => ipcRenderer.invoke('settings:getRuntimeDefaults'),
    getUserPreferences: () => ipcRenderer.invoke('settings:getUserPreferences'),
    getWallpaperState: () => ipcRenderer.invoke('settings:getWallpaperState'),
    getLoginWallpaperState: () => ipcRenderer.invoke('settings:getLoginWallpaperState'),
    getErrorLogStatus: () => ipcRenderer.invoke('settings:getErrorLogStatus'),
    chooseDiagnosticsLogDirectory: () =>
      ipcRenderer.invoke('settings:chooseDiagnosticsLogDirectory'),
    restoreDefaultDiagnosticsLogDirectory: () =>
      ipcRenderer.invoke('settings:restoreDefaultDiagnosticsLogDirectory'),
    setSystemParam: (
      key:
        | 'allow_same_maker_auditor'
        | 'default_voucher_word'
        | 'new_voucher_date_strategy'
        | 'voucher_list_default_status',
      value: string
    ) =>
      ipcRenderer.invoke('settings:setSystemParam', key, value),
    setUserPreferences: (preferences: Record<string, string>) =>
      ipcRenderer.invoke('settings:setUserPreferences', preferences),
    openErrorLogDirectory: () => ipcRenderer.invoke('settings:openErrorLogDirectory'),
    exportDiagnosticsLogs: (payload?: { directoryPath?: string }) =>
      ipcRenderer.invoke('settings:exportDiagnosticsLogs', payload),
    chooseWallpaper: () => ipcRenderer.invoke('settings:chooseWallpaper'),
    applyWallpaperCrop: (payload:
      | { extension: string; bytes: number[]; sourcePath?: string }
      | {
          sourcePath: string
          extension?: string
          viewport?: {
            scale: number
            minScale: number
            maxScale: number
            offsetX: number
            offsetY: number
          }
          useSuggestedViewport?: boolean
        }) =>
      ipcRenderer.invoke('settings:applyWallpaperCrop', payload),
    restoreDefaultWallpaper: () => ipcRenderer.invoke('settings:restoreDefaultWallpaper'),
    getSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:getSubjectTemplate', standardType),
    getSubjectTemplateReference: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:getSubjectTemplateReference', standardType),
    listIndependentCustomSubjectTemplates: () =>
      ipcRenderer.invoke('settings:listIndependentCustomSubjectTemplates'),
    getIndependentCustomSubjectTemplate: (templateId: string) =>
      ipcRenderer.invoke('settings:getIndependentCustomSubjectTemplate', templateId),
    parseSubjectTemplateImport: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:parseSubjectTemplateImport', standardType),
    saveSubjectTemplate: (payload: {
      standardType: 'enterprise' | 'npo'
      templateName?: string
      templateDescription?: string | null
      entries: Array<{
        code: string
        name: string
        category: string
        balanceDirection: 1 | -1
        isCashFlow: boolean
        enabled: boolean
        sortOrder: number
        carryForwardTargetCode: string | null
        note: string | null
      }>
    }) => ipcRenderer.invoke('settings:saveSubjectTemplate', payload),
    saveIndependentCustomSubjectTemplate: (payload: {
      templateId?: string
      baseStandardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription?: string | null
      entries: Array<{
        code: string
        name: string
        category: string
        balanceDirection: 1 | -1
        isCashFlow: boolean
        enabled: boolean
        sortOrder: number
        carryForwardTargetCode: string | null
        note: string | null
      }>
    }) => ipcRenderer.invoke('settings:saveIndependentCustomSubjectTemplate', payload),
    downloadSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:downloadSubjectTemplate', standardType),
    importSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:importSubjectTemplate', standardType),
    clearSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      ipcRenderer.invoke('settings:clearSubjectTemplate', standardType),
    clearIndependentCustomSubjectTemplateEntries: (templateId: string) =>
      ipcRenderer.invoke('settings:clearIndependentCustomSubjectTemplateEntries', templateId),
    deleteIndependentCustomSubjectTemplate: (templateId: string) =>
      ipcRenderer.invoke('settings:deleteIndependentCustomSubjectTemplate', templateId)
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
    create: (payload: { ledgerId: number; period?: string | null; directoryPath?: string }) =>
      ipcRenderer.invoke('backup:create', payload),
    list: (ledgerId?: number) => ipcRenderer.invoke('backup:list', ledgerId),
    validate: (backupId: number) => ipcRenderer.invoke('backup:validate', backupId),
    import: (payload?: { backupId?: number; packagePath?: string }) =>
      ipcRenderer.invoke('backup:import', payload),
    delete: (payload: { backupId: number; deleteRecordOnly?: boolean }) =>
      ipcRenderer.invoke('backup:delete', payload),
    restore: (payload?: { backupId?: number; packagePath?: string }) =>
      ipcRenderer.invoke('backup:restore', payload)
  },
  archive: {
    export: (payload: { ledgerId: number; fiscalYear: string; directoryPath?: string }) =>
      ipcRenderer.invoke('archive:export', payload),
    list: (ledgerId?: number) => ipcRenderer.invoke('archive:list', ledgerId),
    validate: (exportId: number) => ipcRenderer.invoke('archive:validate', exportId),
    delete: (payload: { exportId: number; deleteRecordOnly?: boolean }) =>
      ipcRenderer.invoke('archive:delete', payload),
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
        | 'equity_statement'
      month?: string
      startPeriod?: string
      endPeriod?: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('reporting:generate', payload),
    list: (filters: {
      ledgerId: number
      reportTypes?: Array<
        | 'balance_sheet'
        | 'income_statement'
        | 'activity_statement'
        | 'cashflow_statement'
        | 'equity_statement'
      >
      periods?: string[]
    }) => ipcRenderer.invoke('reporting:list', filters),
    getDetail: (payload: { snapshotId: number; ledgerId?: number }) =>
      ipcRenderer.invoke('reporting:getDetail', payload),
    export: (payload: {
      snapshotId: number
      ledgerId?: number
      format: 'xlsx' | 'pdf'
      renderOptions?: {
        showCashflowPreviousAmount?: boolean
      }
    }) =>
      ipcRenderer.invoke('reporting:export', payload),
    exportBatch: (payload: {
      snapshotIds: number[]
      ledgerId?: number
      format: 'xlsx' | 'pdf'
      directoryPath?: string
    }) => ipcRenderer.invoke('reporting:exportBatch', payload),
    delete: (payload: { snapshotId: number; ledgerId: number }) =>
      ipcRenderer.invoke('reporting:delete', payload)
  },
  print: {
    prepare: (payload: Record<string, unknown>) => ipcRenderer.invoke('print:prepare', payload),
    getJobStatus: (jobId: string) => ipcRenderer.invoke('print:getJobStatus', jobId),
    getPreviewModel: (jobId: string) => ipcRenderer.invoke('print:getPreviewModel', jobId),
    openPreview: (jobId: string) => ipcRenderer.invoke('print:openPreview', jobId),
    updatePreviewSettings: (payload: {
      jobId: string
      settings: {
        orientation?: 'portrait' | 'landscape'
        scalePercent?: number
        marginPreset?: 'default' | 'narrow' | 'extra-narrow'
        densityPreset?: 'default' | 'compact' | 'ultra-compact'
      }
    }) => ipcRenderer.invoke('print:updatePreviewSettings', payload),
    print: (payload: string | { jobId: string }) => ipcRenderer.invoke('print:print', payload),
    exportPdf: (payload: string | { jobId: string }) => ipcRenderer.invoke('print:exportPdf', payload),
    dispose: (jobId: string) => ipcRenderer.invoke('print:dispose', jobId)
  },
  bookQuery: {
    listSubjectBalances: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      keyword?: string
      includeUnpostedVouchers?: boolean
      includeZeroBalance?: boolean
    }) => ipcRenderer.invoke('bookQuery:listSubjectBalances', query),
    getDetailLedger: (query: {
      ledgerId: number
      subjectCode: string
      startDate: string
      endDate: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('bookQuery:getDetailLedger', query),
    getJournal: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      subjectCodeStart?: string
      subjectCodeEnd?: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('bookQuery:getJournal', query),
    getAuxiliaryBalances: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      subjectCodeStart?: string
      subjectCodeEnd?: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('bookQuery:getAuxiliaryBalances', query),
    getAuxiliaryDetail: (query: {
      ledgerId: number
      subjectCode: string
      auxiliaryItemId: number
      startDate: string
      endDate: string
      includeUnpostedVouchers?: boolean
    }) => ipcRenderer.invoke('bookQuery:getAuxiliaryDetail', query),
    export: (payload: {
      ledgerId: number
      bookType: string
      title: string
      subtitle?: string
      ledgerName?: string
      titleMetaLines?: string[]
      subjectLabel?: string
      periodLabel?: string
      format: 'xlsx' | 'pdf'
      columns: Array<{
        key: string
        label: string
        align?: 'left' | 'center' | 'right'
      }>
      rows: Array<{
        key: string
        cells: Array<{
          value: string | number | null
          isAmount?: boolean
        }>
      }>
      filePath?: string
    }) => ipcRenderer.invoke('bookQuery:export', payload)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    ipcRenderer.send('diagnostics:rendererError', {
      type: 'error',
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack ?? null : null,
      filename: event.filename || null,
      lineno: event.lineno ?? null,
      colno: event.colno ?? null,
      href: window.location.href
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason =
      typeof event.reason === 'string'
        ? event.reason
        : event.reason instanceof Error
          ? event.reason.message
          : event.reason === undefined
            ? undefined
            : String(event.reason)

    ipcRenderer.send('diagnostics:rendererError', {
      type: 'unhandledrejection',
      message: reason,
      stack: event.reason instanceof Error ? event.reason.stack ?? null : null,
      reason,
      href: window.location.href
    })
  })
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-expect-error: fallback mode writes the bridged Electron API onto window directly.
  window.electron = electronAPI
  // @ts-expect-error: fallback mode writes the bridged renderer API onto window directly.
  window.api = api
}

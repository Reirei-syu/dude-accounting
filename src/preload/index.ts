import { contextBridge, ipcRenderer } from 'electron'
import type { TypedInvoke } from './invoke'
import type { DudeAPI } from '../shared/contracts/desktopApi'
import type { AuditLogFilters } from '../shared/contracts/auditLog'

const invoke: TypedInvoke = ipcRenderer.invoke.bind(ipcRenderer)

const api = {
  auth: {
    login: (username: string, password: string) => invoke('auth:login', username, password),
    logout: () => invoke('auth:logout'),
    getUsers: () => invoke('auth:getUsers'),
    createUser: (data: {
      username: string
      realName: string
      password: string
      permissions: Record<string, boolean>
      ledgerIds?: number[]
    }) => invoke('auth:createUser', data),
    updateUser: (data: {
      id: number
      isAdmin?: boolean
      isEnabled?: boolean
      realName?: string
      password?: string
      permissions?: Record<string, boolean>
      ledgerIds?: number[]
    }) => invoke('auth:updateUser', data),
    deleteUser: (userId: number) => invoke('auth:deleteUser', userId)
  },
  ledger: {
    getYearOverview: (query) => invoke('ledger:getYearOverview', query),
    getAll: () => invoke('ledger:getAll'),
    create: (data: {
      name: string
      standardType: 'enterprise' | 'npo'
      startPeriod: string
      taxpayerIdentificationNumber?: string
    }) => invoke('ledger:create', data),
    update: (data: {
      id: number
      name?: string
      currentPeriod?: string
      taxpayerIdentificationNumber?: string
    }) => invoke('ledger:update', data),
    delete: (payload: { ledgerId: number; riskAcknowledged?: boolean }) =>
      invoke('ledger:delete', payload),
    getDeletionRisk: (ledgerId: number) => invoke('ledger:getDeletionRisk', ledgerId),
    getPeriods: (ledgerId: number) => invoke('ledger:getPeriods', ledgerId),
    getStandardTemplates: () => invoke('ledger:getStandardTemplates'),
    applyStandardTemplate: (data: { ledgerId: number; standardType: 'enterprise' | 'npo' }) =>
      invoke('ledger:applyStandardTemplate', data)
  },
  subject: {
    getAll: (ledgerId: number) => invoke('subject:getAll', ledgerId),
    search: (ledgerId: number, keyword: string) => invoke('subject:search', ledgerId, keyword),
    create: (data: {
      ledgerId: number
      parentCode: string | null
      code: string
      name: string
      auxiliaryCategories: string[]
      customAuxiliaryItemIds?: number[]
      isCashFlow: boolean
    }) => invoke('subject:create', data),
    update: (data: {
      subjectId: number
      name?: string
      auxiliaryCategories?: string[]
      customAuxiliaryItemIds?: number[]
      isCashFlow?: boolean
    }) => invoke('subject:update', data),
    delete: (id: number) => invoke('subject:delete', id)
  },
  auxiliary: {
    getAll: (ledgerId: number) => invoke('auxiliary:getAll', ledgerId),
    getByCategory: (ledgerId: number, category: string) =>
      invoke('auxiliary:getByCategory', ledgerId, category),
    create: (data: { ledgerId: number; category: string; code: string; name: string }) =>
      invoke('auxiliary:create', data),
    update: (data: { id: number; code?: string; name?: string }) =>
      invoke('auxiliary:update', data),
    delete: (id: number) => invoke('auxiliary:delete', id)
  },
  cashflow: {
    getItems: (ledgerId: number) => invoke('cashflow:getItems', ledgerId),
    getMappings: (ledgerId: number) => invoke('cashflow:getMappings', ledgerId),
    createMapping: (data: {
      ledgerId: number
      subjectCode: string
      counterpartSubjectCode: string
      entryDirection: 'inflow' | 'outflow'
      cashFlowItemId: number
    }) => invoke('cashflow:createMapping', data),
    updateMapping: (data: {
      id: number
      subjectCode: string
      counterpartSubjectCode: string
      entryDirection: 'inflow' | 'outflow'
      cashFlowItemId: number
    }) => invoke('cashflow:updateMapping', data),
    deleteMapping: (id: number) => invoke('cashflow:deleteMapping', id)
  },
  plCarryForward: {
    listRules: (ledgerId: number) => invoke('plCarryForward:listRules', ledgerId),
    saveRules: (data: {
      ledgerId: number
      rules: Array<{
        fromSubjectCode: string
        toSubjectCode: string
      }>
    }) => invoke('plCarryForward:saveRules', data),
    preview: (data: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) =>
      invoke('plCarryForward:preview', data),
    execute: (data: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) =>
      invoke('plCarryForward:execute', data)
  },
  voucher: {
    getNextNumber: (ledgerId: number, period: string) =>
      invoke('voucher:getNextNumber', ledgerId, period),
    list: (query: {
      ledgerId: number
      voucherId?: number
      period?: string
      dateFrom?: string
      dateTo?: string
      keyword?: string
      status?: 'all' | 0 | 1 | 2 | 3
    }) => invoke('voucher:list', query),
    getEntries: (voucherId: number) => invoke('voucher:getEntries', voucherId),
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
    }) => invoke('voucher:batchAction', payload),
    swapPositions: (payload: { voucherIds: [number, number] | number[] }) =>
      invoke('voucher:swapPositions', payload),
    renumber: (payload: { ledgerId: number; period: string }) =>
      invoke('voucher:renumber', payload),
    save: (data: {
      ledgerId: number
      voucherDate: string
      voucherWord?: string
      isCarryForward?: boolean
      sourceRecordId?: number
      sourceFingerprint?: string
      entries: Array<{
        summary: string
        subjectCode: string
        debitAmount: string
        creditAmount: string
        cashFlowItemId: number | null
      }>
    }) => invoke('voucher:save', data),
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
    }) => invoke('voucher:update', data)
  },
  initialBalance: {
    list: (ledgerId: number, period: string) => invoke('initialBalance:list', ledgerId, period),
    save: (data: {
      ledgerId: number
      period: string
      entries: Array<{
        subjectCode: string
        debitAmount: string
        creditAmount: string
      }>
    }) => invoke('initialBalance:save', data)
  },
  period: {
    getStatus: (ledgerId: number, period: string) => invoke('period:getStatus', ledgerId, period),
    close: (data: { ledgerId: number; period: string }) => invoke('period:close', data),
    reopen: (data: { ledgerId: number; period: string }) => invoke('period:reopen', data)
  },
  settings: {
    getSystemParams: () => invoke('settings:getSystemParams'),
    getRuntimeDefaults: () => invoke('settings:getRuntimeDefaults'),
    getUserPreferences: () => invoke('settings:getUserPreferences'),
    getWallpaperState: () => invoke('settings:getWallpaperState'),
    getLoginWallpaperState: () => invoke('settings:getLoginWallpaperState'),
    getErrorLogStatus: () => invoke('settings:getErrorLogStatus'),
    chooseDiagnosticsLogDirectory: () => invoke('settings:chooseDiagnosticsLogDirectory'),
    restoreDefaultDiagnosticsLogDirectory: () =>
      invoke('settings:restoreDefaultDiagnosticsLogDirectory'),
    setSystemParam: (
      key:
        | 'allow_same_maker_auditor'
        | 'default_voucher_word'
        | 'new_voucher_date_strategy'
        | 'voucher_list_default_status',
      value: string
    ) => invoke('settings:setSystemParam', key, value),
    setUserPreferences: (preferences: Record<string, string>) =>
      invoke('settings:setUserPreferences', preferences),
    openErrorLogDirectory: () => invoke('settings:openErrorLogDirectory'),
    exportDiagnosticsLogs: (payload?: { directoryPath?: string }) =>
      invoke('settings:exportDiagnosticsLogs', payload),
    chooseWallpaper: () => invoke('settings:chooseWallpaper'),
    applyWallpaperCrop: (
      payload:
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
          }
    ) => invoke('settings:applyWallpaperCrop', payload),
    restoreDefaultWallpaper: () => invoke('settings:restoreDefaultWallpaper'),
    getSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:getSubjectTemplate', standardType),
    getSubjectTemplateReference: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:getSubjectTemplateReference', standardType),
    listIndependentCustomSubjectTemplates: () =>
      invoke('settings:listIndependentCustomSubjectTemplates'),
    getIndependentCustomSubjectTemplate: (templateId: string) =>
      invoke('settings:getIndependentCustomSubjectTemplate', templateId),
    parseSubjectTemplateImport: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:parseSubjectTemplateImport', standardType),
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
    }) => invoke('settings:saveSubjectTemplate', payload),
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
    }) => invoke('settings:saveIndependentCustomSubjectTemplate', payload),
    downloadSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:downloadSubjectTemplate', standardType),
    importSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:importSubjectTemplate', standardType),
    clearSubjectTemplate: (standardType: 'enterprise' | 'npo') =>
      invoke('settings:clearSubjectTemplate', standardType),
    clearIndependentCustomSubjectTemplateEntries: (templateId: string) =>
      invoke('settings:clearIndependentCustomSubjectTemplateEntries', templateId),
    deleteIndependentCustomSubjectTemplate: (templateId: string) =>
      invoke('settings:deleteIndependentCustomSubjectTemplate', templateId)
  },
  auditLog: {
    list: (filters?: AuditLogFilters) => invoke('auditLog:list', filters),
    export: (payload?: {
      filters?: AuditLogFilters
      filePath?: string
      operationId?: string
      choosePath?: boolean
    }) => invoke('auditLog:export', payload)
  },
  backup: {
    create: (payload: {
      operationId?: string
      ledgerId: number
      period?: string | null
      directoryPath?: string
    }) => invoke('backup:create', payload),
    list: (ledgerId?: number) => invoke('backup:list', ledgerId),
    validate: (backupId: number) => invoke('backup:validate', backupId),
    import: (payload?: { operationId?: string; backupId?: number; packagePath?: string }) =>
      invoke('backup:import', payload),
    delete: (payload: { operationId?: string; backupId: number; deleteRecordOnly?: boolean }) =>
      invoke('backup:delete', payload),
    restore: (payload?: { operationId?: string; backupId?: number; packagePath?: string }) =>
      invoke('backup:restore', payload)
  },
  archive: {
    export: (payload: {
      operationId?: string
      ledgerId: number
      fiscalYear: string
      directoryPath?: string
    }) => invoke('archive:export', payload),
    list: (ledgerId?: number) => invoke('archive:list', ledgerId),
    validate: (exportId: number) => invoke('archive:validate', exportId),
    delete: (payload: { operationId?: string; exportId: number; deleteRecordOnly?: boolean }) =>
      invoke('archive:delete', payload),
    getManifest: (exportId: number) => invoke('archive:getManifest', exportId)
  },
  eVoucher: {
    link: (payload: { recordId: number; voucherId: number; sourceFingerprint: string }) =>
      invoke('eVoucher:link', payload),
    import: (payload: {
      operationId?: string
      ledgerId: number
      sourcePath: string
      sourceNumber?: string | null
      sourceDate?: string | null
      amountCents?: number | null
    }) => invoke('eVoucher:import', payload),
    list: (ledgerId: number) => invoke('eVoucher:list', ledgerId),
    verify: (payload: {
      recordId: number
      verificationStatus?: 'verified' | 'failed'
      verificationMethod?: string
      verificationMessage?: string
      manualConfirmation?: boolean
    }) => invoke('eVoucher:verify', payload),
    parse: (payload: {
      recordId: number
      sourceNumber?: string | null
      sourceDate?: string | null
      amountCents?: number | null
      counterpartName?: string | null
    }) => invoke('eVoucher:parse', payload),
    convert: (payload: { recordId: number; voucherDate?: string; voucherWord?: string }) =>
      invoke('eVoucher:convert', payload)
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
    }) => invoke('reporting:generate', payload),
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
    }) => invoke('reporting:list', filters),
    getDetail: (payload: { snapshotId: number; ledgerId?: number }) =>
      invoke('reporting:getDetail', payload),
    export: (payload: {
      snapshotId: number
      ledgerId?: number
      format: 'xlsx' | 'pdf'
      renderOptions?: {
        showCashflowPreviousAmount?: boolean
      }
    }) => invoke('reporting:export', payload),
    exportBatch: (payload: {
      snapshotIds: number[]
      ledgerId?: number
      format: 'xlsx' | 'pdf'
      directoryPath?: string
      renderOptions?: {
        showCashflowPreviousAmount?: boolean
      }
    }) => invoke('reporting:exportBatch', payload),
    chooseTaxTemplateOutputDirectory: () => invoke('reporting:chooseTaxTemplateOutputDirectory'),
    exportTaxTemplate: (payload: {
      ledgerId: number
      declarationType: 'monthly' | 'quarterly' | 'annual'
      year: number
      month?: number
      quarter?: number
      directoryPath?: string
      outputPath?: string
      overwrite?: boolean
    }) => invoke('reporting:exportTaxTemplate', payload),
    delete: (payload: { snapshotId: number; ledgerId: number }) =>
      invoke('reporting:delete', payload)
  },
  print: {
    prepare: (payload) => invoke('print:prepare', payload),
    getJobStatus: (jobId: string) => invoke('print:getJobStatus', jobId),
    getPreviewModel: (jobId: string) => invoke('print:getPreviewModel', jobId),
    openPreview: (jobId: string) => invoke('print:openPreview', jobId),
    updatePreviewSettings: (payload: {
      jobId: string
      settings: {
        orientation?: 'portrait' | 'landscape'
        scalePercent?: number
        marginPreset?: 'default' | 'narrow' | 'extra-narrow'
        densityPreset?: 'default' | 'compact' | 'ultra-compact'
      }
    }) => invoke('print:updatePreviewSettings', payload),
    print: (payload: string | { jobId: string }) => invoke('print:print', payload),
    exportPdf: (payload: string | { jobId: string }) => invoke('print:exportPdf', payload),
    dispose: (jobId: string) => invoke('print:dispose', jobId)
  },
  bookQuery: {
    listSubjectBalances: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      keyword?: string
      includeUnpostedVouchers?: boolean
      includeZeroBalance?: boolean
    }) => invoke('bookQuery:listSubjectBalances', query),
    getDetailLedger: (query: {
      ledgerId: number
      subjectCode: string
      startDate: string
      endDate: string
      includeUnpostedVouchers?: boolean
    }) => invoke('bookQuery:getDetailLedger', query),
    getJournal: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      subjectCodeStart?: string
      subjectCodeEnd?: string
      includeUnpostedVouchers?: boolean
    }) => invoke('bookQuery:getJournal', query),
    getAuxiliaryBalances: (query: {
      ledgerId: number
      startDate: string
      endDate: string
      subjectCodeStart?: string
      subjectCodeEnd?: string
      includeUnpostedVouchers?: boolean
    }) => invoke('bookQuery:getAuxiliaryBalances', query),
    getAuxiliaryDetail: (query: {
      ledgerId: number
      subjectCode: string
      auxiliaryItemId: number
      startDate: string
      endDate: string
      includeUnpostedVouchers?: boolean
    }) => invoke('bookQuery:getAuxiliaryDetail', query),
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
    }) => invoke('bookQuery:export', payload)
  }
} satisfies DudeAPI

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    ipcRenderer.send('diagnostics:rendererError', {
      type: 'error',
      message: event.message,
      stack: event.error instanceof Error ? (event.error.stack ?? null) : null,
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
      stack: event.reason instanceof Error ? (event.reason.stack ?? null) : null,
      reason,
      href: window.location.href
    })
  })
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      process: { versions: { ...process.versions } }
    })
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}

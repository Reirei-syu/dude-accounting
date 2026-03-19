import { ElectronAPI } from '@electron-toolkit/preload'

interface AuthAPI {
  login: (
    username: string,
    password: string
  ) => Promise<{
    success: boolean
    error?: string
    user?: {
      id: number
      username: string
      realName: string
      permissions: Record<string, boolean>
      isAdmin: boolean
      ledgerIds: number[]
    }
  }>
  logout: () => Promise<{ success: boolean }>
  getUsers: () => Promise<
    Array<{
      id: number
      username: string
      realName: string
      permissions: Record<string, boolean>
      isAdmin: boolean
      ledgerIds: number[]
    }>
  >
  createUser: (data: {
    username: string
    realName: string
    password: string
    permissions: Record<string, boolean>
    ledgerIds?: number[]
  }) => Promise<{ success: boolean; error?: string }>
  updateUser: (data: {
    id: number
    realName?: string
    password?: string
    permissions?: Record<string, boolean>
    ledgerIds?: number[]
  }) => Promise<{ success: boolean; error?: string }>
  deleteUser: (userId: number) => Promise<{ success: boolean; error?: string }>
}

interface LedgerAPI {
  getAll: () => Promise<
    Array<{
      id: number
      name: string
      standard_type: 'enterprise' | 'npo'
      start_period: string
      current_period: string
      created_at: string
    }>
  >
  create: (data: {
    name: string
    standardType: 'enterprise' | 'npo'
    startPeriod: string
  }) => Promise<{ success: boolean; id?: number; error?: string }>
  update: (data: {
    id: number
    name?: string
    currentPeriod?: string
  }) => Promise<{ success: boolean; error?: string }>
  delete: (id: number) => Promise<{ success: boolean; error?: string }>
  getPeriods: (ledgerId: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      period: string
      is_closed: number
      closed_at: string | null
    }>
  >
  getStandardTemplates: () => Promise<
    Array<{
      standardType: 'enterprise' | 'npo'
      name: string
      subjectCount: number
      topLevelCount: number
      hasRestrictedSubAccounts: boolean
    }>
  >
  applyStandardTemplate: (data: {
    ledgerId: number
    standardType: 'enterprise' | 'npo'
  }) => Promise<{
    success: boolean
    error?: string
    subjectCount?: number
    ledger?: {
      id: number
      name: string
      standard_type: 'enterprise' | 'npo'
      start_period: string
      current_period: string
      created_at: string
    }
  }>
}

interface SubjectAPI {
  getAll: (ledgerId: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      code: string
      name: string
      parent_code: string | null
      category: string
      balance_direction: number
      has_auxiliary: number
      is_cash_flow: number
      level: number
      is_system: number
      auxiliary_categories: string[]
      auxiliary_custom_items: Array<{
        id: number
        code: string
        name: string
      }>
    }>
  >
  search: (
    ledgerId: number,
    keyword: string
  ) => Promise<
    Array<{
      id: number
      ledger_id: number
      code: string
      name: string
      category: string
      balance_direction: number
      is_cash_flow: number
    }>
  >
  create: (data: {
    ledgerId: number
    parentCode: string | null
    code: string
    name: string
    auxiliaryCategories: string[]
    customAuxiliaryItemIds?: number[]
    isCashFlow: boolean
  }) => Promise<{ success: boolean; error?: string }>
  update: (data: {
    subjectId: number
    name?: string
    auxiliaryCategories?: string[]
    customAuxiliaryItemIds?: number[]
    isCashFlow?: boolean
  }) => Promise<{ success: boolean; error?: string }>
  delete: (id: number) => Promise<{ success: boolean; error?: string }>
}

interface AuxiliaryAPI {
  getAll: (ledgerId: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      category: string
      code: string
      name: string
      created_at?: string
    }>
  >
  getByCategory: (
    ledgerId: number,
    category: string
  ) => Promise<
    Array<{
      id: number
      ledger_id: number
      category: string
      code: string
      name: string
      created_at?: string
    }>
  >
  create: (data: {
    ledgerId: number
    category: string
    code: string
    name: string
  }) => Promise<{ success: boolean; error?: string }>
  update: (data: { id: number; code?: string; name?: string }) => Promise<{
    success: boolean
    error?: string
  }>
  delete: (id: number) => Promise<{ success: boolean; error?: string }>
}

interface SettingsAPI {
  getSystemParams: () => Promise<{
    allow_same_maker_auditor: string
    default_voucher_word: string
    new_voucher_date_strategy: string
    voucher_list_default_status: string
  }>
  getRuntimeDefaults: () => Promise<{
    default_voucher_word: string
    new_voucher_date_strategy: string
    voucher_list_default_status: string
  }>
  getErrorLogStatus: () => Promise<{
    mode: 'default' | 'custom'
    defaultLogDirectory: string
    customLogDirectory: string | null
    logDirectory: string
    runtimeLogPath: string
    errorLogPath: string
    runtimeLogExists: boolean
    errorLogExists: boolean
  }>
  chooseDiagnosticsLogDirectory: () => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    status?: {
      mode: 'default' | 'custom'
      defaultLogDirectory: string
      customLogDirectory: string | null
      logDirectory: string
      runtimeLogPath: string
      errorLogPath: string
      runtimeLogExists: boolean
      errorLogExists: boolean
    }
  }>
  restoreDefaultDiagnosticsLogDirectory: () => Promise<{
    success: boolean
    error?: string
    status?: {
      mode: 'default' | 'custom'
      defaultLogDirectory: string
      customLogDirectory: string | null
      logDirectory: string
      runtimeLogPath: string
      errorLogPath: string
      runtimeLogExists: boolean
      errorLogExists: boolean
    }
  }>
  getWallpaperState: () => Promise<{
    mode: 'default' | 'custom'
    wallpaperPath: string | null
    wallpaperUrl: string | null
    recommendedResolution: string
    recommendedRatio: string
    maxFileSizeMb: number
    supportedFormats: string[]
  }>
  getLoginWallpaperState: () => Promise<{
    mode: 'default' | 'custom'
    wallpaperPath: string | null
    wallpaperUrl: string | null
      recommendedResolution: string
      recommendedRatio: string
      maxFileSizeMb: number
      supportedFormats: string[]
  }>
  getUserPreferences: () => Promise<Record<string, string>>
  setSystemParam: (
    key:
      | 'allow_same_maker_auditor'
      | 'default_voucher_word'
      | 'new_voucher_date_strategy'
      | 'voucher_list_default_status',
    value: string
  ) => Promise<{
    success: boolean
    error?: string
    key?: string
    value?: string
    changed?: boolean
  }>
  setUserPreferences: (preferences: Record<string, string>) => Promise<{ success: boolean }>
  openErrorLogDirectory: () => Promise<{
    success: boolean
    error?: string
    logDirectory?: string
  }>
  exportDiagnosticsLogs: (payload?: { directoryPath?: string }) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    exportDirectory?: string
    filePaths?: string[]
  }>
  chooseWallpaper: () => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    sourcePath?: string
    sourceDataUrl?: string
    extension?: string
  }>
  applyWallpaperCrop: (payload: {
    extension: string
    bytes: number[]
    sourcePath?: string
  }) => Promise<{
    success: boolean
    error?: string
    state?: {
      mode: 'default' | 'custom'
      wallpaperPath: string | null
      wallpaperUrl: string | null
      recommendedResolution: string
      recommendedRatio: string
      maxFileSizeMb: number
      supportedFormats: string[]
    }
  }>
  restoreDefaultWallpaper: () => Promise<{
    success: boolean
    error?: string
    state?: {
      mode: 'default' | 'custom'
      wallpaperPath: string | null
      wallpaperUrl: string | null
      recommendedResolution: string
      recommendedRatio: string
      maxFileSizeMb: number
      supportedFormats: string[]
    }
  }>
  getSubjectTemplate: (standardType: 'enterprise' | 'npo') => Promise<{
    standardType: 'enterprise' | 'npo'
    templateName: string
    templateDescription: string | null
    updatedAt: string | null
    entryCount: number
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
  }>
  getSubjectTemplateReference: (standardType: 'enterprise' | 'npo') => Promise<
    Array<{
      code: string
      name: string
      category: string
      balanceDirection: 1 | -1
      categoryLabel: string
      isCashFlow: boolean
    }>
  >
  listIndependentCustomSubjectTemplates: () => Promise<
    Array<{
      id: string
      baseStandardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string
      entryCount: number
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
    }>
  >
  getIndependentCustomSubjectTemplate: (templateId: string) => Promise<{
    id: string
    baseStandardType: 'enterprise' | 'npo'
    templateName: string
    templateDescription: string | null
    updatedAt: string
    entryCount: number
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
  } | null>
  parseSubjectTemplateImport: (standardType: 'enterprise' | 'npo') => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    sourcePath?: string
    template?: {
      standardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string | null
      entryCount: number
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
    }
  }>
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
  }) => Promise<{
    success: boolean
    error?: string
    template?: {
      standardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string | null
      entryCount: number
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
    }
  }>
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
  }) => Promise<{
    success: boolean
    error?: string
    template?: {
      id: string
      baseStandardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string
      entryCount: number
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
    }
  }>
  downloadSubjectTemplate: (standardType: 'enterprise' | 'npo') => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    filePath?: string
  }>
  importSubjectTemplate: (standardType: 'enterprise' | 'npo') => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    sourcePath?: string
    template?: {
      standardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string | null
      entryCount: number
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
    }
  }>
  clearSubjectTemplate: (standardType: 'enterprise' | 'npo') => Promise<{
    success: boolean
    error?: string
  }>
  clearIndependentCustomSubjectTemplateEntries: (templateId: string) => Promise<{
    success: boolean
    error?: string
    template?: {
      id: string
      baseStandardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string
      entryCount: number
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
    }
  }>
  deleteIndependentCustomSubjectTemplate: (templateId: string) => Promise<{
    success: boolean
    error?: string
    template?: {
      id: string
      baseStandardType: 'enterprise' | 'npo'
      templateName: string
      templateDescription: string | null
      updatedAt: string
      entryCount: number
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
    }
  }>
}

interface CashFlowAPI {
  getItems: (ledgerId: number) => Promise<
    Array<{
      id: number
      code: string
      name: string
      category: 'operating' | 'investing' | 'financing'
      direction: 'inflow' | 'outflow'
    }>
  >
  getMappings: (ledgerId: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      subject_code: string
      subject_name: string | null
      counterpart_subject_code: string
      counterpart_subject_name: string | null
      entry_direction: 'inflow' | 'outflow'
      cash_flow_item_id: number
      cash_flow_item_code: string | null
      cash_flow_item_name: string | null
    }>
  >
  createMapping: (data: {
    ledgerId: number
    subjectCode: string
    counterpartSubjectCode: string
    entryDirection: 'inflow' | 'outflow'
    cashFlowItemId: number
  }) => Promise<{ success: boolean; error?: string; id?: number }>
  updateMapping: (data: {
    id: number
    subjectCode: string
    counterpartSubjectCode: string
    entryDirection: 'inflow' | 'outflow'
    cashFlowItemId: number
  }) => Promise<{ success: boolean; error?: string }>
  deleteMapping: (id: number) => Promise<{ success: boolean; error?: string }>
}

interface PLCarryForwardAPI {
  listRules: (ledgerId: number) => Promise<
    Array<{
      id: number
      fromSubjectCode: string
      fromSubjectName: string
      toSubjectCode: string
      toSubjectName: string
    }>
  >
  saveRules: (data: {
    ledgerId: number
    rules: Array<{
      fromSubjectCode: string
      toSubjectCode: string
    }>
  }) => Promise<{
    success: boolean
    error?: string
    savedCount?: number
  }>
  preview: (data: {
    ledgerId: number
    period: string
    includeUnpostedVouchers?: boolean
  }) => Promise<{
    period: string
    voucherDate: string
    summary: string
    voucherWord: string
    includeUnpostedVouchers: boolean
    required: boolean
    canExecute: boolean
    blockedReason?: string
    totalDebit: number
    totalCredit: number
    entries: Array<{
      summary: string
      subjectCode: string
      subjectName: string
      debitAmount: number
      creditAmount: number
    }>
    existingVouchers: Array<{
      id: number
      voucherNumber: number
      voucherDate: string
      status: number
    }>
    draftVoucherIds: number[]
  }>
  execute: (data: {
    ledgerId: number
    period: string
    includeUnpostedVouchers?: boolean
  }) => Promise<{
    success: boolean
    error?: string
    voucherId?: number
    voucherNumber?: number
    status?: number
    voucherDate?: string
    removedDraftVoucherIds?: number[]
  }>
}

interface VoucherAPI {
  getNextNumber: (ledgerId: number, period: string) => Promise<number>
  list: (query: {
    ledgerId: number
    voucherId?: number
    period?: string
    dateFrom?: string
    dateTo?: string
    keyword?: string
    status?: 'all' | 0 | 1 | 2 | 3
  }) => Promise<
    Array<{
      id: number
      ledger_id: number
      period: string
      voucher_date: string
      voucher_number: number
      voucher_word: string
      status: 0 | 1 | 2 | 3
      first_summary: string
      creator_id: number | null
      auditor_id: number | null
      bookkeeper_id: number | null
      creator_name: string | null
      auditor_name: string | null
      bookkeeper_name: string | null
      total_debit: number
      total_credit: number
    }>
  >
  getEntries: (voucherId: number) => Promise<
    Array<{
      id: number
      voucher_id: number
      row_order: number
      summary: string
      subject_code: string
      debit_amount: number
      credit_amount: number
      cash_flow_item_id: number | null
      subject_name?: string
      cash_flow_code?: string
      cash_flow_name?: string
    }>
  >
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
  }) => Promise<{
    success: boolean
    error?: string
    processedCount?: number
    skippedCount?: number
    requestedCount?: number
  }>
  swapPositions: (payload: { voucherIds: [number, number] | number[] }) => Promise<{
    success: boolean
    error?: string
    voucherIds?: number[]
  }>
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
  }) => Promise<{
    success: boolean
    error?: string
    voucherId?: number
    voucherNumber?: number
    status?: number
  }>
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
  }) => Promise<{
    success: boolean
    error?: string
    voucherId?: number
    voucherNumber?: number
    status?: number
  }>
}

interface InitialBalanceAPI {
  list: (
    ledgerId: number,
    period: string
  ) => Promise<
    Array<{
      subject_code: string
      subject_name: string
      balance_direction: number
      debit_amount: number
      credit_amount: number
    }>
  >
  save: (data: {
    ledgerId: number
    period: string
    entries: Array<{
      subjectCode: string
      debitAmount: string
      creditAmount: string
    }>
  }) => Promise<{ success: boolean; error?: string }>
}

interface PeriodAPI {
  getStatus: (
    ledgerId: number,
    period: string
  ) => Promise<{
    period: string
    is_closed: number
    closed_at: string | null
    pending_audit_vouchers: Array<{
      id: number
      voucher_number: number
      voucher_word: string
      status: 0 | 1 | 2
      voucher_label: string
    }>
    pending_bookkeep_vouchers: Array<{
      id: number
      voucher_number: number
      voucher_word: string
      status: 0 | 1 | 2
      voucher_label: string
    }>
  }>
  close: (data: { ledgerId: number; period: string }) => Promise<{
    success: boolean
    error?: string
    carriedForward?: boolean
    nextPeriod?: string
    carriedCount?: number
  }>
  reopen: (data: { ledgerId: number; period: string }) => Promise<{
    success: boolean
    error?: string
  }>
}

interface AuditLogAPI {
  list: (filters?: {
    ledgerId?: number
    module?: string
    action?: string
    userId?: number
    keyword?: string
    limit?: number
  }) => Promise<
    Array<{
      id: number
      ledger_id: number | null
      user_id: number | null
      username: string | null
      module: string
      action: string
      target_type: string | null
      target_id: string | null
      reason: string | null
      approval_tag: string | null
      details_json: string
      created_at: string
    }>
  >
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
  }) => Promise<{
    success: boolean
    error?: string
    rowCount?: number
    filePath?: string
    csv?: string
  }>
}

interface BackupAPI {
  create: (payload: {
    ledgerId: number
    period?: string | null
    directoryPath?: string
  }) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    backupId?: number
    directoryPath?: string
    period?: string | null
    backupPath?: string
    manifestPath?: string
    checksum?: string
    fileSize?: number
  }>
  list: (ledgerId?: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      backup_period: string | null
      fiscal_year: string | null
      backup_path: string
      manifest_path: string | null
      checksum: string
      file_size: number
      status: 'generated' | 'validated' | 'failed'
      created_by: number | null
      created_at: string
      validated_at: string | null
    }>
  >
  validate: (backupId: number) => Promise<{
    success: boolean
    valid?: boolean
    actualChecksum?: string | null
    error?: string
  }>
  delete: (payload: { backupId: number; deleteRecordOnly?: boolean }) => Promise<{
    success: boolean
    deletedPhysicalPackage?: boolean
    deletedPaths?: string[]
    missingPhysicalPackage?: boolean
    requiresRecordDeletionConfirmation?: boolean
    packagePath?: string
    error?: string
  }>
  restore: (payload?: { backupId?: number; packagePath?: string }) => Promise<{
    success: boolean
    cancelled?: boolean
    restartRequired?: boolean
    error?: string
  }>
}

interface ArchiveAPI {
  export: (payload: {
    ledgerId: number
    fiscalYear: string
    directoryPath?: string
  }) => Promise<{
    success: boolean
    cancelled?: boolean
    exportId?: number
    directoryPath?: string
    exportPath?: string
    manifestPath?: string
    error?: string
  }>
  list: (ledgerId?: number) => Promise<
    Array<{
      id: number
      ledger_id: number
      fiscal_year: string
      export_path: string
      manifest_path: string
      checksum: string | null
      status: 'generated' | 'validated' | 'failed'
      item_count: number
      created_by: number | null
      created_at: string
      validated_at: string | null
    }>
  >
  validate: (exportId: number) => Promise<{
    success: boolean
    valid?: boolean
    actualChecksum?: string | null
    error?: string
  }>
  delete: (payload: { exportId: number; deleteRecordOnly?: boolean }) => Promise<{
    success: boolean
    deletedPhysicalPackage?: boolean
    deletedPaths?: string[]
    missingPhysicalPackage?: boolean
    requiresRecordDeletionConfirmation?: boolean
    packagePath?: string
    error?: string
  }>
  getManifest: (exportId: number) => Promise<{
    schemaVersion: '1.0'
    ledgerId: number
    ledgerName: string
    fiscalYear: string
    exportedAt: string
    counts: {
      originalVoucherFiles: number
      vouchers: number
      reports: number
    }
    metadata: Record<string, unknown>
  }>
}

interface ElectronicVoucherAPI {
  import: (payload: {
    ledgerId: number
    sourcePath: string
    sourceNumber?: string | null
    sourceDate?: string | null
    amountCents?: number | null
  }) => Promise<{
    success: boolean
    error?: string
    fileId?: number
    recordId?: number
    voucherType?: 'digital_invoice' | 'bank_receipt' | 'bank_statement' | 'unknown'
    fingerprint?: string
  }>
  list: (ledgerId: number) => Promise<Array<Record<string, unknown>>>
  verify: (payload: {
    recordId: number
    verificationStatus?: 'verified' | 'failed'
    verificationMethod?: string
    verificationMessage?: string
  }) => Promise<{
    success: boolean
    error?: string
    verificationStatus?: 'verified' | 'failed'
  }>
  parse: (payload: {
    recordId: number
    sourceNumber?: string | null
    sourceDate?: string | null
    amountCents?: number | null
    counterpartName?: string | null
  }) => Promise<{
    success: boolean
    error?: string
    structuredData?: Record<string, unknown>
  }>
  convert: (payload: { recordId: number; voucherDate?: string; voucherWord?: string }) => Promise<{
    success: boolean
    error?: string
    draftVoucher?: {
      ledgerId: number
      voucherDate: string
      voucherWord: string
      summary: string
      sourceRecordId: number
      entries: Array<{
        summary: string
        subjectCode: string
        debitAmount: string
        creditAmount: string
        cashFlowItemId: number | null
      }>
    }
  }>
}

type ReportType =
  | 'balance_sheet'
  | 'income_statement'
  | 'activity_statement'
  | 'cashflow_statement'
  | 'equity_statement'

interface ReportSnapshotLine {
  key: string
  label: string
  amountCents: number
  code?: string
  lineNo?: string
  cells?: Record<string, number>
}

interface ReportSnapshotSection {
  key: string
  title: string
  rows: ReportSnapshotLine[]
}

interface ReportSnapshotTotal {
  key: string
  label: string
  amountCents: number
}

interface ReportSnapshotTableCell {
  value: string | number | null
  isAmount?: boolean
}

interface ReportSnapshotTableRow {
  key: string
  cells: ReportSnapshotTableCell[]
}

interface ReportSnapshotTable {
  key: string
  columns: Array<{
    key: string
    label: string
  }>
  rows: ReportSnapshotTableRow[]
}

interface ReportSnapshotContent {
  title: string
  reportType: ReportType
  period: string
  ledgerName: string
  standardType: 'enterprise' | 'npo'
  generatedAt: string
  scope: {
    mode: 'month' | 'range'
    startPeriod: string
    endPeriod: string
    periodLabel: string
    startDate: string
    endDate: string
    asOfDate: string | null
    includeUnpostedVouchers: boolean
  }
  formCode?: string
  tableColumns?: Array<{
    key: string
    label: string
  }>
  tables?: ReportSnapshotTable[]
  sections: ReportSnapshotSection[]
  totals: ReportSnapshotTotal[]
}

interface ReportSnapshotSummary {
  id: number
  ledger_id: number
  report_type: ReportType
  report_name: string
  period: string
  start_period: string
  end_period: string
  as_of_date: string | null
  include_unposted_vouchers: number
  generated_by: number | null
  generated_at: string
  ledger_name: string
  standard_type: 'enterprise' | 'npo'
}

interface ReportSnapshotDetail extends ReportSnapshotSummary {
  content: ReportSnapshotContent
}

interface ReportingAPI {
  generate: (payload: {
    ledgerId: number
    reportType: ReportType
    month?: string
    startPeriod?: string
    endPeriod?: string
    includeUnpostedVouchers?: boolean
  }) => Promise<{
    success: boolean
    error?: string
    snapshot?: ReportSnapshotDetail
  }>
  list: (filters: {
    ledgerId: number
    reportTypes?: ReportType[]
    periods?: string[]
  }) => Promise<ReportSnapshotSummary[]>
  getDetail: (payload: { snapshotId: number; ledgerId?: number }) => Promise<ReportSnapshotDetail>
  export: (payload: { snapshotId: number; ledgerId?: number; format: 'xlsx' | 'pdf' }) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    filePath?: string
  }>
  exportBatch: (payload: {
    snapshotIds: number[]
    ledgerId?: number
    format: 'xlsx' | 'pdf'
    directoryPath?: string
  }) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    directoryPath?: string
    filePaths?: string[]
  }>
  delete: (payload: { snapshotId: number; ledgerId: number }) => Promise<{
    success: boolean
    error?: string
  }>
}

interface BookQueryAPI {
  listSubjectBalances: (query: {
    ledgerId: number
    startDate: string
    endDate: string
    keyword?: string
    includeUnpostedVouchers?: boolean
    includeZeroBalance?: boolean
  }) => Promise<
    Array<{
      subject_code: string
      subject_name: string
      category: string
      balance_direction: number
      level: number
      is_leaf: 0 | 1
      opening_debit_amount: number
      opening_credit_amount: number
      period_debit_amount: number
      period_credit_amount: number
      ending_debit_amount: number
      ending_credit_amount: number
    }>
  >
  getDetailLedger: (query: {
    ledgerId: number
    subjectCode: string
    startDate: string
    endDate: string
    includeUnpostedVouchers?: boolean
  }) => Promise<{
    subject: {
      code: string
      name: string
      balance_direction: number
    }
    startDate: string
    endDate: string
    rows: Array<{
      row_type: 'opening' | 'entry'
      voucher_id: number | null
      voucher_date: string
      voucher_number: number | null
      voucher_word: string | null
      summary: string
      debit_amount: number
      credit_amount: number
      balance_amount: number
      balance_side: 'debit' | 'credit' | 'flat'
    }>
  }>
  getJournal: (query: {
    ledgerId: number
    startDate: string
    endDate: string
    subjectCodeStart?: string
    subjectCodeEnd?: string
    includeUnpostedVouchers?: boolean
  }) => Promise<
    Array<{
      entry_id: number
      voucher_id: number
      voucher_date: string
      voucher_number: number
      voucher_word: string
      summary: string
      subject_code: string
      subject_name: string
      debit_amount: number
      credit_amount: number
    }>
  >
  getAuxiliaryBalances: (query: {
    ledgerId: number
    startDate: string
    endDate: string
    subjectCodeStart?: string
    subjectCodeEnd?: string
    includeUnpostedVouchers?: boolean
  }) => Promise<
    Array<{
      subject_code: string
      subject_name: string
      auxiliary_item_id: number
      auxiliary_category: string
      auxiliary_code: string
      auxiliary_name: string
      opening_debit_amount: number
      opening_credit_amount: number
      period_debit_amount: number
      period_credit_amount: number
      ending_debit_amount: number
      ending_credit_amount: number
    }>
  >
  getAuxiliaryDetail: (query: {
    ledgerId: number
    subjectCode: string
    auxiliaryItemId: number
    startDate: string
    endDate: string
    includeUnpostedVouchers?: boolean
  }) => Promise<{
    subject: {
      code: string
      name: string
      balance_direction: number
    }
    auxiliary: {
      id: number
      category: string
      code: string
      name: string
    }
    startDate: string
    endDate: string
    rows: Array<{
      row_type: 'opening' | 'entry'
      voucher_id: number | null
      voucher_date: string
      voucher_number: number | null
      voucher_word: string | null
      summary: string
      debit_amount: number
      credit_amount: number
      balance_amount: number
      balance_side: 'debit' | 'credit' | 'flat'
    }>
  }>
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
  }) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    filePath?: string
  }>
}

interface PrintAPI {
  prepare: (payload: Record<string, unknown>) => Promise<{
    success: boolean
    jobId?: string
    error?: string
  }>
  getJobStatus: (jobId: string) => Promise<{
    success: boolean
    status?: 'preparing' | 'ready' | 'failed'
    title?: string
    error?: string
  }>
  openPreview: (jobId: string) => Promise<{ success: boolean; error?: string }>
  print: (jobId: string) => Promise<{ success: boolean; error?: string }>
  exportPdf: (jobId: string) => Promise<{
    success: boolean
    cancelled?: boolean
    error?: string
    filePath?: string
  }>
  dispose: (jobId: string) => Promise<{ success: boolean; error?: string }>
}

interface DudeAPI {
  auth: AuthAPI
  ledger: LedgerAPI
  subject: SubjectAPI
  auxiliary: AuxiliaryAPI
  cashflow: CashFlowAPI
  plCarryForward: PLCarryForwardAPI
  voucher: VoucherAPI
  initialBalance: InitialBalanceAPI
  period: PeriodAPI
  settings: SettingsAPI
  auditLog: AuditLogAPI
  backup: BackupAPI
  archive: ArchiveAPI
  eVoucher: ElectronicVoucherAPI
  reporting: ReportingAPI
  print: PrintAPI
  bookQuery: BookQueryAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DudeAPI
  }
}

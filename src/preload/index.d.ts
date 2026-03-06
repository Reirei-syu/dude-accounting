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
    }>
  >
  createUser: (data: {
    username: string
    realName: string
    password: string
    permissions: Record<string, boolean>
  }) => Promise<{ success: boolean; error?: string }>
  updateUser: (data: {
    id: number
    realName?: string
    password?: string
    permissions?: Record<string, boolean>
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
  get: (key: string) => Promise<string | null>
  getAll: () => Promise<Record<string, string>>
  set: (key: string, value: string) => Promise<{ success: boolean }>
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
  preview: (data: { ledgerId: number; period: string }) => Promise<{
    period: string
    voucherDate: string
    summary: string
    voucherWord: string
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
  execute: (data: { ledgerId: number; period: string }) => Promise<{
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
    period?: string
    dateFrom?: string
    dateTo?: string
    keyword?: string
  }) => Promise<
    Array<{
      id: number
      ledger_id: number
      period: string
      voucher_date: string
      voucher_number: number
      voucher_word: string
      status: 0 | 1 | 2
      creator_id: number | null
      auditor_id: number | null
      bookkeeper_id: number | null
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
    action: 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'
    voucherIds: number[]
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
  }>
  close: (data: { ledgerId: number; period: string }) => Promise<{
    success: boolean
    error?: string
    carriedForward?: boolean
    nextPeriod?: string
    carriedCount?: number
  }>
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DudeAPI
  }
}

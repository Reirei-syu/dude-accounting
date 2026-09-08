
export type AccountingStandardType = 'enterprise' | 'npo'

export type ReportType =
  | 'balance_sheet'
  | 'income_statement'
  | 'activity_statement'
  | 'cashflow_statement'
  | 'equity_statement'

export interface ReportSnapshotLine {
  key: string
  label: string
  amountCents: number
  code?: string
  lineNo?: string
  cells?: Record<string, number>
}

export interface ReportSnapshotSection {
  key: string
  title: string
  rows: ReportSnapshotLine[]
}

export interface ReportSnapshotTotal {
  key: string
  label: string
  amountCents: number
}

export interface ReportSnapshotTableColumn {
  key: string
  label: string
}

export interface ReportSnapshotTableCell {
  value: string | number | null
  isAmount?: boolean
}

export interface ReportSnapshotTableRow {
  key: string
  cells: ReportSnapshotTableCell[]
}

export interface ReportSnapshotTable {
  key: string
  columns: ReportSnapshotTableColumn[]
  rows: ReportSnapshotTableRow[]
}

export interface ReportSnapshotScope {
  mode: 'month' | 'range'
  startPeriod: string
  endPeriod: string
  periodLabel: string
  startDate: string
  endDate: string
  asOfDate: string | null
  includeUnpostedVouchers: boolean
}

export interface ReportSnapshotContent {
  title: string
  reportType: ReportType
  period: string
  ledgerName: string
  standardType: AccountingStandardType
  generatedAt: string
  scope: ReportSnapshotScope
  formCode?: string
  tableColumns?: Array<{ key: string; label: string }>
  tables?: ReportSnapshotTable[]
  sections: ReportSnapshotSection[]
  totals: ReportSnapshotTotal[]
}

export interface ReportSnapshotSummary {
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
  standard_type: AccountingStandardType
}

export interface ReportSnapshotDetail extends ReportSnapshotSummary {
  content: ReportSnapshotContent
}

export interface ReportListFilters {
  ledgerId: number
  reportTypes?: ReportType[]
  periods?: string[]
}

export interface GenerateReportSnapshotParams {
  ledgerId: number
  reportType: ReportType
  month?: string
  startPeriod?: string
  endPeriod?: string
  includeUnpostedVouchers?: boolean
  generatedBy?: number | null
  now?: string | Date
}

export interface BuildReportSnapshotContentOptions {
  activityCurrentPeriod?: string | null
}

export interface DuplicateReportSnapshotRow {
  id: number
}

export type ReportExportFormat = 'xlsx' | 'pdf'

export type LedgerRow = {
  id: number
  name: string
  standard_type: AccountingStandardType
  start_period: string
  current_period: string
}

export type SubjectRow = {
  code: string
  name: string
  category: string
  balance_direction: number
}

export type InitialBalanceRow = {
  subject_code: string
  period: string
  debit_amount: number
  credit_amount: number
}

export type VoucherRow = {
  id: number
  period: string
  voucher_date: string
  status: 0 | 1 | 2
  is_carry_forward: number
}

export type VoucherEntryRow = {
  id: number
  voucher_id: number
  row_order: number
  subject_code: string
  debit_amount: number
  credit_amount: number
  cash_flow_item_id: number | null
}

export type CashFlowItemRow = {
  id: number
  code: string
  name: string
  category: 'operating' | 'investing' | 'financing'
  direction: 'inflow' | 'outflow'
}

export type EntryWithVoucher = VoucherEntryRow & {
  voucher_date: string
  period: string
}

export type PrefixSpec = { code: string; sign?: 1 | -1 }

export type EnterpriseBalancePoint = {
  balanceMap: Map<string, number>
  unsettledProfitLossNet: number
}

export type EnterpriseProfitStatementAmounts = {
  operatingRevenue: number
  operatingCost: number
  taxesAndSurcharges: number
  sellingExpenses: number
  administrativeExpenses: number
  researchExpenses: number
  financeExpenses: number
  interestExpenses: number
  interestIncome: number
  otherIncome: number
  investmentIncome: number
  associateInvestmentIncome: number
  derecognitionGain: number
  hedgeGain: number
  fairValueChangeGain: number
  creditImpairmentLoss: number
  assetImpairmentLoss: number
  assetDisposalGain: number
  nonOperatingIncome: number
  nonOperatingExpense: number
  incomeTaxExpense: number
  otherComprehensiveIncome: number
  operatingProfit: number
  totalProfit: number
  netProfit: number
  comprehensiveIncomeTotal: number
}

export type EquityColumnState = {
  paidInCapital: number
  otherEquityInstruments: number
  preferredShares: number
  perpetualBonds: number
  otherEquityInstrumentsOther: number
  capitalReserve: number
  treasuryStock: number
  otherComprehensiveIncome: number
  specialReserve: number
  surplusReserve: number
  generalRiskReserve: number
  undistributedProfit: number
  totalEquity: number
}

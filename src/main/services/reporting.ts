import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { buildTimestampToken, ensureDirectory } from './fileIntegrity'

export type AccountingStandardType = 'enterprise' | 'npo'
export type ReportType =
  | 'balance_sheet'
  | 'income_statement'
  | 'activity_statement'
  | 'cashflow_statement'

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

export interface DuplicateReportSnapshotRow {
  id: number
}

export type ReportExportFormat = 'xlsx' | 'pdf'

type LedgerRow = {
  id: number
  name: string
  standard_type: AccountingStandardType
  start_period: string
}

type SubjectRow = {
  code: string
  name: string
  category: string
  balance_direction: number
}

type InitialBalanceRow = {
  subject_code: string
  period: string
  debit_amount: number
  credit_amount: number
}

type VoucherRow = {
  id: number
  period: string
  voucher_date: string
  status: 0 | 1 | 2
  is_carry_forward: number
}

type VoucherEntryRow = {
  id: number
  voucher_id: number
  row_order: number
  subject_code: string
  debit_amount: number
  credit_amount: number
  cash_flow_item_id: number | null
}

type CashFlowItemRow = {
  id: number
  code: string
  name: string
  category: 'operating' | 'investing' | 'financing'
  direction: 'inflow' | 'outflow'
}

type EntryWithVoucher = VoucherEntryRow & {
  voucher_date: string
  period: string
}

const BALANCE_SHEET_TITLE = '资产负债表'
const INCOME_STATEMENT_TITLE = '利润表'
const ACTIVITY_STATEMENT_TITLE = '业务活动表'
const CASHFLOW_STATEMENT_TITLE = '现金流量表'

function normalizeTimestamp(input?: string | Date): string {
  if (typeof input === 'string' && input.trim()) {
    return input
  }
  if (input instanceof Date) {
    return input.toISOString()
  }
  return new Date().toISOString()
}

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

function getReportTitle(reportType: ReportType, standardType: AccountingStandardType): string {
  if (reportType === 'balance_sheet') return BALANCE_SHEET_TITLE
  if (reportType === 'cashflow_statement') return CASHFLOW_STATEMENT_TITLE
  if (reportType === 'income_statement') {
    if (standardType !== 'enterprise') {
      throw new Error('当前账套不支持生成利润表')
    }
    return INCOME_STATEMENT_TITLE
  }

  if (standardType !== 'npo') {
    throw new Error('当前账套不支持生成业务活动表')
  }
  return ACTIVITY_STATEMENT_TITLE
}

function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-')
  return `${year}.${month}`
}

function getPeriodStartDate(period: string): string {
  assertPeriod(period)
  return `${period}-01`
}

function getPeriodEndDate(period: string): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const date = new Date(Date.UTC(year, month, 0))
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${period}-${day}`
}

function comparePeriods(left: string, right: string): number {
  return left.localeCompare(right)
}

function getLedger(db: Database.Database, ledgerId: number): LedgerRow {
  const ledger = db
    .prepare(
      `SELECT id, name, standard_type, start_period
       FROM ledgers
       WHERE id = ?`
    )
    .get(ledgerId) as LedgerRow | undefined

  if (!ledger) {
    throw new Error('账套不存在')
  }

  return ledger
}

function listSubjects(db: Database.Database, ledgerId: number): SubjectRow[] {
  return db
    .prepare(
      `SELECT code, name, category, balance_direction
       FROM subjects
       WHERE ledger_id = ?
       ORDER BY code ASC`
    )
    .all(ledgerId) as SubjectRow[]
}

function listInitialBalances(
  db: Database.Database,
  ledgerId: number,
  period: string
): Map<string, InitialBalanceRow> {
  const rows = db
    .prepare(
      `SELECT subject_code, period, debit_amount, credit_amount
       FROM initial_balances
       WHERE ledger_id = ? AND period <= ?
       ORDER BY period ASC`
    )
    .all(ledgerId, period) as InitialBalanceRow[]

  const latestBySubject = new Map<string, InitialBalanceRow>()
  for (const row of rows) {
    latestBySubject.set(row.subject_code, row)
  }
  return latestBySubject
}

function listVouchersInDateRange(
  db: Database.Database,
  ledgerId: number,
  startDate: string,
  endDate: string
): VoucherRow[] {
  return db
    .prepare(
      `SELECT id, period, voucher_date, status, is_carry_forward
       FROM vouchers
       WHERE ledger_id = ?
         AND voucher_date >= ?
         AND voucher_date <= ?
         AND status IN (0, 1, 2)
       ORDER BY voucher_date ASC, id ASC`
    )
    .all(ledgerId, startDate, endDate) as VoucherRow[]
}

function listVoucherEntriesByVoucherIds(
  db: Database.Database,
  voucherIds: number[]
): VoucherEntryRow[] {
  if (voucherIds.length === 0) {
    return []
  }

  const placeholders = voucherIds.map(() => '?').join(', ')
  return db
    .prepare(
      `SELECT id, voucher_id, row_order, subject_code, debit_amount, credit_amount, cash_flow_item_id
       FROM voucher_entries
       WHERE voucher_id IN (${placeholders})
       ORDER BY voucher_id ASC, row_order ASC, id ASC`
    )
    .all(...voucherIds) as VoucherEntryRow[]
}

function listCashFlowItems(db: Database.Database, ledgerId: number): CashFlowItemRow[] {
  return db
    .prepare(
      `SELECT id, code, name, category, direction
       FROM cash_flow_items
       WHERE ledger_id = ?
       ORDER BY category ASC, code ASC`
    )
    .all(ledgerId) as CashFlowItemRow[]
}

function selectEffectiveVouchers(
  vouchers: VoucherRow[],
  includeUnpostedVouchers: boolean
): VoucherRow[] {
  return vouchers.filter((voucher) => {
    if (voucher.is_carry_forward === 1) {
      return false
    }
    if (includeUnpostedVouchers) {
      return voucher.status === 0 || voucher.status === 1 || voucher.status === 2
    }
    return voucher.status === 2
  })
}

function mergeEntriesWithVouchers(
  vouchers: VoucherRow[],
  entries: VoucherEntryRow[]
): EntryWithVoucher[] {
  const voucherById = new Map(vouchers.map((voucher) => [voucher.id, voucher]))
  return entries
    .filter((entry) => voucherById.has(entry.voucher_id))
    .map((entry) => ({
      ...entry,
      voucher_date: voucherById.get(entry.voucher_id)?.voucher_date ?? '',
      period: voucherById.get(entry.voucher_id)?.period ?? ''
    }))
}

function buildScope(
  reportType: ReportType,
  month: string | undefined,
  startPeriod: string | undefined,
  endPeriod: string | undefined,
  includeUnpostedVouchers: boolean
): ReportSnapshotScope {
  if (reportType === 'balance_sheet') {
    const targetMonth = month?.trim() ?? ''
    assertPeriod(targetMonth)
    return {
      mode: 'month',
      startPeriod: targetMonth,
      endPeriod: targetMonth,
      periodLabel: formatPeriodLabel(targetMonth),
      startDate: getPeriodStartDate(targetMonth),
      endDate: getPeriodEndDate(targetMonth),
      asOfDate: getPeriodEndDate(targetMonth),
      includeUnpostedVouchers
    }
  }

  const normalizedStart = startPeriod?.trim() ?? ''
  const normalizedEnd = endPeriod?.trim() ?? ''
  assertPeriod(normalizedStart)
  assertPeriod(normalizedEnd)
  if (comparePeriods(normalizedStart, normalizedEnd) > 0) {
    throw new Error('起始月份不能晚于结束月份')
  }

  return {
    mode: 'range',
    startPeriod: normalizedStart,
    endPeriod: normalizedEnd,
    periodLabel: `${formatPeriodLabel(normalizedStart)}-${formatPeriodLabel(normalizedEnd)}`,
    startDate: getPeriodStartDate(normalizedStart),
    endDate: getPeriodEndDate(normalizedEnd),
    asOfDate: null,
    includeUnpostedVouchers
  }
}

function addAmount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function buildRows(
  subjects: SubjectRow[],
  amountBySubject: Map<string, number>
): ReportSnapshotLine[] {
  return subjects.map((subject) => ({
    key: subject.code,
    label: subject.name,
    amountCents: amountBySubject.get(subject.code) ?? 0,
    code: subject.code
  }))
}

function getOpeningBalance(subject: SubjectRow, opening: InitialBalanceRow | undefined): number {
  return subject.balance_direction === 1
    ? (opening?.debit_amount ?? 0) - (opening?.credit_amount ?? 0)
    : (opening?.credit_amount ?? 0) - (opening?.debit_amount ?? 0)
}

function buildSubjectBalanceMap(
  subjects: SubjectRow[],
  openingBySubject: Map<string, InitialBalanceRow>,
  entriesBySubject: Map<string, EntryWithVoucher[]>,
  defaultStartPeriod: string,
  targetDate: string
): Map<string, number> {
  const map = new Map<string, number>()
  for (const subject of subjects) {
    map.set(
      subject.code,
      toSubjectBalance(
        subject,
        openingBySubject.get(subject.code),
        entriesBySubject.get(subject.code) ?? [],
        defaultStartPeriod,
        targetDate
      )
    )
  }
  return map
}

function sumTemplateAmount(
  amounts: Map<string, number>,
  specs: Array<{ code: string; sign?: 1 | -1 }>
): number {
  return specs.reduce(
    (sum, spec) => sum + (amounts.get(spec.code) ?? 0) * (spec.sign ?? 1),
    0
  )
}

function createTemplateRow(
  key: string,
  label: string,
  lineNo: string,
  opening: number,
  closing: number
): ReportSnapshotLine {
  return {
    key,
    label,
    lineNo,
    amountCents: closing,
    cells: {
      opening,
      closing
    }
  }
}

function createTextCell(value: string | null = ''): ReportSnapshotTableCell {
  return { value }
}

function createAmountCell(value: number): ReportSnapshotTableCell {
  return { value, isAmount: true }
}

function shiftPeriod(period: string, yearDelta: number): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  return `${String(Number(yearText) + yearDelta).padStart(4, '0')}-${monthText}`
}

function buildNgoBalanceSheetSnapshot(
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  openingMap: Map<string, number>,
  closingMap: Map<string, number>,
  unrestrictedNetChange: number,
  restrictedNetChange: number
): ReportSnapshotContent {
  const buildRow = (
    key: string,
    label: string,
    lineNo: string,
    specs: Array<{ code: string; sign?: 1 | -1 }>
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      sumTemplateAmount(openingMap, specs),
      sumTemplateAmount(closingMap, specs)
    )

  const buildSumRow = (
    key: string,
    label: string,
    lineNo: string,
    rows: ReportSnapshotLine[]
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      rows.reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      rows.reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )

  const buildDiffRow = (
    key: string,
    label: string,
    lineNo: string,
    minuend: ReportSnapshotLine,
    subtrahend: ReportSnapshotLine
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      (minuend.cells?.opening ?? 0) - (subtrahend.cells?.opening ?? 0),
      (minuend.cells?.closing ?? 0) - (subtrahend.cells?.closing ?? 0)
    )

  const createHeadingRow = (key: string, label: string): ReportSnapshotLine => ({
    key,
    label,
    amountCents: 0
  })

  const cashRow = buildRow('cash', '货币资金', '1', [
    { code: '1001' },
    { code: '1002' },
    { code: '1009' }
  ])
  const shortInvestmentRow = buildRow('short_investment', '短期投资', '2', [
    { code: '1101' },
    { code: '1102', sign: -1 }
  ])
  const receivablesRow = buildRow('receivables', '应收款项', '3', [
    { code: '1111' },
    { code: '1121' },
    { code: '1122' },
    { code: '1131', sign: -1 }
  ])
  const prepaymentRow = buildRow('prepayments', '预付账款', '4', [{ code: '1141' }])
  const inventoryRow = buildRow('inventory', '存货', '5', [
    { code: '1201' },
    { code: '1202', sign: -1 }
  ])
  const prepaidExpenseRow = buildRow('prepaid_expense', '待摊费用', '6', [{ code: '1301' }])
  const currentLongInvestmentRow = buildRow(
    'current_long_investment',
    '一年内到期的长期投资',
    '7',
    []
  )
  const otherCurrentAssetRow = buildRow('other_current_assets', '其他流动资产', '8', [])
  const flowAssetsTotalRow = buildSumRow('flow_assets_total', '流动资产合计', '9', [
    cashRow,
    shortInvestmentRow,
    receivablesRow,
    prepaymentRow,
    inventoryRow,
    prepaidExpenseRow,
    currentLongInvestmentRow,
    otherCurrentAssetRow
  ])

  const longTermEquityRow = buildRow('long_term_equity', '长期股权投资', '10', [{ code: '1401' }])
  const longTermDebtRow = buildRow('long_term_debt', '长期债权投资', '11', [{ code: '1402' }])
  const otherLongInvestmentRow = buildRow('other_long_investment', '其他长期投资', '12', [
    { code: '1403' }
  ])
  const longTermInvestmentTotalRow = buildSumRow('long_term_investment_total', '长期投资合计', '13', [
    longTermEquityRow,
    longTermDebtRow,
    otherLongInvestmentRow
  ])

  const fixedAssetCostRow = buildRow('fixed_asset_cost', '固定资产原价', '14', [{ code: '1501' }])
  const accumulatedDepreciationRow = buildRow('accumulated_depreciation', '减：累计折旧', '15', [
    { code: '1502' }
  ])
  const fixedAssetNetRow = buildDiffRow(
    'fixed_asset_net',
    '固定资产净值',
    '16',
    fixedAssetCostRow,
    accumulatedDepreciationRow
  )
  const constructionInProgressRow = buildRow('construction_in_progress', '在建工程', '17', [
    { code: '1505' }
  ])
  const fixedAssetDisposalRow = buildRow('fixed_asset_disposal', '固定资产清理', '18', [
    { code: '1509' }
  ])
  const fixedAssetsTotalRow = buildSumRow('fixed_assets_total', '固定资产合计', '19', [
    fixedAssetNetRow,
    constructionInProgressRow,
    fixedAssetDisposalRow
  ])

  const culturalRelicRow = buildRow('cultural_relic', '文物资源', '20', [{ code: '1506' }])
  const intangibleOriginalRow = buildRow('intangible_original', '无形资产原价', '21', [
    { code: '1601' }
  ])
  const intangibleAccumulatedRow = buildRow('intangible_accumulated', '减：累计摊销', '22', [
    { code: '1602' }
  ])
  const intangibleNetRow = buildDiffRow(
    'intangible_net',
    '无形资产净值',
    '23',
    intangibleOriginalRow,
    intangibleAccumulatedRow
  )
  const longPrepaidRow = buildRow('long_prepaid', '长期待摊费用', '24', [{ code: '1701' }])
  const nonCurrentAssetTotalRow = buildSumRow('noncurrent_total', '非流动资产合计', '25', [
    longTermInvestmentTotalRow,
    fixedAssetsTotalRow,
    culturalRelicRow,
    intangibleNetRow,
    longPrepaidRow
  ])
  const entrustedAssetRow = buildRow('entrusted_asset', '受托代理资产', '26', [{ code: '1801' }])
  const assetTotalRow = buildSumRow('asset_total', '资产总计', '27', [
    flowAssetsTotalRow,
    nonCurrentAssetTotalRow,
    entrustedAssetRow
  ])

  const shortTermLoanRow = buildRow('short_term_loan', '短期借款', '61', [{ code: '2101' }])
  const payablesRow = buildRow('payables', '应付款项', '62', [
    { code: '2201' },
    { code: '2202' },
    { code: '2209' }
  ])
  const payrollRow = buildRow('payroll', '应付职工薪酬', '63', [{ code: '2204' }])
  const taxesRow = buildRow('taxes', '应交税费', '64', [{ code: '2206' }])
  const advanceReceiptsRow = buildRow('advance_receipts', '预收账款', '65', [{ code: '2203' }])
  const accruedExpenseRow = buildRow('accrued_expense', '预提费用', '66', [{ code: '2301' }])
  const currentLongLiabilityRow = buildRow(
    'current_long_liability',
    '一年内到期的长期负债',
    '67',
    []
  )
  const otherCurrentLiabilityRow = buildRow(
    'other_current_liability',
    '其他流动负债',
    '68',
    []
  )
  const flowLiabilityTotalRow = buildSumRow('flow_liability_total', '流动负债合计', '69', [
    shortTermLoanRow,
    payablesRow,
    payrollRow,
    taxesRow,
    advanceReceiptsRow,
    accruedExpenseRow,
    currentLongLiabilityRow,
    otherCurrentLiabilityRow
  ])

  const longTermLoanRow = buildRow('long_term_loan', '长期借款', '70', [{ code: '2501' }])
  const longTermPayableRow = buildRow('long_term_payable', '长期应付款', '71', [{ code: '2502' }])
  const estimatedLiabilityRow = buildRow('estimated_liability', '预计负债', '72', [
    { code: '2503' }
  ])
  const otherLongTermLiabilityRow = buildRow(
    'other_long_term_liability',
    '其他长期负债',
    '73',
    []
  )
  const longTermLiabilityTotalRow = buildSumRow('long_term_liability_total', '长期负债合计', '74', [
    longTermLoanRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    otherLongTermLiabilityRow
  ])
  const entrustedLiabilityRow = buildRow('entrusted_liability', '受托代理负债', '75', [
    { code: '2601' }
  ])
  const liabilityTotalRow = buildSumRow('liability_total', '负债合计', '76', [
    flowLiabilityTotalRow,
    longTermLiabilityTotalRow,
    entrustedLiabilityRow
  ])
  const unrestrictedNetAssetsRow = createTemplateRow(
    'unrestricted_net_assets',
    '非限定性净资产',
    '77',
    sumTemplateAmount(openingMap, [{ code: '3101' }]),
    sumTemplateAmount(closingMap, [{ code: '3101' }]) + unrestrictedNetChange
  )
  const restrictedNetAssetsRow = createTemplateRow(
    'restricted_net_assets',
    '限定性净资产',
    '78',
    sumTemplateAmount(openingMap, [{ code: '3102' }]),
    sumTemplateAmount(closingMap, [{ code: '3102' }]) + restrictedNetChange
  )
  const netAssetsTotalRow = buildSumRow('net_assets_total', '净资产合计', '79', [
    unrestrictedNetAssetsRow,
    restrictedNetAssetsRow
  ])
  const liabilityAndNetAssetsTotalRow = buildSumRow(
    'liability_and_net_assets_total',
    '负债和净资产总计',
    '80',
    [liabilityTotalRow, netAssetsTotalRow]
  )

  const assetRows: ReportSnapshotLine[] = [
    cashRow,
    shortInvestmentRow,
    receivablesRow,
    prepaymentRow,
    inventoryRow,
    prepaidExpenseRow,
    currentLongInvestmentRow,
    otherCurrentAssetRow,
    flowAssetsTotalRow,
    longTermEquityRow,
    longTermDebtRow,
    otherLongInvestmentRow,
    longTermInvestmentTotalRow,
    fixedAssetCostRow,
    accumulatedDepreciationRow,
    fixedAssetNetRow,
    constructionInProgressRow,
    fixedAssetDisposalRow,
    fixedAssetsTotalRow,
    culturalRelicRow,
    intangibleOriginalRow,
    intangibleAccumulatedRow,
    intangibleNetRow,
    longPrepaidRow,
    nonCurrentAssetTotalRow,
    entrustedAssetRow,
    assetTotalRow
  ]

  const liabilityRows: ReportSnapshotLine[] = [
    shortTermLoanRow,
    payablesRow,
    payrollRow,
    taxesRow,
    advanceReceiptsRow,
    accruedExpenseRow,
    currentLongLiabilityRow,
    otherCurrentLiabilityRow,
    flowLiabilityTotalRow,
    longTermLoanRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    otherLongTermLiabilityRow,
    longTermLiabilityTotalRow,
    entrustedLiabilityRow,
    liabilityTotalRow,
    unrestrictedNetAssetsRow,
    restrictedNetAssetsRow,
    netAssetsTotalRow,
    liabilityAndNetAssetsTotalRow
  ]

  const amountCellsForRow = (row?: ReportSnapshotLine): ReportSnapshotTableCell[] =>
    row?.cells
      ? [createAmountCell(row.cells.opening ?? 0), createAmountCell(row.cells.closing ?? 0)]
      : [createTextCell(''), createTextCell('')]

  const pairRow = (
    key: string,
    left: ReportSnapshotLine | undefined,
    right: ReportSnapshotLine | undefined
  ): ReportSnapshotTableRow => ({
    key,
    cells: [
      createTextCell(left?.label ?? ''),
      ...amountCellsForRow(left),
      createTextCell(right?.label ?? ''),
      ...amountCellsForRow(right)
    ]
  })

  const officialRows: ReportSnapshotTableRow[] = [
    pairRow('row-1', createHeadingRow('asset-current-heading', '一、流动资产：'), createHeadingRow('liability-current-heading', '一、流动负债：')),
    pairRow('row-2', cashRow, shortTermLoanRow),
    pairRow('row-3', shortInvestmentRow, payablesRow),
    pairRow('row-4', receivablesRow, payrollRow),
    pairRow('row-5', prepaymentRow, taxesRow),
    pairRow('row-6', inventoryRow, advanceReceiptsRow),
    pairRow('row-7', prepaidExpenseRow, accruedExpenseRow),
    pairRow('row-8', currentLongInvestmentRow, currentLongLiabilityRow),
    pairRow('row-9', otherCurrentAssetRow, otherCurrentLiabilityRow),
    pairRow('row-10', flowAssetsTotalRow, flowLiabilityTotalRow),
    pairRow('row-11', createHeadingRow('asset-noncurrent-heading', '二、非流动资产：'), createHeadingRow('liability-long-heading', '二、长期负债：')),
    pairRow('row-12', createHeadingRow('asset-long-investment-heading', '长期投资：'), longTermLoanRow),
    pairRow('row-13', longTermEquityRow, longTermPayableRow),
    pairRow('row-14', longTermDebtRow, estimatedLiabilityRow),
    pairRow('row-15', otherLongInvestmentRow, otherLongTermLiabilityRow),
    pairRow('row-16', longTermInvestmentTotalRow, longTermLiabilityTotalRow),
    pairRow('row-17', createHeadingRow('asset-fixed-heading', '固定资产：'), createHeadingRow('entrusted-liability-heading', '三、受托代理负债')),
    pairRow('row-18', fixedAssetCostRow, entrustedLiabilityRow),
    pairRow('row-19', accumulatedDepreciationRow, liabilityTotalRow),
    pairRow('row-20', fixedAssetNetRow, createHeadingRow('net-assets-heading', '四、净资产：')),
    pairRow('row-21', constructionInProgressRow, unrestrictedNetAssetsRow),
    pairRow('row-22', fixedAssetDisposalRow, restrictedNetAssetsRow),
    pairRow('row-23', fixedAssetsTotalRow, netAssetsTotalRow),
    pairRow('row-24', culturalRelicRow, liabilityAndNetAssetsTotalRow),
    pairRow('row-25', createHeadingRow('asset-intangible-heading', '无形资产：'), undefined),
    pairRow('row-26', intangibleOriginalRow, undefined),
    pairRow('row-27', intangibleAccumulatedRow, undefined),
    pairRow('row-28', intangibleNetRow, undefined),
    pairRow('row-29', longPrepaidRow, undefined),
    pairRow('row-30', nonCurrentAssetTotalRow, undefined),
    pairRow('row-31', createHeadingRow('asset-entrusted-heading', '五、受托代理资产：'), undefined),
    pairRow('row-32', entrustedAssetRow, undefined),
    pairRow('row-33', assetTotalRow, undefined)
  ]

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非01表',
    tableColumns: [
      { key: 'opening', label: '年初数' },
      { key: 'closing', label: '期末数' }
    ],
    tables: [
      {
        key: 'ngo-balance-sheet',
        columns: [
          { key: 'left_label', label: '项目' },
          { key: 'left_opening', label: '年初余额' },
          { key: 'left_closing', label: '期末余额' },
          { key: 'right_label', label: '项目' },
          { key: 'right_opening', label: '年初余额' },
          { key: 'right_closing', label: '期末余额' }
        ],
        rows: officialRows
      }
    ],
    sections: [
      { key: 'assets', title: '资产', rows: assetRows },
      { key: 'liabilities_and_net_assets', title: '负债和净资产', rows: liabilityRows }
    ],
    totals: [
      { key: 'assets', label: '资产总计', amountCents: assetTotalRow.amountCents },
      { key: 'liabilities', label: '负债合计', amountCents: liabilityTotalRow.amountCents },
      { key: 'net_assets', label: '净资产合计', amountCents: netAssetsTotalRow.amountCents }
    ]
  }
}

function toSubjectBalance(
  subject: SubjectRow,
  opening: InitialBalanceRow | undefined,
  entries: EntryWithVoucher[],
  defaultStartPeriod: string,
  targetDate: string
): number {
  let balance =
    subject.balance_direction === 1
      ? (opening?.debit_amount ?? 0) - (opening?.credit_amount ?? 0)
      : (opening?.credit_amount ?? 0) - (opening?.debit_amount ?? 0)

  const movementStartDate = getPeriodStartDate(opening?.period ?? defaultStartPeriod)
  for (const entry of entries) {
    if (entry.voucher_date < movementStartDate || entry.voucher_date > targetDate) {
      continue
    }
    balance +=
      subject.balance_direction === 1
        ? entry.debit_amount - entry.credit_amount
        : entry.credit_amount - entry.debit_amount
  }

  return balance
}

function groupEntriesBySubject(entries: EntryWithVoucher[]): Map<string, EntryWithVoucher[]> {
  const map = new Map<string, EntryWithVoucher[]>()
  for (const entry of entries) {
    const items = map.get(entry.subject_code) ?? []
    items.push(entry)
    map.set(entry.subject_code, items)
  }
  return map
}

function buildBalanceSheetSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const openingBySubject = listInitialBalances(db, ledger.id, scope.endPeriod)
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, getPeriodStartDate(ledger.start_period), scope.endDate),
    scope.includeUnpostedVouchers
  )
  const entries = mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )
  const entriesBySubject = groupEntriesBySubject(entries)

  const assetSubjects = subjects.filter((subject) => subject.category === 'asset')
  const liabilitySubjects = subjects.filter((subject) => subject.category === 'liability')
  const equitySubjects = subjects.filter((subject) => subject.category === 'equity')
  const commonSubjects = subjects.filter((subject) => subject.category === 'common')
  const profitLossSubjects = subjects.filter((subject) => subject.category === 'profit_loss')

  const closingBalanceMap = buildSubjectBalanceMap(
    subjects,
    openingBySubject,
    entriesBySubject,
    ledger.start_period,
    scope.endDate
  )
  const openingBalanceMap = new Map<string, number>()
  for (const subject of subjects) {
    openingBalanceMap.set(subject.code, getOpeningBalance(subject, openingBySubject.get(subject.code)))
  }

  const ngoUnrestrictedNetChange =
    ledger.standard_type === 'npo'
      ? profitLossSubjects.reduce((sum, subject) => {
          const amount = closingBalanceMap.get(subject.code) ?? 0
          const signedAmount = subject.balance_direction === -1 ? amount : -amount
          return sum + (subject.code.endsWith('02') ? 0 : signedAmount)
        }, 0)
      : 0

  const ngoRestrictedNetChange =
    ledger.standard_type === 'npo'
      ? profitLossSubjects.reduce((sum, subject) => {
          const amount = closingBalanceMap.get(subject.code) ?? 0
          const signedAmount = subject.balance_direction === -1 ? amount : -amount
          return sum + (subject.code.endsWith('02') ? signedAmount : 0)
        }, 0)
      : 0

  if (ledger.standard_type === 'npo') {
    return buildNgoBalanceSheetSnapshot(
      ledger,
      scope,
      generatedAt,
      openingBalanceMap,
      closingBalanceMap,
      ngoUnrestrictedNetChange,
      ngoRestrictedNetChange
    )
  }

  const assetAmounts = new Map<string, number>()
  const liabilityAmounts = new Map<string, number>()
  const equityAmounts = new Map<string, number>()
  const commonAmounts = new Map<string, number>()

  for (const subject of assetSubjects) {
    addAmount(assetAmounts, subject.code, closingBalanceMap.get(subject.code) ?? 0)
  }

  for (const subject of liabilitySubjects) {
    addAmount(liabilityAmounts, subject.code, closingBalanceMap.get(subject.code) ?? 0)
  }

  for (const subject of equitySubjects) {
    addAmount(equityAmounts, subject.code, closingBalanceMap.get(subject.code) ?? 0)
  }

  for (const subject of commonSubjects) {
    addAmount(commonAmounts, subject.code, closingBalanceMap.get(subject.code) ?? 0)
  }

  const profitLossNet = profitLossSubjects.reduce((sum, subject) => {
    const amount = toSubjectBalance(
      subject,
      openingBySubject.get(subject.code),
      entriesBySubject.get(subject.code) ?? [],
      ledger.start_period,
      scope.endDate
    )
    return sum + (subject.balance_direction === -1 ? amount : -amount)
  }, 0)

  const assetRows = buildRows(assetSubjects, assetAmounts)
  const liabilityRows = buildRows(liabilitySubjects, liabilityAmounts)
  const equityRows = buildRows(equitySubjects, equityAmounts)
  const commonRows = buildRows(commonSubjects, commonAmounts)

  equityRows.push({
    key: 'period_net_result',
    label: '本期净利润',
    amountCents: profitLossNet
  })

  const assetsTotal = assetRows.reduce((sum, row) => sum + row.amountCents, 0)
  const liabilitiesTotal = liabilityRows.reduce((sum, row) => sum + row.amountCents, 0)
  const equityTotal = equityRows.reduce((sum, row) => sum + row.amountCents, 0)
  const commonTotal = commonRows.reduce((sum, row) => sum + row.amountCents, 0)

  const sections: ReportSnapshotSection[] = [
    { key: 'assets', title: '资产项目', rows: assetRows },
    { key: 'liabilities', title: '负债项目', rows: liabilityRows },
    {
      key: 'equity',
      title: '所有者权益项目',
      rows: equityRows
    }
  ]

  if (commonRows.length > 0) {
    sections.push({ key: 'common', title: '共同类项目', rows: commonRows })
  }

  const totals: ReportSnapshotTotal[] = [
    { key: 'assets', label: '资产合计', amountCents: assetsTotal },
    { key: 'liabilities', label: '负债合计', amountCents: liabilitiesTotal },
    {
      key: 'equity',
      label: '所有者权益合计',
      amountCents: equityTotal
    }
  ]

  if (commonRows.length > 0) {
    totals.push({ key: 'common', label: '共同类合计', amountCents: commonTotal })
  }

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    sections,
    totals
  }
}

function sumEntriesByPrefixes(
  entries: EntryWithVoucher[],
  prefixes: string[],
  direction: 'income' | 'expense',
  period?: string
): { unrestricted: number; restricted: number } {
  let unrestricted = 0
  let restricted = 0

  for (const entry of entries) {
    if (period && entry.period !== period) {
      continue
    }
    if (!prefixes.some((prefix) => entry.subject_code === prefix || entry.subject_code.startsWith(prefix))) {
      continue
    }

    const amount =
      direction === 'income'
        ? entry.credit_amount - entry.debit_amount
        : entry.debit_amount - entry.credit_amount
    if (entry.subject_code.endsWith('02')) {
      restricted += amount
    } else {
      unrestricted += amount
    }
  }

  return { unrestricted, restricted }
}

function buildNgoActivityStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, scope.startDate, scope.endDate),
    scope.includeUnpostedVouchers
  )
  const entries = mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )

  const incomeGroups = [
    { label: '捐赠收入', prefixes: ['4101'] },
    { label: '会费收入', prefixes: ['4201'] },
    { label: '提供服务收入', prefixes: ['4301'] },
    { label: '政府补助收入', prefixes: ['4401'] },
    { label: '商品销售收入', prefixes: ['4501'] },
    { label: '总部拨款收入', prefixes: ['4701'] },
    { label: '投资收益', prefixes: ['4601'] },
    { label: '其他收入', prefixes: ['4901'] }
  ]
  const expenseGroups = [
    { label: '业务活动成本', prefixes: ['5101'] },
    { label: '  其中：税金及附加', prefixes: ['5201'] },
    { label: '管理费用', prefixes: ['5301'] },
    { label: '筹资费用', prefixes: ['5401'] },
    { label: '资产减值损失', prefixes: ['5501'] },
    { label: '所得税费用', prefixes: ['5601'] },
    { label: '其他费用', prefixes: ['5901'] }
  ]

  const rowOf = (
    label: string,
    current: { unrestricted: number; restricted: number },
    cumulative: { unrestricted: number; restricted: number }
  ): ReportSnapshotTableRow => ({
    key: label,
    cells: [
      createTextCell(label),
      createAmountCell(current.unrestricted),
      createAmountCell(current.restricted),
      createAmountCell(current.unrestricted + current.restricted),
      createAmountCell(cumulative.unrestricted),
      createAmountCell(cumulative.restricted),
      createAmountCell(cumulative.unrestricted + cumulative.restricted)
    ]
  })

  const incomeRows = incomeGroups.map((group) =>
    rowOf(
      group.label,
      sumEntriesByPrefixes(entries, group.prefixes, 'income', scope.endPeriod),
      sumEntriesByPrefixes(entries, group.prefixes, 'income')
    )
  )
  const expenseRows = expenseGroups.map((group) =>
    rowOf(
      group.label,
      sumEntriesByPrefixes(entries, group.prefixes, 'expense', scope.endPeriod),
      sumEntriesByPrefixes(entries, group.prefixes, 'expense')
    )
  )

  const sumColumns = (rows: ReportSnapshotTableRow[]): number[] =>
    [1, 2, 3, 4, 5, 6].map((index) =>
      rows.reduce((sum, row) => sum + (typeof row.cells[index]?.value === 'number' ? Number(row.cells[index].value) : 0), 0)
    )

  const incomeTotals = sumColumns(incomeRows)
  const expenseTotals = sumColumns(expenseRows)
  const zeroSix = [0, 0, 0, 0, 0, 0]
  const netValues = incomeTotals.map((value, index) => value - expenseTotals[index])

  const tableRows: ReportSnapshotTableRow[] = [
    { key: 'income-header', cells: [createTextCell('一、收入'), ...zeroSix.map(() => createTextCell(''))] },
    ...incomeRows,
    {
      key: 'income-total',
      cells: [createTextCell('收入合计'), ...incomeTotals.map((value) => createAmountCell(value))]
    },
    { key: 'expense-header', cells: [createTextCell('二、费用'), ...zeroSix.map(() => createTextCell(''))] },
    ...expenseRows,
    {
      key: 'expense-total',
      cells: [createTextCell('费用合计'), ...expenseTotals.map((value) => createAmountCell(value))]
    },
    {
      key: 'restricted-to-unrestricted',
      cells: [createTextCell('三、限定性净资产转为非限定性净资产'), ...zeroSix.map(() => createAmountCell(0))]
    },
    {
      key: 'unrestricted-to-restricted',
      cells: [createTextCell('四、非限定性净资产转为限定性净资产'), ...zeroSix.map(() => createAmountCell(0))]
    },
    {
      key: 'prior-adjustment',
      cells: [createTextCell('五、以前年度净资产调整'), ...zeroSix.map(() => createAmountCell(0))]
    },
    {
      key: 'net-assets-change',
      cells: [createTextCell('六、净资产变动额（减少以“-”号填列）'), ...netValues.map((value) => createAmountCell(value))]
    }
  ]

  return {
    title: ACTIVITY_STATEMENT_TITLE,
    reportType: 'activity_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非02表',
    tables: [
      {
        key: 'ngo-activity-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current_unrestricted', label: '本月数（非限定性）' },
          { key: 'current_restricted', label: '本月数（限定性）' },
          { key: 'current_total', label: '本月数（合计）' },
          { key: 'cumulative_unrestricted', label: '本年累计数（非限定性）' },
          { key: 'cumulative_restricted', label: '本年累计数（限定性）' },
          { key: 'cumulative_total', label: '本年累计数（合计）' }
        ],
        rows: tableRows
      }
    ],
    sections: [],
    totals: [
      { key: 'income_total', label: '收入合计', amountCents: incomeTotals[5] },
      { key: 'expense_total', label: '费用合计', amountCents: expenseTotals[5] },
      { key: 'net_assets_change', label: '净资产变动额', amountCents: netValues[5] }
    ]
  }
}

function buildNgoCashFlowStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const currentItems = listCashFlowItems(db, ledger.id)
  const currentVouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, scope.startDate, scope.endDate),
    scope.includeUnpostedVouchers
  )
  const currentEntries = mergeEntriesWithVouchers(
    currentVouchers,
    listVoucherEntriesByVoucherIds(
      db,
      currentVouchers.map((voucher) => voucher.id)
    )
  )

  const previousScope = {
    startDate: getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
    endDate: getPeriodEndDate(shiftPeriod(scope.endPeriod, -1))
  }
  const previousVouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, previousScope.startDate, previousScope.endDate),
    scope.includeUnpostedVouchers
  )
  const previousEntries = mergeEntriesWithVouchers(
    previousVouchers,
    listVoucherEntriesByVoucherIds(
      db,
      previousVouchers.map((voucher) => voucher.id)
    )
  )

  const sumCashflowByName = (entries: EntryWithVoucher[], itemName: string): number => {
    const itemIds = currentItems.filter((item) => item.name === itemName).map((item) => item.id)
    return entries
      .filter((entry) => entry.cash_flow_item_id !== null && itemIds.includes(entry.cash_flow_item_id))
      .reduce((sum, entry) => sum + (entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount), 0)
  }

  const line = (label: string, currentAmount: number, previousAmount: number): ReportSnapshotTableRow => ({
    key: label,
    cells: [createTextCell(label), createAmountCell(currentAmount), createAmountCell(previousAmount)]
  })

  const currentByName = (label: string): number => sumCashflowByName(currentEntries, label)
  const previousByName = (label: string): number => sumCashflowByName(previousEntries, label)

  const operatingInRows = [
    '接受捐赠收到的现金',
    '收取会费收到的现金',
    '提供服务收到的现金',
    '销售商品收到的现金',
    '政府补助收到的现金',
    '收到的其他与业务活动有关的现金'
  ]
  const operatingOutRows = [
    '提供捐赠或者资助支付的现金',
    '支付给员工以及为员工支付的现金',
    '购买商品、接受服务支付的现金',
    '各项税费支付的现金',
    '支付的其他与业务活动有关的现金'
  ]
  const investingInRows = [
    '收回投资所收到的现金',
    '取得投资收益所收到的现金',
    '处置固定资产、无形资产和其他非流动资产收回的现金',
    '收到的其他与投资活动有关的现金'
  ]
  const investingOutRows = [
    '购建固定资产、无形资产和其他非流动资产支付的现金',
    '对外投资所支付的现金',
    '支付的其他与投资活动有关的现金'
  ]
  const financingInRows = ['借款所收到的现金', '收到的其他与筹资活动有关的现金']
  const financingOutRows = ['偿还借款所支付的现金', '偿付利息所支付的现金', '支付的其他与筹资活动有关的现金']

  const sumLabels = (labels: string[], picker: (label: string) => number): number =>
    labels.reduce((sum, label) => sum + picker(label), 0)

  const currentOperatingIn = sumLabels(operatingInRows, currentByName)
  const currentOperatingOut = sumLabels(operatingOutRows, currentByName)
  const previousOperatingIn = sumLabels(operatingInRows, previousByName)
  const previousOperatingOut = sumLabels(operatingOutRows, previousByName)

  const currentInvestingIn = sumLabels(investingInRows, currentByName)
  const currentInvestingOut = sumLabels(investingOutRows, currentByName)
  const previousInvestingIn = sumLabels(investingInRows, previousByName)
  const previousInvestingOut = sumLabels(investingOutRows, previousByName)

  const currentFinancingIn = sumLabels(financingInRows, currentByName)
  const currentFinancingOut = sumLabels(financingOutRows, currentByName)
  const previousFinancingIn = sumLabels(financingInRows, previousByName)
  const previousFinancingOut = sumLabels(financingOutRows, previousByName)

  const tableRows: ReportSnapshotTableRow[] = [
    line('一、业务活动产生的现金流量：', 0, 0),
    ...operatingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentOperatingIn, previousOperatingIn),
    ...operatingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentOperatingOut, previousOperatingOut),
    line(
      '业务活动产生的现金流量净额',
      currentOperatingIn - currentOperatingOut,
      previousOperatingIn - previousOperatingOut
    ),
    line('二、投资活动产生的现金流量：', 0, 0),
    ...investingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentInvestingIn, previousInvestingIn),
    ...investingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentInvestingOut, previousInvestingOut),
    line(
      '投资活动产生的现金流量净额',
      currentInvestingIn - currentInvestingOut,
      previousInvestingIn - previousInvestingOut
    ),
    line('三、筹资活动产生的现金流量：', 0, 0),
    ...financingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentFinancingIn, previousFinancingIn),
    ...financingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentFinancingOut, previousFinancingOut),
    line(
      '筹资活动产生的现金流量净额',
      currentFinancingIn - currentFinancingOut,
      previousFinancingIn - previousFinancingOut
    ),
    line('四、汇率变动对现金的影响额', 0, 0),
    line(
      '五、现金及现金等价物净增加额',
      currentOperatingIn -
        currentOperatingOut +
        (currentInvestingIn - currentInvestingOut) +
        (currentFinancingIn - currentFinancingOut),
      previousOperatingIn -
        previousOperatingOut +
        (previousInvestingIn - previousInvestingOut) +
        (previousFinancingIn - previousFinancingOut)
    )
  ]

  return {
    title: CASHFLOW_STATEMENT_TITLE,
    reportType: 'cashflow_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非03表',
    tables: [
      {
        key: 'ngo-cashflow-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本年金额' },
          { key: 'previous', label: '上年金额' }
        ],
        rows: tableRows
      }
    ],
    sections: [],
    totals: [
      {
        key: 'net_cash_flow',
        label: '现金及现金等价物净增加额',
        amountCents: typeof tableRows[tableRows.length - 1].cells[1].value === 'number'
          ? Number(tableRows[tableRows.length - 1].cells[1].value)
          : 0
      }
    ]
  }
}

function buildProfitLossSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  title: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id).filter((subject) => subject.category === 'profit_loss')
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, scope.startDate, scope.endDate),
    scope.includeUnpostedVouchers
  )
  const entries = mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )
  const entriesBySubject = groupEntriesBySubject(entries)

  const incomeSubjects = subjects.filter((subject) => subject.balance_direction === -1)
  const expenseSubjects = subjects.filter((subject) => subject.balance_direction !== -1)

  const incomeBySubject = new Map<string, number>()
  const expenseBySubject = new Map<string, number>()

  for (const subject of incomeSubjects) {
    const amount = (entriesBySubject.get(subject.code) ?? []).reduce(
      (sum, row) => sum + (row.credit_amount - row.debit_amount),
      0
    )
    incomeBySubject.set(subject.code, amount)
  }

  for (const subject of expenseSubjects) {
    const amount = (entriesBySubject.get(subject.code) ?? []).reduce(
      (sum, row) => sum + (row.debit_amount - row.credit_amount),
      0
    )
    expenseBySubject.set(subject.code, amount)
  }

  const incomeRows = buildRows(incomeSubjects, incomeBySubject)
  const expenseRows = buildRows(expenseSubjects, expenseBySubject)
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.amountCents, 0)
  const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amountCents, 0)
  const netAmount = incomeTotal - expenseTotal

  return {
    title,
    reportType: title === ACTIVITY_STATEMENT_TITLE ? 'activity_statement' : 'income_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    sections: [
      { key: 'income', title: '收入项目', rows: incomeRows },
      { key: 'expense', title: '费用项目', rows: expenseRows }
    ],
    totals: [
      { key: 'income_total', label: '收入合计', amountCents: incomeTotal },
      { key: 'expense_total', label: '费用合计', amountCents: expenseTotal },
      {
        key: title === ACTIVITY_STATEMENT_TITLE ? 'net_assets_change' : 'net_profit',
        label: title === ACTIVITY_STATEMENT_TITLE ? '净资产变动额' : '净利润',
        amountCents: netAmount
      }
    ]
  }
}

function buildCashFlowSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, scope.startDate, scope.endDate),
    scope.includeUnpostedVouchers
  )
  const entries = mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )
  const cashFlowItems = listCashFlowItems(db, ledger.id)
  const amountByItemId = new Map<string, number>()

  for (const entry of entries) {
    if (entry.cash_flow_item_id === null) {
      continue
    }
    addAmount(
      amountByItemId,
      String(entry.cash_flow_item_id),
      entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount
    )
  }

  const categories: Array<{
    key: 'operating' | 'investing' | 'financing'
    title: string
    netKey: string
    netLabel: string
  }> = [
    {
      key: 'operating',
      title: '经营活动现金流',
      netKey: 'operating_net',
      netLabel: '经营活动现金流量净额'
    },
    {
      key: 'investing',
      title: '投资活动现金流',
      netKey: 'investing_net',
      netLabel: '投资活动现金流量净额'
    },
    {
      key: 'financing',
      title: '筹资活动现金流',
      netKey: 'financing_net',
      netLabel: '筹资活动现金流量净额'
    }
  ]

  const sections: ReportSnapshotSection[] = []
  const totals: ReportSnapshotTotal[] = []
  let netCashFlow = 0

  for (const category of categories) {
    const rows = cashFlowItems
      .filter((item) => item.category === category.key)
      .map((item) => ({
        key: `${item.direction}:${item.code}`,
        label: `${item.direction === 'inflow' ? '流入' : '流出'} | ${item.name}`,
        amountCents: amountByItemId.get(String(item.id)) ?? 0,
        code: item.code
      }))

    const inflowTotal = rows
      .filter((row) => row.key.startsWith('inflow:'))
      .reduce((sum, row) => sum + row.amountCents, 0)
    const outflowTotal = rows
      .filter((row) => row.key.startsWith('outflow:'))
      .reduce((sum, row) => sum + row.amountCents, 0)
    const netAmount = inflowTotal - outflowTotal

    netCashFlow += netAmount
    sections.push({ key: category.key, title: category.title, rows })
    totals.push({
      key: `${category.key}_inflow`,
      label: `${category.title}流入小计`,
      amountCents: inflowTotal
    })
    totals.push({
      key: `${category.key}_outflow`,
      label: `${category.title}流出小计`,
      amountCents: outflowTotal
    })
    totals.push({
      key: category.netKey,
      label: category.netLabel,
      amountCents: netAmount
    })
  }

  totals.push({
    key: 'net_cash_flow',
    label: '现金及现金等价物净增加额',
    amountCents: netCashFlow
  })

  return {
    title: CASHFLOW_STATEMENT_TITLE,
    reportType: 'cashflow_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    sections,
    totals
  }
}

function buildSnapshotContent(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  reportType: ReportType,
  generatedAt: string
): ReportSnapshotContent {
  const title = getReportTitle(reportType, ledger.standard_type)
  if (reportType === 'balance_sheet') {
    return buildBalanceSheetSnapshot(db, ledger, scope, generatedAt)
  }
  if (ledger.standard_type === 'npo' && reportType === 'activity_statement') {
    return buildNgoActivityStatementSnapshot(db, ledger, scope, generatedAt)
  }
  if (reportType === 'cashflow_statement') {
    if (ledger.standard_type === 'npo') {
      return buildNgoCashFlowStatementSnapshot(db, ledger, scope, generatedAt)
    }
    return buildCashFlowSnapshot(db, ledger, scope, generatedAt)
  }
  return buildProfitLossSnapshot(db, ledger, scope, generatedAt, title)
}

function buildReportName(title: string, scope: ReportSnapshotScope): string {
  return `${title} ${scope.periodLabel}${scope.includeUnpostedVouchers ? '（含未记账凭证）' : ''}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_')
}

function buildScopeFromRow(
  row: Pick<
    ReportSnapshotSummary,
    'period' | 'start_period' | 'end_period' | 'as_of_date' | 'include_unposted_vouchers'
  >
): ReportSnapshotScope {
  return {
    mode: row.as_of_date ? 'month' : 'range',
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    periodLabel: row.period,
    startDate: getPeriodStartDate(row.start_period),
    endDate: row.as_of_date ?? getPeriodEndDate(row.end_period),
    asOfDate: row.as_of_date,
    includeUnpostedVouchers: row.include_unposted_vouchers === 1
  }
}

function parseSnapshotRow(
  row:
    | (ReportSnapshotSummary & {
        content_json?: string
      })
    | undefined
): ReportSnapshotDetail {
  if (!row) {
    throw new Error('报表快照不存在')
  }

  const parsedContent = row.content_json
    ? (JSON.parse(row.content_json) as Partial<ReportSnapshotContent>)
    : {}
  const scope = parsedContent.scope ?? buildScopeFromRow(row)

  return {
    id: row.id,
    ledger_id: row.ledger_id,
    report_type: row.report_type,
    report_name: row.report_name,
    period: row.period,
    start_period: row.start_period,
    end_period: row.end_period,
    as_of_date: row.as_of_date,
    include_unposted_vouchers: row.include_unposted_vouchers,
    generated_by: row.generated_by,
    generated_at: row.generated_at,
    ledger_name: row.ledger_name,
    standard_type: row.standard_type,
    content: {
      title: parsedContent.title ?? row.report_name,
      reportType: parsedContent.reportType ?? row.report_type,
      period: parsedContent.period ?? row.period,
      ledgerName: parsedContent.ledgerName ?? row.ledger_name,
      standardType: parsedContent.standardType ?? row.standard_type,
      generatedAt: parsedContent.generatedAt ?? row.generated_at,
      scope,
      formCode: parsedContent.formCode,
      tableColumns: parsedContent.tableColumns,
      tables: parsedContent.tables,
      sections: parsedContent.sections ?? [],
      totals: parsedContent.totals ?? []
    }
  }
}

export function generateReportSnapshot(
  db: Database.Database,
  params: GenerateReportSnapshotParams
): ReportSnapshotDetail {
  const ledger = getLedger(db, params.ledgerId)
  const generatedAt = normalizeTimestamp(params.now)
  const includeUnpostedVouchers = params.includeUnpostedVouchers === true
  const scope = buildScope(
    params.reportType,
    params.month,
    params.startPeriod,
    params.endPeriod,
    includeUnpostedVouchers
  )
  const title = getReportTitle(params.reportType, ledger.standard_type)
  const content = buildSnapshotContent(db, ledger, scope, params.reportType, generatedAt)
  const reportName = buildReportName(title, scope)
  const duplicate = db
    .prepare(
      `SELECT id
       FROM report_snapshots
       WHERE ledger_id = ?
         AND report_type = ?
         AND period = ?
       LIMIT 1`
    )
    .get(params.ledgerId, params.reportType, scope.periodLabel) as DuplicateReportSnapshotRow | undefined

  if (duplicate) {
    throw new Error('已存在同会计期间同类型的报表，请先删除原报表后再生成')
  }

  const result = db
    .prepare(
      `INSERT INTO report_snapshots (
         ledger_id,
         report_type,
         report_name,
         period,
         start_period,
         end_period,
         as_of_date,
         include_unposted_vouchers,
         generated_by,
         generated_at,
         content_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.ledgerId,
      params.reportType,
      reportName,
      scope.periodLabel,
      scope.startPeriod,
      scope.endPeriod,
      scope.asOfDate,
      includeUnpostedVouchers ? 1 : 0,
      params.generatedBy ?? null,
      generatedAt,
      JSON.stringify(content)
    )

  return {
    id: Number(result.lastInsertRowid),
    ledger_id: params.ledgerId,
    report_type: params.reportType,
    report_name: reportName,
    period: scope.periodLabel,
    start_period: scope.startPeriod,
    end_period: scope.endPeriod,
    as_of_date: scope.asOfDate,
    include_unposted_vouchers: includeUnpostedVouchers ? 1 : 0,
    generated_by: params.generatedBy ?? null,
    generated_at: generatedAt,
    ledger_name: ledger.name,
    standard_type: ledger.standard_type,
    content
  }
}

export function listReportSnapshots(
  db: Database.Database,
  filters: ReportListFilters
): ReportSnapshotSummary[] {
  const whereClauses = ['rs.ledger_id = ?']
  const params: Array<number | string> = [filters.ledgerId]

  if (filters.reportTypes && filters.reportTypes.length > 0) {
    whereClauses.push(`rs.report_type IN (${filters.reportTypes.map(() => '?').join(', ')})`)
    params.push(...filters.reportTypes)
  }

  if (filters.periods && filters.periods.length > 0) {
    whereClauses.push(`rs.period IN (${filters.periods.map(() => '?').join(', ')})`)
    params.push(...filters.periods)
  }

  return db
    .prepare(
      `SELECT
         rs.id,
         rs.ledger_id,
         rs.report_type,
         rs.report_name,
         rs.period,
         rs.start_period,
         rs.end_period,
         rs.as_of_date,
         rs.include_unposted_vouchers,
         rs.generated_by,
         rs.generated_at,
         l.name AS ledger_name,
         l.standard_type
       FROM report_snapshots rs
       INNER JOIN ledgers l ON l.id = rs.ledger_id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY rs.generated_at DESC, rs.id DESC`
    )
    .all(...params) as ReportSnapshotSummary[]
}

export function getReportSnapshotDetail(
  db: Database.Database,
  snapshotId: number,
  ledgerId?: number
): ReportSnapshotDetail {
  const row = db
    .prepare(
      `SELECT
         rs.id,
         rs.ledger_id,
         rs.report_type,
         rs.report_name,
         rs.period,
         rs.start_period,
         rs.end_period,
         rs.as_of_date,
         rs.include_unposted_vouchers,
         rs.generated_by,
         rs.generated_at,
         rs.content_json,
         l.name AS ledger_name,
         l.standard_type
       FROM report_snapshots rs
       INNER JOIN ledgers l ON l.id = rs.ledger_id
       WHERE rs.id = ?`
    )
    .get(snapshotId) as
    | (ReportSnapshotSummary & {
        content_json: string
      })
    | undefined

  const detail = parseSnapshotRow(row)
  if (typeof ledgerId === 'number' && detail.ledger_id !== ledgerId) {
    throw new Error('报表快照不属于当前账套')
  }
  return detail
}

export function deleteReportSnapshot(
  db: Database.Database,
  snapshotId: number,
  ledgerId: number
): boolean {
  const result = db.prepare('DELETE FROM report_snapshots WHERE id = ? AND ledger_id = ?').run(snapshotId, ledgerId)
  return result.changes > 0
}

export function buildReportSnapshotHtml(detail: ReportSnapshotDetail): string {
  const title = escapeHtml(detail.content.title)
  const ledgerName = escapeHtml(detail.ledger_name)
  const period = escapeHtml(detail.period)
  const generatedAt = escapeHtml(detail.generated_at)
  const formCodeHtml = detail.content.formCode
    ? `<div class="form-code">${escapeHtml(detail.content.formCode)}</div>`
    : ''
  const scopeText = escapeHtml(
    `${detail.content.scope.startDate} 至 ${detail.content.scope.endDate}${
      detail.content.scope.asOfDate ? `（截至 ${detail.content.scope.asOfDate}）` : ''
    }`
  )
  const basisText = escapeHtml(
    detail.content.scope.includeUnpostedVouchers ? '含未记账凭证' : '仅已记账凭证'
  )

  const sectionHtml =
    detail.content.tables && detail.content.tables.length > 0
      ? detail.content.tables
          .map((table) => {
            const headerCells = table.columns
              .map(
                (column, index) =>
                  `<th${index === 0 ? '' : ' class="num"'}>${escapeHtml(column.label)}</th>`
              )
              .join('')
            const bodyRows = table.rows
              .map((row) => {
                const cells = row.cells
                  .map((cell, index) => {
                    const value =
                      typeof cell.value === 'number' && cell.isAmount
                        ? formatAmount(cell.value)
                        : String(cell.value ?? '')
                    return `<td${index === 0 ? '' : ' class="num"'}>${escapeHtml(value)}</td>`
                  })
                  .join('')
                return `<tr>${cells}</tr>`
              })
              .join('')

            return `
              <section class="report-section">
                <table>
                  <thead>
                    <tr>${headerCells}</tr>
                  </thead>
                  <tbody>
                    ${bodyRows}
                  </tbody>
                </table>
              </section>
            `
          })
          .join('')
      : detail.content.sections
          .map((section) => {
            const columns = detail.content.tableColumns
            const multiColumn = (columns?.length ?? 0) > 0

            const headerCells = multiColumn
              ? `<th>项目</th>${columns
                  ?.map((column) => `<th class="num">${escapeHtml(column.label)}</th>`)
                  .join('')}`
              : '<th>项目</th><th class="num">金额</th>'

            const bodyRows = section.rows
              .map((row) => {
                const label = `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
                const valueCells = multiColumn
                  ? columns
                      ?.map(
                        (column) =>
                          `<td class="num">${formatAmount(row.cells?.[column.key] ?? 0)}</td>`
                      )
                      .join('') ?? ''
                  : `<td class="num">${formatAmount(row.amountCents)}</td>`

                return `<tr><td>${escapeHtml(label)}</td>${valueCells}</tr>`
              })
              .join('')

            return `
              <section class="report-section">
                <h2>${escapeHtml(section.title)}</h2>
                <table>
                  <thead>
                    <tr>${headerCells}</tr>
                  </thead>
                  <tbody>
                    ${bodyRows}
                  </tbody>
                </table>
              </section>
            `
          })
          .join('')

  const totalsHtml = detail.content.totals
    .map(
      (total) =>
        `<tr><td>${escapeHtml(total.label)}</td><td class="num">${formatAmount(total.amountCents)}</td></tr>`
    )
    .join('')
  const totalsSectionHtml =
    detail.report_type === 'balance_sheet' || (detail.content.tables && detail.content.tables.length > 0)
      ? ''
      : `
      <section class="report-section totals">
        <h2>汇总</h2>
        <table>
          <thead>
            <tr><th>项目</th><th class="num">金额</th></tr>
          </thead>
          <tbody>${totalsHtml}</tbody>
        </table>
      </section>`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: A4 portrait; margin: 16mm 14mm; }
      body {
        margin: 0;
        color: #111827;
        background: #ffffff;
        font-family: "SimSun", "Songti SC", serif;
        font-size: 12px;
        line-height: 1.45;
      }
      .page {
        width: 100%;
      }
      h1 {
        margin: 0 0 8px;
        text-align: center;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .form-code {
        margin-bottom: 8px;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
      }
      .meta {
        margin-bottom: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        justify-content: space-between;
      }
      .meta-row {
        width: 100%;
        display: flex;
        justify-content: space-between;
      }
      .meta-label {
        color: #374151;
      }
      .report-section {
        margin-top: 12px;
      }
      .report-section h2 {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #111827;
        padding: 6px 8px;
        vertical-align: middle;
        word-break: break-word;
      }
      th {
        text-align: center;
        font-weight: 700;
      }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .totals {
        margin-top: 14px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <h1>${title}</h1>
      ${formCodeHtml}
      <div class="meta">
        <div class="meta-row">
          <span class="meta-label">编制单位：${ledgerName}</span>
          <span class="meta-label">会计期间：${period}</span>
          <span class="meta-label">单位：元</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">取数范围：${scopeText}</span>
          <span class="meta-label">统计口径：${basisText}</span>
          <span class="meta-label">导出时间：${generatedAt}</span>
        </div>
      </div>
      ${sectionHtml}
      ${totalsSectionHtml}
    </div>
  </body>
</html>`
}

function formatAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2)
}

function getExportTableHeaders(detail: ReportSnapshotDetail): string[] {
  if (detail.content.tables && detail.content.tables.length > 0) {
    return detail.content.tables[0].columns.map((column) => column.label)
  }
  if (detail.content.tableColumns && detail.content.tableColumns.length > 0) {
    return ['项目', ...detail.content.tableColumns.map((column) => column.label)]
  }
  return ['项目', '金额']
}

function getExportTableRows(detail: ReportSnapshotDetail): Array<{ section: string; values: string[] }> {
  if (detail.content.tables && detail.content.tables.length > 0) {
    return detail.content.tables.flatMap((table) =>
      table.rows.map((row) => ({
        section: table.key,
        values: row.cells.map((cell) =>
          typeof cell.value === 'number' && cell.isAmount ? formatAmount(cell.value) : String(cell.value ?? '')
        )
      }))
    )
  }

  return detail.content.sections.flatMap((section) =>
    section.rows.map((row) => {
      const label = `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
      const values = detail.content.tableColumns && detail.content.tableColumns.length > 0
        ? [label, ...detail.content.tableColumns.map((column) => formatAmount(row.cells?.[column.key] ?? 0))]
        : [label, formatAmount(row.amountCents)]

      return { section: section.title, values }
    })
  )
}

export function buildDefaultReportExportFileName(
  detail: ReportSnapshotDetail,
  format: ReportExportFormat
): string {
  return `${sanitizeFileName(detail.report_name)}.${format}`
}

export function writeReportSnapshotHtml(
  outputDir: string,
  detail: ReportSnapshotDetail,
  now: Date = new Date()
): string {
  ensureDirectory(outputDir)
  const fileName = `${sanitizeFileName(detail.report_name)}-${buildTimestampToken(now)}.html`
  const filePath = path.join(outputDir, fileName)
  fs.writeFileSync(filePath, buildReportSnapshotHtml(detail), 'utf8')
  return filePath
}

export async function writeReportSnapshotExcel(
  filePath: string,
  detail: ReportSnapshotDetail
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(detail.content.title, {
    views: [{ state: 'frozen', ySplit: 4 }]
  })

  const headers = getExportTableHeaders(detail)
  const rows = getExportTableRows(detail)
  const hasOfficialTables = (detail.content.tables?.length ?? 0) > 0

  worksheet.mergeCells(1, 1, 1, headers.length)
  worksheet.getCell(1, 1).value = detail.content.title
  worksheet.getCell(1, 1).font = { name: '宋体', size: 16, bold: true }
  worksheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  worksheet.getCell(2, 1).value = `编制单位：${detail.ledger_name}`
  worksheet.getCell(2, headers.length).value = '单位：元'
  worksheet.getCell(3, 1).value = `会计期间：${detail.period}`
  worksheet.getCell(3, headers.length).value =
    detail.content.scope.includeUnpostedVouchers ? '统计口径：含未记账凭证' : '统计口径：仅已记账凭证'
  if (detail.content.formCode) {
    worksheet.mergeCells(2, 1, 2, headers.length)
    worksheet.getCell(2, 1).value = detail.content.formCode
    worksheet.getCell(2, 1).font = { name: '宋体', size: 11, bold: true }
    worksheet.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' }
    worksheet.getCell(3, 1).value = `编制单位：${detail.ledger_name}`
    worksheet.getCell(3, headers.length).value = '单位：元'
    worksheet.getCell(4, 1).value = `会计期间：${detail.period}`
    worksheet.getCell(4, headers.length).value =
      detail.content.scope.includeUnpostedVouchers ? '统计口径：含未记账凭证' : '统计口径：仅已记账凭证'
  }

  const headerRowIndex = detail.content.formCode ? 5 : 4
  const headerRow = worksheet.getRow(headerRowIndex)
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = header
    cell.font = { name: '宋体', size: 11, bold: true }
    cell.alignment = { horizontal: index === 0 ? 'left' : 'right', vertical: 'middle' }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
  })

  let rowIndex = headerRowIndex + 1
  let currentSection = ''
  for (const row of rows) {
    if (!hasOfficialTables && row.section !== currentSection) {
      currentSection = row.section
      worksheet.mergeCells(rowIndex, 1, rowIndex, headers.length)
      const sectionCell = worksheet.getCell(rowIndex, 1)
      sectionCell.value = currentSection
      sectionCell.font = { name: '宋体', size: 11, bold: true }
      sectionCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' }
      }
      sectionCell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
      rowIndex += 1
    }

    row.values.forEach((value, index) => {
      const cell = worksheet.getCell(rowIndex, index + 1)
      cell.value = value
      cell.font = { name: '宋体', size: 10 }
      cell.alignment = { horizontal: index === 0 ? 'left' : 'right', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })
    rowIndex += 1
  }

  if (!hasOfficialTables) {
    rowIndex += 1
    worksheet.mergeCells(rowIndex, 1, rowIndex, headers.length)
    worksheet.getCell(rowIndex, 1).value = '汇总'
    worksheet.getCell(rowIndex, 1).font = { name: '宋体', size: 11, bold: true }

    rowIndex += 1
    detail.content.totals.forEach((total) => {
      worksheet.getCell(rowIndex, 1).value = total.label
      worksheet.getCell(rowIndex, headers.length).value = formatAmount(total.amountCents)
      for (let column = 1; column <= headers.length; column += 1) {
        const cell = worksheet.getCell(rowIndex, column)
        cell.font = { name: '宋体', size: 10 }
        cell.alignment = { horizontal: column === 1 ? 'left' : 'right', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
      rowIndex += 1
    })
  }

  worksheet.columns = headers.map((header, index) => ({
    header,
    width: index === 0 ? 42 : 18
  }))

  ensureDirectory(path.dirname(filePath))
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

export async function writeReportSnapshotPdf(
  filePath: string,
  detail: ReportSnapshotDetail
): Promise<string> {
  ensureDirectory(path.dirname(filePath))

  await new Promise<void>((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true
    })
    const stream = fs.createWriteStream(filePath)

    document.pipe(stream)

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right
    const headers = getExportTableHeaders(detail)
    const rows = getExportTableRows(detail)
    const hasOfficialTables = (detail.content.tables?.length ?? 0) > 0
    const columnWidth = headers.length > 0 ? pageWidth / headers.length : pageWidth

    const drawRow = (
      values: string[],
      top: number,
      options?: { bold?: boolean; fillColor?: string }
    ): number => {
      const rowHeight = 24
        if (options?.fillColor) {
        document.save()
        document.fillColor(options.fillColor).rect(document.page.margins.left, top, pageWidth, rowHeight).fill()
        document.restore()
      }

        values.forEach((value, index) => {
          const left = document.page.margins.left + index * columnWidth
          document.rect(left, top, columnWidth, rowHeight).stroke('#111827')
          document.fontSize(options?.bold ? 10.5 : 10)
          document.text(value, left + 6, top + 6, {
          width: columnWidth - 12,
          align: index === 0 ? 'left' : 'right'
        })
      })

      return top + rowHeight
    }

    document.fontSize(18).text(detail.content.title, { align: 'center' })
    document.moveDown(0.5)
    if (detail.content.formCode) {
      document.fontSize(10).text(detail.content.formCode, { align: 'center' })
      document.moveDown(0.25)
    }
    document.fontSize(10).text(`编制单位：${detail.ledger_name}`, { continued: true })
    document.text(`单位：元`, { align: 'right' })
    document.text(`会计期间：${detail.period}`, { continued: true })
    document.text(
      detail.content.scope.includeUnpostedVouchers ? '统计口径：含未记账凭证' : '统计口径：仅已记账凭证',
      { align: 'right' }
    )
    document.text(`取数范围：${detail.content.scope.startDate} 至 ${detail.content.scope.endDate}`)
    document.moveDown(0.5)

    let top = document.y
    top = drawRow(headers, top, { bold: true })

    let currentSection = ''
    for (const row of rows) {
      if (top > document.page.height - 80) {
        document.addPage()
        top = document.page.margins.top
        top = drawRow(headers, top, { bold: true })
      }

      if (!hasOfficialTables && row.section !== currentSection) {
        currentSection = row.section
        top = drawRow([currentSection, ...Array(headers.length - 1).fill('')], top, {
          bold: true,
          fillColor: '#f3f4f6'
        })
      }

      top = drawRow(row.values, top)
    }

    if (!hasOfficialTables) {
      if (top > document.page.height - 120) {
        document.addPage()
        top = document.page.margins.top
      }

      document.moveDown()
      document.fontSize(12).text('汇总', document.page.margins.left, top + 8)
      top += 28
      top = drawRow(['项目', '金额'], top, { bold: true })
      detail.content.totals.forEach((total) => {
        top = drawRow([total.label, formatAmount(total.amountCents)], top)
      })
    }

    document.end()
    stream.on('finish', () => resolve())
    stream.on('error', reject)
    document.on('error', reject)
  })

  return filePath
}

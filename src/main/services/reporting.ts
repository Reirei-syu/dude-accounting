import type Database from 'better-sqlite3'
import { isCarryForwardSourceCategory } from '../database/subjectCategoryRules'

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

export interface DuplicateReportSnapshotRow {
  id: number
}

export type ReportExportFormat = 'xlsx' | 'pdf'

type LedgerRow = {
  id: number
  name: string
  standard_type: AccountingStandardType
  start_period: string
  current_period: string
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
const EQUITY_STATEMENT_TITLE = '所有者权益变动表'

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
  if (reportType === 'equity_statement') {
    if (standardType !== 'enterprise') {
      throw new Error('当前账套不支持生成所有者权益变动表')
    }
    return EQUITY_STATEMENT_TITLE
  }
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
      `SELECT id, name, standard_type, start_period, current_period
       FROM ledgers
       WHERE id = ?`
    )
    .get(ledgerId) as LedgerRow | undefined

  if (!ledger) {
    throw new Error('账套不存在')
  }

  return ledger
}

function getEffectiveLedgerStartPeriod(ledger: LedgerRow, targetPeriod: string): string {
  const candidates = [ledger.start_period, ledger.current_period, targetPeriod].filter((period) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  )

  return candidates.sort(comparePeriods)[0] ?? ledger.start_period
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
  return specs.reduce((sum, spec) => {
    let matchedAmount = 0
    for (const [subjectCode, amount] of amounts) {
      if (subjectCode === spec.code || subjectCode.startsWith(spec.code)) {
        matchedAmount += amount
      }
    }
    return sum + matchedAmount * (spec.sign ?? 1)
  }, 0)
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

function insertHeaderBreakBeforeParenthesis(label: string): string {
  return label.replace('（', '\n（')
}

function shiftPeriod(period: string, yearDelta: number): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  return `${String(Number(yearText) + yearDelta).padStart(4, '0')}-${monthText}`
}

type PrefixSpec = { code: string; sign?: 1 | -1 }

type EnterpriseBalancePoint = {
  balanceMap: Map<string, number>
  unsettledProfitLossNet: number
}

type EnterpriseProfitStatementAmounts = {
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

type EquityColumnState = {
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

const ENTERPRISE_CASH_SUBJECT_PREFIXES = ['1001', '1002', '1012']

function matchesPrefix(subjectCode: string, prefix: string): boolean {
  return subjectCode === prefix || subjectCode.startsWith(prefix)
}

function sumEntriesByPrefixSpecs(
  entries: EntryWithVoucher[],
  specs: PrefixSpec[],
  mode: 'credit_minus_debit' | 'debit_minus_credit'
): number {
  return entries.reduce((sum, entry) => {
    const spec = specs.find((candidate) => matchesPrefix(entry.subject_code, candidate.code))
    if (!spec) {
      return sum
    }
    const amount =
      mode === 'credit_minus_debit'
        ? entry.credit_amount - entry.debit_amount
        : entry.debit_amount - entry.credit_amount
    return sum + amount * (spec.sign ?? 1)
  }, 0)
}

function listEffectiveEntries(
  db: Database.Database,
  ledgerId: number,
  startDate: string,
  endDate: string,
  includeUnpostedVouchers: boolean
): EntryWithVoucher[] {
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledgerId, startDate, endDate),
    includeUnpostedVouchers
  )
  return mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )
}

function buildEnterpriseBalancePoint(
  db: Database.Database,
  ledger: LedgerRow,
  subjects: SubjectRow[],
  targetPeriod: string,
  includeUnpostedVouchers: boolean
): EnterpriseBalancePoint {
  const effectiveLedgerStartPeriod = getEffectiveLedgerStartPeriod(ledger, targetPeriod)
  const openingBySubject = listInitialBalances(db, ledger.id, targetPeriod)
  const targetDate = getPeriodEndDate(targetPeriod)
  const entriesBySubject = groupEntriesBySubject(
    listEffectiveEntries(
      db,
      ledger.id,
      getPeriodStartDate(effectiveLedgerStartPeriod),
      targetDate,
      includeUnpostedVouchers
    )
  )
  const balanceMap = buildSubjectBalanceMap(
    subjects,
    openingBySubject,
    entriesBySubject,
    effectiveLedgerStartPeriod,
    targetDate
  )
  const unsettledProfitLossNet = subjects
    .filter((subject) => isCarryForwardSourceCategory(ledger.standard_type, subject.category))
    .reduce((sum, subject) => {
      const amount = balanceMap.get(subject.code) ?? 0
      return sum + (subject.balance_direction === -1 ? amount : -amount)
    }, 0)

  return {
    balanceMap,
    unsettledProfitLossNet
  }
}

function getPreviousPeriod(period: string): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1))
  date.setUTCMonth(date.getUTCMonth() - 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function createEnterpriseComparableRow(
  key: string,
  label: string,
  lineNo: string,
  priorYearEnd: number,
  ending: number
): ReportSnapshotLine {
  return {
    key,
    label,
    lineNo,
    amountCents: ending,
    cells: {
      prior_year_end: priorYearEnd,
      ending
    }
  }
}

function createEnterpriseMovementRow(
  key: string,
  label: string,
  currentAmount: number,
  priorAmount: number
): ReportSnapshotTableRow {
  return {
    key,
    cells: [createTextCell(label), createAmountCell(currentAmount), createAmountCell(priorAmount)]
  }
}

function buildEnterpriseProfitAmounts(
  entries: EntryWithVoucher[]
): EnterpriseProfitStatementAmounts {
  const operatingRevenue = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6001' }, { code: '6021' }, { code: '6031' }, { code: '6041' }, { code: '6051' }],
    'credit_minus_debit'
  )
  const operatingCost = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6401' }, { code: '6402' }],
    'debit_minus_credit'
  )
  const taxesAndSurcharges = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6403' }],
    'debit_minus_credit'
  )
  const sellingExpenses = sumEntriesByPrefixSpecs(entries, [{ code: '6601' }], 'debit_minus_credit')
  const administrativeExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6602' }],
    'debit_minus_credit'
  )
  const researchExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '5301' }],
    'debit_minus_credit'
  )
  const financeExpenses = sumEntriesByPrefixSpecs(entries, [{ code: '6603' }], 'debit_minus_credit')
  const interestExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6411' }],
    'debit_minus_credit'
  )
  const interestIncome = sumEntriesByPrefixSpecs(entries, [{ code: '6011' }], 'credit_minus_debit')
  const otherIncome = 0
  const investmentIncome = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6111' }],
    'credit_minus_debit'
  )
  const associateInvestmentIncome = 0
  const derecognitionGain = 0
  const hedgeGain = 0
  const fairValueChangeGain = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6101' }],
    'credit_minus_debit'
  )
  const creditImpairmentLoss = 0
  const assetImpairmentLoss = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6701' }],
    'debit_minus_credit'
  )
  const assetDisposalGain = 0
  const nonOperatingIncome = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6301' }],
    'credit_minus_debit'
  )
  const nonOperatingExpense = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6711' }],
    'debit_minus_credit'
  )
  const incomeTaxExpense = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6801' }],
    'debit_minus_credit'
  )
  const otherComprehensiveIncome = 0

  const operatingProfit =
    operatingRevenue -
    operatingCost -
    taxesAndSurcharges -
    sellingExpenses -
    administrativeExpenses -
    researchExpenses -
    financeExpenses +
    otherIncome +
    investmentIncome +
    associateInvestmentIncome +
    derecognitionGain +
    hedgeGain +
    fairValueChangeGain -
    creditImpairmentLoss -
    assetImpairmentLoss +
    assetDisposalGain
  const totalProfit = operatingProfit + nonOperatingIncome - nonOperatingExpense
  const netProfit = totalProfit - incomeTaxExpense
  const comprehensiveIncomeTotal = netProfit + otherComprehensiveIncome

  return {
    operatingRevenue,
    operatingCost,
    taxesAndSurcharges,
    sellingExpenses,
    administrativeExpenses,
    researchExpenses,
    financeExpenses,
    interestExpenses,
    interestIncome,
    otherIncome,
    investmentIncome,
    associateInvestmentIncome,
    derecognitionGain,
    hedgeGain,
    fairValueChangeGain,
    creditImpairmentLoss,
    assetImpairmentLoss,
    assetDisposalGain,
    nonOperatingIncome,
    nonOperatingExpense,
    incomeTaxExpense,
    otherComprehensiveIncome,
    operatingProfit,
    totalProfit,
    netProfit,
    comprehensiveIncomeTotal
  }
}

function buildEnterpriseEquityState(point: EnterpriseBalancePoint): EquityColumnState {
  const paidInCapital = sumTemplateAmount(point.balanceMap, [{ code: '4001' }])
  const capitalReserve = sumTemplateAmount(point.balanceMap, [{ code: '4002' }])
  const treasuryStock = sumTemplateAmount(point.balanceMap, [{ code: '4201' }])
  const surplusReserve = sumTemplateAmount(point.balanceMap, [{ code: '4101' }])
  const generalRiskReserve = sumTemplateAmount(point.balanceMap, [{ code: '4102' }])
  const undistributedProfit =
    sumTemplateAmount(point.balanceMap, [{ code: '4103' }, { code: '4104' }]) +
    point.unsettledProfitLossNet
  const otherComprehensiveIncome = 0
  const otherEquityInstruments = 0
  const preferredShares = 0
  const perpetualBonds = 0
  const otherEquityInstrumentsOther = 0
  const specialReserve = 0
  const totalEquity =
    paidInCapital +
    capitalReserve +
    otherComprehensiveIncome +
    specialReserve +
    surplusReserve +
    generalRiskReserve +
    undistributedProfit -
    treasuryStock

  return {
    paidInCapital,
    otherEquityInstruments,
    preferredShares,
    perpetualBonds,
    otherEquityInstrumentsOther,
    capitalReserve,
    treasuryStock,
    otherComprehensiveIncome,
    specialReserve,
    surplusReserve,
    generalRiskReserve,
    undistributedProfit,
    totalEquity
  }
}

function equityStateToCells(values: EquityColumnState): ReportSnapshotTableCell[] {
  return [
    createAmountCell(values.paidInCapital),
    createAmountCell(values.otherEquityInstruments),
    createAmountCell(values.preferredShares),
    createAmountCell(values.perpetualBonds),
    createAmountCell(values.otherEquityInstrumentsOther),
    createAmountCell(values.capitalReserve),
    createAmountCell(values.treasuryStock),
    createAmountCell(values.otherComprehensiveIncome),
    createAmountCell(values.specialReserve),
    createAmountCell(values.surplusReserve),
    createAmountCell(values.generalRiskReserve),
    createAmountCell(values.undistributedProfit),
    createAmountCell(values.totalEquity)
  ]
}

function subtractEquityStates(
  left: EquityColumnState,
  right: EquityColumnState
): EquityColumnState {
  return {
    paidInCapital: left.paidInCapital - right.paidInCapital,
    otherEquityInstruments: left.otherEquityInstruments - right.otherEquityInstruments,
    preferredShares: left.preferredShares - right.preferredShares,
    perpetualBonds: left.perpetualBonds - right.perpetualBonds,
    otherEquityInstrumentsOther:
      left.otherEquityInstrumentsOther - right.otherEquityInstrumentsOther,
    capitalReserve: left.capitalReserve - right.capitalReserve,
    treasuryStock: left.treasuryStock - right.treasuryStock,
    otherComprehensiveIncome: left.otherComprehensiveIncome - right.otherComprehensiveIncome,
    specialReserve: left.specialReserve - right.specialReserve,
    surplusReserve: left.surplusReserve - right.surplusReserve,
    generalRiskReserve: left.generalRiskReserve - right.generalRiskReserve,
    undistributedProfit: left.undistributedProfit - right.undistributedProfit,
    totalEquity: left.totalEquity - right.totalEquity
  }
}

function emptyEquityState(): EquityColumnState {
  return {
    paidInCapital: 0,
    otherEquityInstruments: 0,
    preferredShares: 0,
    perpetualBonds: 0,
    otherEquityInstrumentsOther: 0,
    capitalReserve: 0,
    treasuryStock: 0,
    otherComprehensiveIncome: 0,
    specialReserve: 0,
    surplusReserve: 0,
    generalRiskReserve: 0,
    undistributedProfit: 0,
    totalEquity: 0
  }
}

function buildCashBalanceAtPeriodEnd(
  db: Database.Database,
  ledger: LedgerRow,
  subjects: SubjectRow[],
  targetPeriod: string,
  includeUnpostedVouchers: boolean
): number {
  const point = buildEnterpriseBalancePoint(
    db,
    ledger,
    subjects,
    targetPeriod,
    includeUnpostedVouchers
  )
  return sumTemplateAmount(
    point.balanceMap,
    ENTERPRISE_CASH_SUBJECT_PREFIXES.map((code) => ({ code }))
  )
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
  const longTermInvestmentTotalRow = buildSumRow(
    'long_term_investment_total',
    '长期投资合计',
    '13',
    [longTermEquityRow, longTermDebtRow, otherLongInvestmentRow]
  )

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
  const otherCurrentLiabilityRow = buildRow('other_current_liability', '其他流动负债', '68', [])
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
  const otherLongTermLiabilityRow = buildRow('other_long_term_liability', '其他长期负债', '73', [])
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
    pairRow(
      'row-1',
      createHeadingRow('asset-current-heading', '一、流动资产：'),
      createHeadingRow('liability-current-heading', '一、流动负债：')
    ),
    pairRow('row-2', cashRow, shortTermLoanRow),
    pairRow('row-3', shortInvestmentRow, payablesRow),
    pairRow('row-4', receivablesRow, payrollRow),
    pairRow('row-5', prepaymentRow, taxesRow),
    pairRow('row-6', inventoryRow, advanceReceiptsRow),
    pairRow('row-7', prepaidExpenseRow, accruedExpenseRow),
    pairRow('row-8', currentLongInvestmentRow, currentLongLiabilityRow),
    pairRow('row-9', otherCurrentAssetRow, otherCurrentLiabilityRow),
    pairRow('row-10', flowAssetsTotalRow, flowLiabilityTotalRow),
    pairRow(
      'row-11',
      createHeadingRow('asset-noncurrent-heading', '二、非流动资产：'),
      createHeadingRow('liability-long-heading', '二、长期负债：')
    ),
    pairRow(
      'row-12',
      createHeadingRow('asset-long-investment-heading', '长期投资：'),
      longTermLoanRow
    ),
    pairRow('row-13', longTermEquityRow, longTermPayableRow),
    pairRow('row-14', longTermDebtRow, estimatedLiabilityRow),
    pairRow('row-15', otherLongInvestmentRow, otherLongTermLiabilityRow),
    pairRow('row-16', longTermInvestmentTotalRow, longTermLiabilityTotalRow),
    pairRow(
      'row-17',
      createHeadingRow('asset-fixed-heading', '固定资产：'),
      createHeadingRow('entrusted-liability-heading', '三、受托代理负债')
    ),
    pairRow('row-18', fixedAssetCostRow, entrustedLiabilityRow),
    pairRow('row-19', accumulatedDepreciationRow, liabilityTotalRow),
    pairRow('row-20', fixedAssetNetRow, createHeadingRow('net-assets-heading', '四、净资产：')),
    pairRow('row-21', constructionInProgressRow, unrestrictedNetAssetsRow),
    pairRow('row-22', fixedAssetDisposalRow, restrictedNetAssetsRow),
    pairRow('row-23', fixedAssetsTotalRow, netAssetsTotalRow),
    pairRow('row-24', culturalRelicRow, undefined),
    pairRow('row-25', createHeadingRow('asset-intangible-heading', '无形资产：'), undefined),
    pairRow('row-26', intangibleOriginalRow, undefined),
    pairRow('row-27', intangibleAccumulatedRow, undefined),
    pairRow('row-28', intangibleNetRow, undefined),
    pairRow('row-29', longPrepaidRow, undefined),
    pairRow('row-30', nonCurrentAssetTotalRow, undefined),
    pairRow('row-31', createHeadingRow('asset-entrusted-heading', '五、受托代理资产：'), undefined),
    pairRow('row-32', entrustedAssetRow, undefined),
    pairRow('row-33', assetTotalRow, liabilityAndNetAssetsTotalRow)
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
  const effectiveLedgerStartPeriod = getEffectiveLedgerStartPeriod(ledger, scope.endPeriod)
  const openingBySubject = listInitialBalances(db, ledger.id, scope.endPeriod)
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(
      db,
      ledger.id,
      getPeriodStartDate(effectiveLedgerStartPeriod),
      scope.endDate
    ),
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

  const profitLossSubjects = subjects.filter((subject) =>
    isCarryForwardSourceCategory(ledger.standard_type, subject.category)
  )

  const closingBalanceMap = buildSubjectBalanceMap(
    subjects,
    openingBySubject,
    entriesBySubject,
    effectiveLedgerStartPeriod,
    scope.endDate
  )
  const openingBalanceMap = new Map<string, number>()
  for (const subject of subjects) {
    openingBalanceMap.set(
      subject.code,
      getOpeningBalance(subject, openingBySubject.get(subject.code))
    )
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
  const currentPoint: EnterpriseBalancePoint = {
    balanceMap: closingBalanceMap,
    unsettledProfitLossNet: profitLossSubjects.reduce((sum, subject) => {
      const amount = toSubjectBalance(
        subject,
        openingBySubject.get(subject.code),
        entriesBySubject.get(subject.code) ?? [],
        effectiveLedgerStartPeriod,
        scope.endDate
      )
      return sum + (subject.balance_direction === -1 ? amount : -amount)
    }, 0)
  }
  const priorYear = String(Number(scope.endPeriod.slice(0, 4)) - 1).padStart(4, '0')
  const priorYearEndPoint = buildEnterpriseBalancePoint(
    db,
    ledger,
    subjects,
    `${priorYear}-12`,
    scope.includeUnpostedVouchers
  )
  const currentEquityState = buildEnterpriseEquityState(currentPoint)
  const priorYearEndEquityState = buildEnterpriseEquityState(priorYearEndPoint)

  const buildRow = (key: string, label: string, specs: PrefixSpec[]): ReportSnapshotLine =>
    createEnterpriseComparableRow(
      key,
      label,
      '',
      sumTemplateAmount(priorYearEndPoint.balanceMap, specs),
      sumTemplateAmount(currentPoint.balanceMap, specs)
    )

  const buildSumRow = (
    key: string,
    label: string,
    rows: ReportSnapshotLine[]
  ): ReportSnapshotLine =>
    createEnterpriseComparableRow(
      key,
      label,
      '',
      rows.reduce((sum, row) => sum + (row.cells?.prior_year_end ?? 0), 0),
      rows.reduce((sum, row) => sum + (row.cells?.ending ?? 0), 0)
    )

  const headingRow = (key: string, label: string): ReportSnapshotLine => ({
    key,
    label,
    amountCents: 0
  })

  const cashRow = buildRow('cash', '货币资金', [
    { code: '1001' },
    { code: '1002' },
    { code: '1012' }
  ])
  const tradingAssetRow = buildRow('trading_asset', '交易性金融资产', [{ code: '1101' }])
  const derivativeAssetRow = buildRow('derivative_asset', '衍生金融资产', [{ code: '3101' }])
  const notesReceivableRow = buildRow('notes_receivable', '应收票据', [{ code: '1121' }])
  const accountsReceivableRow = buildRow('accounts_receivable', '应收账款', [{ code: '1122' }])
  const receivablesFinancingRow = buildRow('receivables_financing', '应收款项融资', [])
  const prepaymentRow = buildRow('prepayments', '预付款项', [{ code: '1123' }])
  const contractAssetRow = buildRow('contract_assets', '合同资产', [])
  const otherReceivableRow = buildRow('other_receivables', '其他应收款', [
    { code: '1131' },
    { code: '1132' },
    { code: '1221' },
    { code: '1231', sign: -1 }
  ])
  const inventoryRow = buildRow('inventory', '存货', [
    { code: '1401' },
    { code: '1402' },
    { code: '1403' },
    { code: '1404' },
    { code: '1405' },
    { code: '1406' },
    { code: '1407', sign: -1 },
    { code: '1408' },
    { code: '1411' },
    { code: '1421' },
    { code: '1431' },
    { code: '1441' },
    { code: '1451' },
    { code: '1471', sign: -1 }
  ])
  const heldForSaleAssetRow = buildRow('held_for_sale_assets', '持有待售资产', [])
  const oneYearNonCurrentAssetRow = buildRow(
    'one_year_noncurrent_assets',
    '一年内到期的非流动资产',
    []
  )
  const otherCurrentAssetRow = buildRow('other_current_assets', '其他流动资产', [
    { code: '1021' },
    { code: '1031' },
    { code: '1111' },
    { code: '1201' },
    { code: '1211' },
    { code: '1212' },
    { code: '1301' },
    { code: '1302' },
    { code: '1303' },
    { code: '1304', sign: -1 },
    { code: '1311' },
    { code: '1321' },
    { code: '1901' }
  ])
  const totalCurrentAssetsRow = buildSumRow('total_current_assets', '流动资产合计', [
    cashRow,
    tradingAssetRow,
    derivativeAssetRow,
    notesReceivableRow,
    accountsReceivableRow,
    receivablesFinancingRow,
    prepaymentRow,
    contractAssetRow,
    otherReceivableRow,
    inventoryRow,
    heldForSaleAssetRow,
    oneYearNonCurrentAssetRow,
    otherCurrentAssetRow
  ])

  const debtInvestmentRow = buildRow('debt_investment', '债权投资', [
    { code: '1501' },
    { code: '1502', sign: -1 }
  ])
  const otherDebtInvestmentRow = buildRow('other_debt_investment', '其他债权投资', [
    { code: '1503' }
  ])
  const longTermReceivableRow = buildRow('long_term_receivable', '长期应收款', [
    { code: '1531' },
    { code: '1532', sign: -1 }
  ])
  const longTermEquityInvestmentRow = buildRow('long_term_equity_investment', '长期股权投资', [
    { code: '1511' },
    { code: '1512', sign: -1 }
  ])
  const otherEquityInvestmentRow = buildRow('other_equity_investment', '其他权益工具投资', [])
  const otherNonCurrentFinancialAssetRow = buildRow(
    'other_noncurrent_financial_assets',
    '其他非流动金融资产',
    [{ code: '1541' }]
  )
  const investmentPropertyRow = buildRow('investment_property', '投资性房地产', [{ code: '1521' }])
  const fixedAssetRow = buildRow('fixed_assets', '固定资产', [
    { code: '1601' },
    { code: '1602', sign: -1 },
    { code: '1603', sign: -1 }
  ])
  const constructionRow = buildRow('construction', '在建工程', [{ code: '1604' }])
  const biologicalAssetRow = buildRow('biological_assets', '生产性生物资产', [
    { code: '1621' },
    { code: '1622', sign: -1 }
  ])
  const oilGasRow = buildRow('oil_gas_assets', '油气资产', [
    { code: '1631' },
    { code: '1632', sign: -1 }
  ])
  const rightOfUseRow = buildRow('right_of_use_assets', '使用权资产', [])
  const intangibleRow = buildRow('intangible_assets', '无形资产', [
    { code: '1701' },
    { code: '1702', sign: -1 },
    { code: '1703', sign: -1 }
  ])
  const developmentRow = buildRow('development_expenditure', '开发支出', [])
  const goodwillRow = buildRow('goodwill', '商誉', [{ code: '1711' }])
  const longDeferredExpenseRow = buildRow('long_deferred_expenses', '长期待摊费用', [
    { code: '1801' }
  ])
  const deferredTaxAssetRow = buildRow('deferred_tax_assets', '递延所得税资产', [{ code: '1811' }])
  const otherNonCurrentAssetRow = buildRow('other_noncurrent_assets', '其他非流动资产', [
    { code: '1611' },
    { code: '1821' }
  ])
  const totalNonCurrentAssetsRow = buildSumRow('total_noncurrent_assets', '非流动资产合计', [
    debtInvestmentRow,
    otherDebtInvestmentRow,
    longTermReceivableRow,
    longTermEquityInvestmentRow,
    otherEquityInvestmentRow,
    otherNonCurrentFinancialAssetRow,
    investmentPropertyRow,
    fixedAssetRow,
    constructionRow,
    biologicalAssetRow,
    oilGasRow,
    rightOfUseRow,
    intangibleRow,
    developmentRow,
    goodwillRow,
    longDeferredExpenseRow,
    deferredTaxAssetRow,
    otherNonCurrentAssetRow
  ])
  const totalAssetsRow = buildSumRow('total_assets', '资产总计', [
    totalCurrentAssetsRow,
    totalNonCurrentAssetsRow
  ])

  const shortTermLoanRow = buildRow('short_term_loans', '短期借款', [{ code: '2001' }])
  const tradingLiabilityRow = buildRow('trading_liabilities', '交易性金融负债', [{ code: '2101' }])
  const derivativeLiabilityRow = buildRow('derivative_liabilities', '衍生金融负债', [
    { code: '3101', sign: -1 }
  ])
  const notesPayableRow = buildRow('notes_payable', '应付票据', [{ code: '2201' }])
  const accountsPayableRow = buildRow('accounts_payable', '应付账款', [{ code: '2202' }])
  const advanceReceiptRow = buildRow('advance_receipts', '预收款项', [{ code: '2203' }])
  const contractLiabilityRow = buildRow('contract_liabilities', '合同负债', [])
  const payrollRow = buildRow('employee_compensation', '应付职工薪酬', [{ code: '2211' }])
  const taxesRow = buildRow('taxes_payable', '应交税费', [{ code: '2221' }])
  const otherPayableRow = buildRow('other_payables', '其他应付款', [
    { code: '2231' },
    { code: '2232' },
    { code: '2241' }
  ])
  const heldForSaleLiabilityRow = buildRow('held_for_sale_liabilities', '持有待售负债', [])
  const oneYearNonCurrentLiabilityRow = buildRow(
    'one_year_noncurrent_liabilities',
    '一年内到期的非流动负债',
    []
  )
  const otherCurrentLiabilityRow = buildRow('other_current_liabilities', '其他流动负债', [
    { code: '2002' },
    { code: '2003' },
    { code: '2004' },
    { code: '2011' },
    { code: '2012' },
    { code: '2021' },
    { code: '2251' },
    { code: '2261' },
    { code: '2311' },
    { code: '2312' },
    { code: '2313' },
    { code: '2314' }
  ])
  const totalCurrentLiabilitiesRow = buildSumRow('total_current_liabilities', '流动负债合计', [
    shortTermLoanRow,
    tradingLiabilityRow,
    derivativeLiabilityRow,
    notesPayableRow,
    accountsPayableRow,
    advanceReceiptRow,
    contractLiabilityRow,
    payrollRow,
    taxesRow,
    otherPayableRow,
    heldForSaleLiabilityRow,
    oneYearNonCurrentLiabilityRow,
    otherCurrentLiabilityRow
  ])

  const longTermLoanRow = buildRow('long_term_loans', '长期借款', [{ code: '2501' }])
  const bondsPayableRow = buildRow('bonds_payable', '应付债券', [{ code: '2502' }])
  const preferredShareRow = buildRow('preferred_share', '  其中：优先股', [])
  const perpetualBondRow = buildRow('perpetual_bond', '  永续债', [])
  const leaseLiabilityRow = buildRow('lease_liability', '租赁负债', [])
  const longTermPayableRow = buildRow('long_term_payables', '长期应付款', [
    { code: '2701' },
    { code: '2702', sign: -1 }
  ])
  const estimatedLiabilityRow = buildRow('estimated_liabilities', '预计负债', [{ code: '2801' }])
  const deferredIncomeRow = buildRow('deferred_income', '递延收益', [{ code: '2401' }])
  const deferredTaxLiabilityRow = buildRow('deferred_tax_liabilities', '递延所得税负债', [
    { code: '2901' }
  ])
  const otherNonCurrentLiabilityRow = buildRow('other_noncurrent_liabilities', '其他非流动负债', [
    { code: '2601' },
    { code: '2602' },
    { code: '2611' },
    { code: '2621' },
    { code: '2711' }
  ])
  const totalNonCurrentLiabilitiesRow = buildSumRow(
    'total_noncurrent_liabilities',
    '非流动负债合计',
    [
      longTermLoanRow,
      bondsPayableRow,
      leaseLiabilityRow,
      longTermPayableRow,
      estimatedLiabilityRow,
      deferredIncomeRow,
      deferredTaxLiabilityRow,
      otherNonCurrentLiabilityRow
    ]
  )
  const totalLiabilitiesRow = buildSumRow('total_liabilities', '负债合计', [
    totalCurrentLiabilitiesRow,
    totalNonCurrentLiabilitiesRow
  ])

  const paidInCapitalRow = createEnterpriseComparableRow(
    'paid_in_capital',
    '实收资本（或股本）',
    '',
    priorYearEndEquityState.paidInCapital,
    currentEquityState.paidInCapital
  )
  const otherEquityInstrumentRow = createEnterpriseComparableRow(
    'other_equity_instruments',
    '其他权益工具',
    '',
    priorYearEndEquityState.otherEquityInstruments,
    currentEquityState.otherEquityInstruments
  )
  const otherPreferredShareRow = createEnterpriseComparableRow(
    'other_equity_preferred',
    '  其中：优先股',
    '',
    priorYearEndEquityState.preferredShares,
    currentEquityState.preferredShares
  )
  const otherPerpetualBondRow = createEnterpriseComparableRow(
    'other_equity_perpetual',
    '  永续债',
    '',
    priorYearEndEquityState.perpetualBonds,
    currentEquityState.perpetualBonds
  )
  const capitalReserveRow = createEnterpriseComparableRow(
    'capital_reserve',
    '资本公积',
    '',
    priorYearEndEquityState.capitalReserve,
    currentEquityState.capitalReserve
  )
  const treasuryStockRow = createEnterpriseComparableRow(
    'treasury_stock',
    '减：库存股',
    '',
    priorYearEndEquityState.treasuryStock,
    currentEquityState.treasuryStock
  )
  const ociRow = createEnterpriseComparableRow(
    'other_comprehensive_income',
    '其他综合收益',
    '',
    priorYearEndEquityState.otherComprehensiveIncome,
    currentEquityState.otherComprehensiveIncome
  )
  const specialReserveRow = createEnterpriseComparableRow(
    'special_reserve',
    '专项储备',
    '',
    priorYearEndEquityState.specialReserve,
    currentEquityState.specialReserve
  )
  const surplusReserveRow = createEnterpriseComparableRow(
    'surplus_reserve',
    '盈余公积',
    '',
    priorYearEndEquityState.surplusReserve,
    currentEquityState.surplusReserve
  )
  const undistributedProfitRow = createEnterpriseComparableRow(
    'undistributed_profit',
    '未分配利润',
    '',
    priorYearEndEquityState.undistributedProfit,
    currentEquityState.undistributedProfit
  )
  const totalEquityRow = createEnterpriseComparableRow(
    'total_equity',
    '所有者权益（或股东权益）合计',
    '',
    priorYearEndEquityState.totalEquity,
    currentEquityState.totalEquity
  )
  const totalLiabilitiesAndEquityRow = buildSumRow(
    'total_liabilities_equity',
    '负债和所有者权益（或股东权益）总计',
    [totalLiabilitiesRow, totalEquityRow]
  )

  const assetSectionRows = [
    cashRow,
    tradingAssetRow,
    derivativeAssetRow,
    notesReceivableRow,
    accountsReceivableRow,
    receivablesFinancingRow,
    prepaymentRow,
    contractAssetRow,
    otherReceivableRow,
    inventoryRow,
    heldForSaleAssetRow,
    oneYearNonCurrentAssetRow,
    otherCurrentAssetRow,
    totalCurrentAssetsRow,
    debtInvestmentRow,
    otherDebtInvestmentRow,
    longTermReceivableRow,
    longTermEquityInvestmentRow,
    otherEquityInvestmentRow,
    otherNonCurrentFinancialAssetRow,
    investmentPropertyRow,
    fixedAssetRow,
    constructionRow,
    biologicalAssetRow,
    oilGasRow,
    rightOfUseRow,
    intangibleRow,
    developmentRow,
    goodwillRow,
    longDeferredExpenseRow,
    deferredTaxAssetRow,
    otherNonCurrentAssetRow,
    totalNonCurrentAssetsRow,
    totalAssetsRow
  ]
  const liabilityEquitySectionRows = [
    shortTermLoanRow,
    tradingLiabilityRow,
    derivativeLiabilityRow,
    notesPayableRow,
    accountsPayableRow,
    advanceReceiptRow,
    contractLiabilityRow,
    payrollRow,
    taxesRow,
    otherPayableRow,
    heldForSaleLiabilityRow,
    oneYearNonCurrentLiabilityRow,
    otherCurrentLiabilityRow,
    totalCurrentLiabilitiesRow,
    longTermLoanRow,
    bondsPayableRow,
    preferredShareRow,
    perpetualBondRow,
    leaseLiabilityRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    deferredIncomeRow,
    deferredTaxLiabilityRow,
    otherNonCurrentLiabilityRow,
    totalNonCurrentLiabilitiesRow,
    totalLiabilitiesRow,
    paidInCapitalRow,
    otherEquityInstrumentRow,
    otherPreferredShareRow,
    otherPerpetualBondRow,
    capitalReserveRow,
    treasuryStockRow,
    ociRow,
    specialReserveRow,
    surplusReserveRow,
    undistributedProfitRow,
    totalEquityRow,
    totalLiabilitiesAndEquityRow
  ]

  const amountCellsForRow = (row?: ReportSnapshotLine): ReportSnapshotTableCell[] =>
    row?.cells
      ? [createAmountCell(row.cells.ending ?? 0), createAmountCell(row.cells.prior_year_end ?? 0)]
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
    pairRow(
      'bs-1',
      headingRow('asset-current', '一、流动资产：'),
      headingRow('liability-current', '一、流动负债：')
    ),
    pairRow('bs-2', cashRow, shortTermLoanRow),
    pairRow('bs-3', tradingAssetRow, tradingLiabilityRow),
    pairRow('bs-4', derivativeAssetRow, derivativeLiabilityRow),
    pairRow('bs-5', notesReceivableRow, notesPayableRow),
    pairRow('bs-6', accountsReceivableRow, accountsPayableRow),
    pairRow('bs-7', receivablesFinancingRow, advanceReceiptRow),
    pairRow('bs-8', prepaymentRow, contractLiabilityRow),
    pairRow('bs-9', contractAssetRow, payrollRow),
    pairRow('bs-10', otherReceivableRow, taxesRow),
    pairRow('bs-11', inventoryRow, otherPayableRow),
    pairRow('bs-12', heldForSaleAssetRow, heldForSaleLiabilityRow),
    pairRow('bs-13', oneYearNonCurrentAssetRow, oneYearNonCurrentLiabilityRow),
    pairRow('bs-14', otherCurrentAssetRow, otherCurrentLiabilityRow),
    pairRow('bs-15', totalCurrentAssetsRow, totalCurrentLiabilitiesRow),
    pairRow(
      'bs-16',
      headingRow('asset-noncurrent', '二、非流动资产：'),
      headingRow('liability-noncurrent', '二、非流动负债：')
    ),
    pairRow('bs-17', debtInvestmentRow, longTermLoanRow),
    pairRow('bs-18', otherDebtInvestmentRow, bondsPayableRow),
    pairRow('bs-19', longTermReceivableRow, preferredShareRow),
    pairRow('bs-20', longTermEquityInvestmentRow, perpetualBondRow),
    pairRow('bs-21', otherEquityInvestmentRow, leaseLiabilityRow),
    pairRow('bs-22', otherNonCurrentFinancialAssetRow, longTermPayableRow),
    pairRow('bs-23', investmentPropertyRow, estimatedLiabilityRow),
    pairRow('bs-24', fixedAssetRow, deferredIncomeRow),
    pairRow('bs-25', constructionRow, deferredTaxLiabilityRow),
    pairRow('bs-26', biologicalAssetRow, otherNonCurrentLiabilityRow),
    pairRow('bs-27', oilGasRow, totalNonCurrentLiabilitiesRow),
    pairRow('bs-28', rightOfUseRow, totalLiabilitiesRow),
    pairRow('bs-29', intangibleRow, headingRow('equity-heading', '三、所有者权益（或股东权益）：')),
    pairRow('bs-30', developmentRow, paidInCapitalRow),
    pairRow('bs-31', goodwillRow, otherEquityInstrumentRow),
    pairRow('bs-32', longDeferredExpenseRow, otherPreferredShareRow),
    pairRow('bs-33', deferredTaxAssetRow, otherPerpetualBondRow),
    pairRow('bs-34', otherNonCurrentAssetRow, capitalReserveRow),
    pairRow('bs-35', totalNonCurrentAssetsRow, treasuryStockRow),
    pairRow('bs-36', totalAssetsRow, ociRow),
    pairRow('bs-37', undefined, specialReserveRow),
    pairRow('bs-38', undefined, surplusReserveRow),
    pairRow('bs-39', undefined, undistributedProfitRow),
    pairRow('bs-40', undefined, totalEquityRow),
    pairRow('bs-41', undefined, totalLiabilitiesAndEquityRow)
  ]

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企01表',
    tables: [
      {
        key: 'enterprise-balance-sheet',
        columns: [
          { key: 'left_label', label: '资产' },
          { key: 'left_ending', label: '期末余额' },
          { key: 'left_prior', label: '上年年末余额' },
          { key: 'right_label', label: '负债和所有者权益（或股东权益）' },
          { key: 'right_ending', label: '期末余额' },
          { key: 'right_prior', label: '上年年末余额' }
        ],
        rows: officialRows
      }
    ],
    sections: [
      { key: 'assets', title: '资产', rows: assetSectionRows },
      { key: 'liabilities_equity', title: '负债和所有者权益', rows: liabilityEquitySectionRows }
    ],
    totals: [
      { key: 'assets', label: '资产总计', amountCents: totalAssetsRow.amountCents },
      { key: 'liabilities', label: '负债合计', amountCents: totalLiabilitiesRow.amountCents },
      { key: 'equity', label: '所有者权益合计', amountCents: totalEquityRow.amountCents }
    ]
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
    if (
      !prefixes.some(
        (prefix) => entry.subject_code === prefix || entry.subject_code.startsWith(prefix)
      )
    ) {
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

function sumNgoNetAssetTransfers(
  entries: EntryWithVoucher[],
  period?: string
): {
  restrictedToUnrestricted: number
  unrestrictedToRestricted: number
} {
  const netAssetChangesByVoucher = new Map<number, { unrestricted: number; restricted: number }>()

  for (const entry of entries) {
    if (period && entry.period !== period) {
      continue
    }

    const isUnrestricted =
      entry.subject_code === '3101' || entry.subject_code.startsWith('3101')
    const isRestricted = entry.subject_code === '3102' || entry.subject_code.startsWith('3102')

    if (!isUnrestricted && !isRestricted) {
      continue
    }

    const current = netAssetChangesByVoucher.get(entry.voucher_id) ?? {
      unrestricted: 0,
      restricted: 0
    }
    const netChange = entry.credit_amount - entry.debit_amount

    if (isUnrestricted) {
      current.unrestricted += netChange
    }
    if (isRestricted) {
      current.restricted += netChange
    }

    netAssetChangesByVoucher.set(entry.voucher_id, current)
  }

  let restrictedToUnrestricted = 0
  let unrestrictedToRestricted = 0

  for (const change of netAssetChangesByVoucher.values()) {
    if (change.unrestricted > 0 && change.restricted < 0) {
      restrictedToUnrestricted += Math.min(change.unrestricted, Math.abs(change.restricted))
    } else if (change.unrestricted < 0 && change.restricted > 0) {
      unrestrictedToRestricted += Math.min(Math.abs(change.unrestricted), change.restricted)
    }
  }

  return {
    restrictedToUnrestricted,
    unrestrictedToRestricted
  }
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
    key: string,
    label: string,
    current: { unrestricted: number; restricted: number },
    cumulative: { unrestricted: number; restricted: number }
  ): ReportSnapshotTableRow => ({
    key,
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
      `income-${group.prefixes[0]}`,
      group.label,
      sumEntriesByPrefixes(entries, group.prefixes, 'income', scope.endPeriod),
      sumEntriesByPrefixes(entries, group.prefixes, 'income')
    )
  )
  const expenseRows = expenseGroups.map((group) =>
    rowOf(
      `expense-${group.prefixes[0]}`,
      group.label,
      sumEntriesByPrefixes(entries, group.prefixes, 'expense', scope.endPeriod),
      sumEntriesByPrefixes(entries, group.prefixes, 'expense')
    )
  )
  const currentTransfers = sumNgoNetAssetTransfers(entries, scope.endPeriod)
  const cumulativeTransfers = sumNgoNetAssetTransfers(entries)
  const restrictedToUnrestrictedCurrent = {
    unrestricted: currentTransfers.restrictedToUnrestricted,
    restricted: -currentTransfers.restrictedToUnrestricted
  }
  const restrictedToUnrestrictedCumulative = {
    unrestricted: cumulativeTransfers.restrictedToUnrestricted,
    restricted: -cumulativeTransfers.restrictedToUnrestricted
  }
  const unrestrictedToRestrictedCurrent = {
    unrestricted: -currentTransfers.unrestrictedToRestricted,
    restricted: currentTransfers.unrestrictedToRestricted
  }
  const unrestrictedToRestrictedCumulative = {
    unrestricted: -cumulativeTransfers.unrestrictedToRestricted,
    restricted: cumulativeTransfers.unrestrictedToRestricted
  }

  const sumColumns = (rows: ReportSnapshotTableRow[]): number[] =>
    [1, 2, 3, 4, 5, 6].map((index) =>
      rows.reduce(
        (sum, row) =>
          sum + (typeof row.cells[index]?.value === 'number' ? Number(row.cells[index].value) : 0),
        0
      )
    )

  const incomeTotals = sumColumns(incomeRows)
  const expenseTotals = sumColumns(expenseRows)
  const zeroSix = [0, 0, 0, 0, 0, 0]
  const netValues = [
    incomeTotals[0] -
      expenseTotals[0] +
      restrictedToUnrestrictedCurrent.unrestricted +
      unrestrictedToRestrictedCurrent.unrestricted,
    incomeTotals[1] -
      expenseTotals[1] +
      restrictedToUnrestrictedCurrent.restricted +
      unrestrictedToRestrictedCurrent.restricted,
    incomeTotals[2] - expenseTotals[2],
    incomeTotals[3] -
      expenseTotals[3] +
      restrictedToUnrestrictedCumulative.unrestricted +
      unrestrictedToRestrictedCumulative.unrestricted,
    incomeTotals[4] -
      expenseTotals[4] +
      restrictedToUnrestrictedCumulative.restricted +
      unrestrictedToRestrictedCumulative.restricted,
    incomeTotals[5] - expenseTotals[5]
  ]

  const tableRows: ReportSnapshotTableRow[] = [
    {
      key: 'income-header',
      cells: [createTextCell('一、收入'), ...zeroSix.map(() => createTextCell(''))]
    },
    ...incomeRows,
    {
      key: 'income-total',
      cells: [createTextCell('收入合计'), ...incomeTotals.map((value) => createAmountCell(value))]
    },
    {
      key: 'expense-header',
      cells: [createTextCell('二、费用'), ...zeroSix.map(() => createTextCell(''))]
    },
    ...expenseRows,
    {
      key: 'expense-total',
      cells: [createTextCell('费用合计'), ...expenseTotals.map((value) => createAmountCell(value))]
    },
    rowOf(
      'restricted-to-unrestricted',
      '三、限定性净资产转为非限定性净资产',
      restrictedToUnrestrictedCurrent,
      restrictedToUnrestrictedCumulative
    ),
    rowOf(
      'unrestricted-to-restricted',
      '四、非限定性净资产转为限定性净资产',
      unrestrictedToRestrictedCurrent,
      unrestrictedToRestrictedCumulative
    ),
    {
      key: 'prior-adjustment',
      cells: [createTextCell('五、以前年度净资产调整'), ...zeroSix.map(() => createAmountCell(0))]
    },
    {
      key: 'net-assets-change',
      cells: [
        createTextCell('六、净资产变动额（减少以“-”号填列）'),
        ...netValues.map((value) => createAmountCell(value))
      ]
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
          {
            key: 'current_unrestricted',
            label: insertHeaderBreakBeforeParenthesis('本月数（非限定性）')
          },
          {
            key: 'current_restricted',
            label: insertHeaderBreakBeforeParenthesis('本月数（限定性）')
          },
          { key: 'current_total', label: insertHeaderBreakBeforeParenthesis('本月数（合计）') },
          {
            key: 'cumulative_unrestricted',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（非限定性）')
          },
          {
            key: 'cumulative_restricted',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（限定性）')
          },
          {
            key: 'cumulative_total',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（合计）')
          }
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

  type NgoCashflowRule = {
    label: string
    counterpartPrefixes?: string[]
    cashFlowCodes?: string[]
    cashFlowNames?: string[]
  }

  const operatingInRules: NgoCashflowRule[] = [
    { label: '接受捐赠收到的现金', counterpartPrefixes: ['4101'] },
    { label: '收取会费收到的现金', counterpartPrefixes: ['4201'] },
    {
      label: '提供服务收到的现金',
      counterpartPrefixes: ['4301'],
      cashFlowCodes: ['CF01'],
      cashFlowNames: ['提供服务收到的现金']
    },
    {
      label: '销售商品收到的现金',
      counterpartPrefixes: ['4501'],
      cashFlowCodes: ['CF01'],
      cashFlowNames: ['销售商品收到的现金']
    },
    { label: '政府补助收到的现金', counterpartPrefixes: ['4401'] },
    {
      label: '收到的其他与业务活动有关的现金',
      counterpartPrefixes: ['4601', '4701', '4901'],
      cashFlowCodes: ['CF03'],
      cashFlowNames: ['收到的其他与业务活动有关的现金', '收到其他与经营活动有关的现金']
    }
  ]
  const operatingOutRules: NgoCashflowRule[] = [
    { label: '提供捐赠或者资助支付的现金', counterpartPrefixes: ['5101'] },
    {
      label: '支付给员工以及为员工支付的现金',
      counterpartPrefixes: ['2204'],
      cashFlowCodes: ['CF05'],
      cashFlowNames: ['支付给员工以及为员工支付的现金', '支付给职工以及为职工支付的现金']
    },
    {
      label: '购买商品、接受服务支付的现金',
      counterpartPrefixes: ['2202', '1141'],
      cashFlowCodes: ['CF04'],
      cashFlowNames: ['购买商品、接受服务支付的现金', '购买商品、接受劳务支付的现金']
    },
    {
      label: '各项税费支付的现金',
      counterpartPrefixes: ['2206'],
      cashFlowCodes: ['CF06'],
      cashFlowNames: ['各项税费支付的现金', '支付的各项税费']
    },
    {
      label: '支付的其他与业务活动有关的现金',
      counterpartPrefixes: ['2209', '2301', '5201', '5301', '5401', '5501', '5601', '5901'],
      cashFlowCodes: ['CF07'],
      cashFlowNames: ['支付的其他与业务活动有关的现金', '支付其他与经营活动有关的现金']
    }
  ]
  const investingInRules: NgoCashflowRule[] = [
    {
      label: '收回投资所收到的现金',
      cashFlowCodes: ['CF08'],
      cashFlowNames: ['收回投资所收到的现金', '收回投资收到的现金']
    },
    {
      label: '取得投资收益所收到的现金',
      cashFlowCodes: ['CF09'],
      cashFlowNames: ['取得投资收益所收到的现金', '取得投资收益收到的现金']
    },
    {
      label: '处置固定资产、无形资产和其他非流动资产收回的现金',
      cashFlowCodes: ['CF10'],
      cashFlowNames: [
        '处置固定资产、无形资产和其他非流动资产收回的现金',
        '处置固定资产等长期资产收回的现金净额'
      ]
    },
    {
      label: '收到的其他与投资活动有关的现金',
      cashFlowCodes: ['CF11'],
      cashFlowNames: ['收到的其他与投资活动有关的现金', '收到其他与投资活动有关的现金']
    }
  ]
  const investingOutRules: NgoCashflowRule[] = [
    {
      label: '购建固定资产、无形资产和其他非流动资产支付的现金',
      cashFlowCodes: ['CF12'],
      cashFlowNames: [
        '购建固定资产、无形资产和其他非流动资产支付的现金',
        '购建固定资产等长期资产支付的现金'
      ]
    },
    {
      label: '对外投资所支付的现金',
      cashFlowCodes: ['CF13'],
      cashFlowNames: ['对外投资所支付的现金', '投资支付的现金']
    },
    {
      label: '支付的其他与投资活动有关的现金',
      cashFlowCodes: ['CF14'],
      cashFlowNames: ['支付的其他与投资活动有关的现金', '支付其他与投资活动有关的现金']
    }
  ]
  const financingInRules: NgoCashflowRule[] = [
    {
      label: '借款所收到的现金',
      cashFlowCodes: ['CF16'],
      cashFlowNames: ['借款所收到的现金', '取得借款收到的现金']
    },
    {
      label: '收到的其他与筹资活动有关的现金',
      cashFlowCodes: ['CF17'],
      cashFlowNames: ['收到的其他与筹资活动有关的现金', '收到其他与筹资活动有关的现金']
    }
  ]
  const financingOutRules: NgoCashflowRule[] = [
    {
      label: '偿还借款所支付的现金',
      cashFlowCodes: ['CF18'],
      cashFlowNames: ['偿还借款所支付的现金', '偿还债务支付的现金']
    },
    {
      label: '偿付利息所支付的现金',
      cashFlowCodes: ['CF19'],
      cashFlowNames: ['偿付利息所支付的现金', '分配股利、利润或偿付利息支付的现金']
    },
    {
      label: '支付的其他与筹资活动有关的现金',
      cashFlowCodes: ['CF20'],
      cashFlowNames: ['支付的其他与筹资活动有关的现金', '支付其他与筹资活动有关的现金']
    }
  ]
  const allRules = [
    ...operatingInRules,
    ...operatingOutRules,
    ...investingInRules,
    ...investingOutRules,
    ...financingInRules,
    ...financingOutRules
  ]

  const matchesCounterpartPrefix = (subjectCode: string, prefix: string): boolean =>
    subjectCode === prefix || subjectCode.startsWith(prefix)

  const buildCashflowAmountMap = (entries: EntryWithVoucher[]): Map<string, number> => {
    const amountByLabel = new Map(allRules.map((rule) => [rule.label, 0]))
    const itemById = new Map(currentItems.map((item) => [item.id, item]))
    const entriesByVoucherId = new Map<number, EntryWithVoucher[]>()

    for (const entry of entries) {
      const current = entriesByVoucherId.get(entry.voucher_id) ?? []
      current.push(entry)
      entriesByVoucherId.set(entry.voucher_id, current)
    }

    for (const entry of entries) {
      if (entry.cash_flow_item_id === null) {
        continue
      }

      const item = itemById.get(entry.cash_flow_item_id)
      if (!item) {
        continue
      }

      const counterpartEntries = (entriesByVoucherId.get(entry.voucher_id) ?? []).filter(
        (candidate) => candidate.id !== entry.id && candidate.cash_flow_item_id === null
      )
      const counterpartCodes = counterpartEntries.map((candidate) => candidate.subject_code)

      const matchedByCounterpart = allRules.find((rule) =>
        (rule.counterpartPrefixes ?? []).some((prefix) =>
          counterpartCodes.some((subjectCode) => matchesCounterpartPrefix(subjectCode, prefix))
        )
      )
      const matchedRule =
        matchedByCounterpart ??
        allRules.find(
          (rule) =>
            (rule.cashFlowCodes ?? []).includes(item.code) ||
            (rule.cashFlowNames ?? []).includes(item.name)
        )

      if (!matchedRule) {
        continue
      }

      const amount = entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount
      amountByLabel.set(matchedRule.label, (amountByLabel.get(matchedRule.label) ?? 0) + amount)
    }

    return amountByLabel
  }

  const currentAmountByLabel = buildCashflowAmountMap(currentEntries)
  const previousAmountByLabel = buildCashflowAmountMap(previousEntries)

  const line = (
    label: string,
    currentAmount: number,
    previousAmount: number
  ): ReportSnapshotTableRow => ({
    key: label,
    cells: [
      createTextCell(label),
      createAmountCell(currentAmount),
      createAmountCell(previousAmount)
    ]
  })

  const currentByName = (label: string): number => currentAmountByLabel.get(label) ?? 0
  const previousByName = (label: string): number => previousAmountByLabel.get(label) ?? 0

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
  const financingOutRows = [
    '偿还借款所支付的现金',
    '偿付利息所支付的现金',
    '支付的其他与筹资活动有关的现金'
  ]

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
        amountCents:
          typeof tableRows[tableRows.length - 1].cells[1].value === 'number'
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
  const currentEntries = listEffectiveEntries(
    db,
    ledger.id,
    scope.startDate,
    scope.endDate,
    scope.includeUnpostedVouchers
  )
  const previousEntries = listEffectiveEntries(
    db,
    ledger.id,
    getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
    getPeriodEndDate(shiftPeriod(scope.endPeriod, -1)),
    scope.includeUnpostedVouchers
  )

  const current = buildEnterpriseProfitAmounts(currentEntries)
  const previous = buildEnterpriseProfitAmounts(previousEntries)

  const rows: ReportSnapshotTableRow[] = [
    createEnterpriseMovementRow(
      'operating_revenue',
      '一、营业收入',
      current.operatingRevenue,
      previous.operatingRevenue
    ),
    createEnterpriseMovementRow(
      'operating_cost',
      '减：营业成本',
      current.operatingCost,
      previous.operatingCost
    ),
    createEnterpriseMovementRow(
      'taxes_and_surcharges',
      '税金及附加',
      current.taxesAndSurcharges,
      previous.taxesAndSurcharges
    ),
    createEnterpriseMovementRow(
      'selling_expenses',
      '销售费用',
      current.sellingExpenses,
      previous.sellingExpenses
    ),
    createEnterpriseMovementRow(
      'administrative_expenses',
      '管理费用',
      current.administrativeExpenses,
      previous.administrativeExpenses
    ),
    createEnterpriseMovementRow(
      'research_expenses',
      '研发费用',
      current.researchExpenses,
      previous.researchExpenses
    ),
    createEnterpriseMovementRow(
      'finance_expenses',
      '财务费用',
      current.financeExpenses,
      previous.financeExpenses
    ),
    createEnterpriseMovementRow(
      'interest_expenses',
      '  其中：利息费用',
      current.interestExpenses,
      previous.interestExpenses
    ),
    createEnterpriseMovementRow(
      'interest_income',
      '  利息收入',
      current.interestIncome,
      previous.interestIncome
    ),
    createEnterpriseMovementRow(
      'other_income',
      '加：其他收益',
      current.otherIncome,
      previous.otherIncome
    ),
    createEnterpriseMovementRow(
      'investment_income',
      '投资收益（损失以“-”号填列）',
      current.investmentIncome,
      previous.investmentIncome
    ),
    createEnterpriseMovementRow(
      'associate_investment_income',
      '  其中：对联营企业和合营企业的投资收益',
      current.associateInvestmentIncome,
      previous.associateInvestmentIncome
    ),
    createEnterpriseMovementRow(
      'derecognition_gain',
      '以摊余成本计量的金融资产终止确认收益',
      current.derecognitionGain,
      previous.derecognitionGain
    ),
    createEnterpriseMovementRow(
      'hedge_gain',
      '净敞口套期收益',
      current.hedgeGain,
      previous.hedgeGain
    ),
    createEnterpriseMovementRow(
      'fair_value_gain',
      '公允价值变动收益',
      current.fairValueChangeGain,
      previous.fairValueChangeGain
    ),
    createEnterpriseMovementRow(
      'credit_impairment_loss',
      '信用减值损失',
      current.creditImpairmentLoss,
      previous.creditImpairmentLoss
    ),
    createEnterpriseMovementRow(
      'asset_impairment_loss',
      '资产减值损失',
      current.assetImpairmentLoss,
      previous.assetImpairmentLoss
    ),
    createEnterpriseMovementRow(
      'asset_disposal_gain',
      '资产处置收益',
      current.assetDisposalGain,
      previous.assetDisposalGain
    ),
    createEnterpriseMovementRow(
      'operating_profit',
      '二、营业利润（亏损以“-”号填列）',
      current.operatingProfit,
      previous.operatingProfit
    ),
    createEnterpriseMovementRow(
      'non_operating_income',
      '加：营业外收入',
      current.nonOperatingIncome,
      previous.nonOperatingIncome
    ),
    createEnterpriseMovementRow(
      'non_operating_expense',
      '减：营业外支出',
      current.nonOperatingExpense,
      previous.nonOperatingExpense
    ),
    createEnterpriseMovementRow(
      'total_profit',
      '三、利润总额（亏损总额以“-”号填列）',
      current.totalProfit,
      previous.totalProfit
    ),
    createEnterpriseMovementRow(
      'income_tax',
      '减：所得税费用',
      current.incomeTaxExpense,
      previous.incomeTaxExpense
    ),
    createEnterpriseMovementRow(
      'net_profit',
      '四、净利润（净亏损以“-”号填列）',
      current.netProfit,
      previous.netProfit
    ),
    createEnterpriseMovementRow(
      'going_concern_profit',
      '  （一）持续经营净利润',
      current.netProfit,
      previous.netProfit
    ),
    createEnterpriseMovementRow('discontinued_profit', '  （二）终止经营净利润', 0, 0),
    createEnterpriseMovementRow(
      'other_comprehensive_income',
      '五、其他综合收益的税后净额',
      current.otherComprehensiveIncome,
      previous.otherComprehensiveIncome
    ),
    createEnterpriseMovementRow(
      'other_comprehensive_nonreclass',
      '  （一）不能重分类进损益的其他综合收益',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'other_comprehensive_reclass',
      '  （二）将重分类进损益的其他综合收益',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'comprehensive_income_total',
      '六、综合收益总额',
      current.comprehensiveIncomeTotal,
      previous.comprehensiveIncomeTotal
    ),
    createEnterpriseMovementRow('earnings_per_share_header', '七、每股收益：', 0, 0),
    createEnterpriseMovementRow('basic_eps', '  （一）基本每股收益', 0, 0),
    createEnterpriseMovementRow('diluted_eps', '  （二）稀释每股收益', 0, 0)
  ]

  return {
    title,
    reportType: 'income_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企02表',
    tables: [
      {
        key: 'enterprise-income-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本期金额' },
          { key: 'previous', label: '上期金额' }
        ],
        rows
      }
    ],
    sections: [],
    totals: [
      { key: 'operating_revenue', label: '营业收入', amountCents: current.operatingRevenue },
      { key: 'operating_cost', label: '营业成本', amountCents: current.operatingCost },
      { key: 'net_profit', label: '净利润', amountCents: current.netProfit }
    ]
  }
}

function buildCashFlowSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const currentItems = listCashFlowItems(db, ledger.id)
  const currentEntries = listEffectiveEntries(
    db,
    ledger.id,
    scope.startDate,
    scope.endDate,
    scope.includeUnpostedVouchers
  )
  const previousEntries = listEffectiveEntries(
    db,
    ledger.id,
    getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
    getPeriodEndDate(shiftPeriod(scope.endPeriod, -1)),
    scope.includeUnpostedVouchers
  )

  const buildAmountByCode = (entries: EntryWithVoucher[]): Map<string, number> => {
    const amountByCode = new Map<string, number>()
    const itemById = new Map(currentItems.map((item) => [item.id, item]))
    for (const entry of entries) {
      if (entry.cash_flow_item_id === null) {
        continue
      }
      const item = itemById.get(entry.cash_flow_item_id)
      if (!item) {
        continue
      }
      addAmount(
        amountByCode,
        item.code,
        entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount
      )
    }
    return amountByCode
  }

  const currentByCode = buildAmountByCode(currentEntries)
  const previousByCode = buildAmountByCode(previousEntries)
  const amountBy = (map: Map<string, number>, code: string): number => map.get(code) ?? 0

  const currentOperatingIn =
    amountBy(currentByCode, 'CF01') +
    amountBy(currentByCode, 'CF02') +
    amountBy(currentByCode, 'CF03')
  const previousOperatingIn =
    amountBy(previousByCode, 'CF01') +
    amountBy(previousByCode, 'CF02') +
    amountBy(previousByCode, 'CF03')
  const currentOperatingOut =
    amountBy(currentByCode, 'CF04') +
    amountBy(currentByCode, 'CF05') +
    amountBy(currentByCode, 'CF06') +
    amountBy(currentByCode, 'CF07')
  const previousOperatingOut =
    amountBy(previousByCode, 'CF04') +
    amountBy(previousByCode, 'CF05') +
    amountBy(previousByCode, 'CF06') +
    amountBy(previousByCode, 'CF07')
  const currentInvestingIn =
    amountBy(currentByCode, 'CF08') +
    amountBy(currentByCode, 'CF09') +
    amountBy(currentByCode, 'CF10') +
    amountBy(currentByCode, 'CF11')
  const previousInvestingIn =
    amountBy(previousByCode, 'CF08') +
    amountBy(previousByCode, 'CF09') +
    amountBy(previousByCode, 'CF10') +
    amountBy(previousByCode, 'CF11')
  const currentInvestingOut =
    amountBy(currentByCode, 'CF12') +
    amountBy(currentByCode, 'CF13') +
    amountBy(currentByCode, 'CF14')
  const previousInvestingOut =
    amountBy(previousByCode, 'CF12') +
    amountBy(previousByCode, 'CF13') +
    amountBy(previousByCode, 'CF14')
  const currentFinancingIn =
    amountBy(currentByCode, 'CF15') +
    amountBy(currentByCode, 'CF16') +
    amountBy(currentByCode, 'CF17')
  const previousFinancingIn =
    amountBy(previousByCode, 'CF15') +
    amountBy(previousByCode, 'CF16') +
    amountBy(previousByCode, 'CF17')
  const currentFinancingOut =
    amountBy(currentByCode, 'CF18') +
    amountBy(currentByCode, 'CF19') +
    amountBy(currentByCode, 'CF20')
  const previousFinancingOut =
    amountBy(previousByCode, 'CF18') +
    amountBy(previousByCode, 'CF19') +
    amountBy(previousByCode, 'CF20')

  const currentBeginningCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    getPreviousPeriod(scope.startPeriod),
    scope.includeUnpostedVouchers
  )
  const previousBeginningCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    getPreviousPeriod(shiftPeriod(scope.startPeriod, -1)),
    scope.includeUnpostedVouchers
  )
  const currentEndingCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    scope.endPeriod,
    scope.includeUnpostedVouchers
  )
  const previousEndingCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    shiftPeriod(scope.endPeriod, -1),
    scope.includeUnpostedVouchers
  )
  const currentNetCash =
    currentOperatingIn -
    currentOperatingOut +
    (currentInvestingIn - currentInvestingOut) +
    (currentFinancingIn - currentFinancingOut)
  const previousNetCash =
    previousOperatingIn -
    previousOperatingOut +
    (previousInvestingIn - previousInvestingOut) +
    (previousFinancingIn - previousFinancingOut)

  const rows: ReportSnapshotTableRow[] = [
    createEnterpriseMovementRow('operating_header', '一、经营活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf01',
      '销售商品、提供劳务收到的现金',
      amountBy(currentByCode, 'CF01'),
      amountBy(previousByCode, 'CF01')
    ),
    createEnterpriseMovementRow(
      'cf02',
      '收到的税费返还',
      amountBy(currentByCode, 'CF02'),
      amountBy(previousByCode, 'CF02')
    ),
    createEnterpriseMovementRow(
      'cf03',
      '收到其他与经营活动有关的现金',
      amountBy(currentByCode, 'CF03'),
      amountBy(previousByCode, 'CF03')
    ),
    createEnterpriseMovementRow(
      'operating_in',
      '经营活动现金流入小计',
      currentOperatingIn,
      previousOperatingIn
    ),
    createEnterpriseMovementRow(
      'cf04',
      '购买商品、接受劳务支付的现金',
      amountBy(currentByCode, 'CF04'),
      amountBy(previousByCode, 'CF04')
    ),
    createEnterpriseMovementRow(
      'cf05',
      '支付给职工以及为职工支付的现金',
      amountBy(currentByCode, 'CF05'),
      amountBy(previousByCode, 'CF05')
    ),
    createEnterpriseMovementRow(
      'cf06',
      '支付的各项税费',
      amountBy(currentByCode, 'CF06'),
      amountBy(previousByCode, 'CF06')
    ),
    createEnterpriseMovementRow(
      'cf07',
      '支付其他与经营活动有关的现金',
      amountBy(currentByCode, 'CF07'),
      amountBy(previousByCode, 'CF07')
    ),
    createEnterpriseMovementRow(
      'operating_out',
      '经营活动现金流出小计',
      currentOperatingOut,
      previousOperatingOut
    ),
    createEnterpriseMovementRow(
      'operating_net',
      '经营活动产生的现金流量净额',
      currentOperatingIn - currentOperatingOut,
      previousOperatingIn - previousOperatingOut
    ),
    createEnterpriseMovementRow('investing_header', '二、投资活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf08',
      '收回投资收到的现金',
      amountBy(currentByCode, 'CF08'),
      amountBy(previousByCode, 'CF08')
    ),
    createEnterpriseMovementRow(
      'cf09',
      '取得投资收益收到的现金',
      amountBy(currentByCode, 'CF09'),
      amountBy(previousByCode, 'CF09')
    ),
    createEnterpriseMovementRow(
      'cf10',
      '处置固定资产、无形资产和其他长期资产收回的现金净额',
      amountBy(currentByCode, 'CF10'),
      amountBy(previousByCode, 'CF10')
    ),
    createEnterpriseMovementRow(
      'investing_subsidiary_in',
      '处置子公司及其他营业单位收到的现金净额',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'cf11',
      '收到其他与投资活动有关的现金',
      amountBy(currentByCode, 'CF11'),
      amountBy(previousByCode, 'CF11')
    ),
    createEnterpriseMovementRow(
      'investing_in',
      '投资活动现金流入小计',
      currentInvestingIn,
      previousInvestingIn
    ),
    createEnterpriseMovementRow(
      'cf12',
      '购建固定资产、无形资产和其他长期资产支付的现金',
      amountBy(currentByCode, 'CF12'),
      amountBy(previousByCode, 'CF12')
    ),
    createEnterpriseMovementRow(
      'cf13',
      '投资支付的现金',
      amountBy(currentByCode, 'CF13'),
      amountBy(previousByCode, 'CF13')
    ),
    createEnterpriseMovementRow(
      'investing_subsidiary_out',
      '取得子公司及其他营业单位支付的现金净额',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'cf14',
      '支付其他与投资活动有关的现金',
      amountBy(currentByCode, 'CF14'),
      amountBy(previousByCode, 'CF14')
    ),
    createEnterpriseMovementRow(
      'investing_out',
      '投资活动现金流出小计',
      currentInvestingOut,
      previousInvestingOut
    ),
    createEnterpriseMovementRow(
      'investing_net',
      '投资活动产生的现金流量净额',
      currentInvestingIn - currentInvestingOut,
      previousInvestingIn - previousInvestingOut
    ),
    createEnterpriseMovementRow('financing_header', '三、筹资活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf15',
      '吸收投资收到的现金',
      amountBy(currentByCode, 'CF15'),
      amountBy(previousByCode, 'CF15')
    ),
    createEnterpriseMovementRow(
      'cf16',
      '取得借款收到的现金',
      amountBy(currentByCode, 'CF16'),
      amountBy(previousByCode, 'CF16')
    ),
    createEnterpriseMovementRow(
      'cf17',
      '收到其他与筹资活动有关的现金',
      amountBy(currentByCode, 'CF17'),
      amountBy(previousByCode, 'CF17')
    ),
    createEnterpriseMovementRow(
      'financing_in',
      '筹资活动现金流入小计',
      currentFinancingIn,
      previousFinancingIn
    ),
    createEnterpriseMovementRow(
      'cf18',
      '偿还债务支付的现金',
      amountBy(currentByCode, 'CF18'),
      amountBy(previousByCode, 'CF18')
    ),
    createEnterpriseMovementRow(
      'cf19',
      '分配股利、利润或偿付利息支付的现金',
      amountBy(currentByCode, 'CF19'),
      amountBy(previousByCode, 'CF19')
    ),
    createEnterpriseMovementRow(
      'cf20',
      '支付其他与筹资活动有关的现金',
      amountBy(currentByCode, 'CF20'),
      amountBy(previousByCode, 'CF20')
    ),
    createEnterpriseMovementRow(
      'financing_out',
      '筹资活动现金流出小计',
      currentFinancingOut,
      previousFinancingOut
    ),
    createEnterpriseMovementRow(
      'financing_net',
      '筹资活动产生的现金流量净额',
      currentFinancingIn - currentFinancingOut,
      previousFinancingIn - previousFinancingOut
    ),
    createEnterpriseMovementRow('exchange_effect', '四、汇率变动对现金及现金等价物的影响', 0, 0),
    createEnterpriseMovementRow(
      'net_cash',
      '五、现金及现金等价物净增加额',
      currentNetCash,
      previousNetCash
    ),
    createEnterpriseMovementRow(
      'beginning_cash',
      '加：期初现金及现金等价物余额',
      currentBeginningCash,
      previousBeginningCash
    ),
    createEnterpriseMovementRow(
      'ending_cash',
      '六、期末现金及现金等价物余额',
      currentEndingCash,
      previousEndingCash
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
    formCode: '会企03表',
    tables: [
      {
        key: 'enterprise-cashflow-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本期金额' },
          { key: 'previous', label: '上期金额' }
        ],
        rows
      }
    ],
    sections: [],
    totals: [
      {
        key: 'operating_net',
        label: '经营活动现金流量净额',
        amountCents: currentOperatingIn - currentOperatingOut
      },
      {
        key: 'investing_net',
        label: '投资活动现金流量净额',
        amountCents: currentInvestingIn - currentInvestingOut
      },
      {
        key: 'financing_net',
        label: '筹资活动现金流量净额',
        amountCents: currentFinancingIn - currentFinancingOut
      },
      { key: 'net_cash_flow', label: '现金及现金等价物净增加额', amountCents: currentNetCash }
    ]
  }
}

function buildEnterpriseEquityStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const currentOpening = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      getPreviousPeriod(scope.startPeriod),
      scope.includeUnpostedVouchers
    )
  )
  const currentEnding = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      scope.endPeriod,
      scope.includeUnpostedVouchers
    )
  )
  const priorOpening = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      getPreviousPeriod(shiftPeriod(scope.startPeriod, -1)),
      scope.includeUnpostedVouchers
    )
  )
  const priorEnding = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      shiftPeriod(scope.endPeriod, -1),
      scope.includeUnpostedVouchers
    )
  )
  const currentChanges = subtractEquityStates(currentEnding, currentOpening)
  const priorChanges = subtractEquityStates(priorEnding, priorOpening)
  const currentProfit = buildEnterpriseProfitAmounts(
    listEffectiveEntries(
      db,
      ledger.id,
      scope.startDate,
      scope.endDate,
      scope.includeUnpostedVouchers
    )
  )
  const priorProfit = buildEnterpriseProfitAmounts(
    listEffectiveEntries(
      db,
      ledger.id,
      getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
      getPeriodEndDate(shiftPeriod(scope.endPeriod, -1)),
      scope.includeUnpostedVouchers
    )
  )

  const contributionState = (changes: EquityColumnState): EquityColumnState => ({
    ...emptyEquityState(),
    paidInCapital: changes.paidInCapital,
    otherEquityInstruments: changes.otherEquityInstruments,
    preferredShares: changes.preferredShares,
    perpetualBonds: changes.perpetualBonds,
    otherEquityInstrumentsOther: changes.otherEquityInstrumentsOther,
    capitalReserve: changes.capitalReserve,
    treasuryStock: changes.treasuryStock,
    totalEquity:
      changes.paidInCapital +
      changes.otherEquityInstruments +
      changes.preferredShares +
      changes.perpetualBonds +
      changes.otherEquityInstrumentsOther +
      changes.capitalReserve -
      changes.treasuryStock
  })
  const profitDistributionState = (changes: EquityColumnState): EquityColumnState => ({
    ...emptyEquityState(),
    surplusReserve: changes.surplusReserve,
    generalRiskReserve: changes.generalRiskReserve,
    totalEquity: changes.surplusReserve + changes.generalRiskReserve
  })
  const comprehensiveState = (profit: EnterpriseProfitStatementAmounts): EquityColumnState => ({
    ...emptyEquityState(),
    otherComprehensiveIncome: profit.otherComprehensiveIncome,
    undistributedProfit: profit.netProfit,
    totalEquity: profit.comprehensiveIncomeTotal
  })
  const currentContribution = contributionState(currentChanges)
  const priorContribution = contributionState(priorChanges)
  const currentDistribution = profitDistributionState(currentChanges)
  const priorDistribution = profitDistributionState(priorChanges)
  const currentComprehensive = comprehensiveState(currentProfit)
  const priorComprehensive = comprehensiveState(priorProfit)
  const currentResidual = subtractEquityStates(
    subtractEquityStates(
      subtractEquityStates(currentChanges, currentComprehensive),
      currentContribution
    ),
    currentDistribution
  )
  const priorResidual = subtractEquityStates(
    subtractEquityStates(subtractEquityStates(priorChanges, priorComprehensive), priorContribution),
    priorDistribution
  )
  const zero = emptyEquityState()
  const blockHeadingRow = (key: string, label: string): ReportSnapshotTableRow => ({
    key,
    cells: [createTextCell(label), ...Array.from({ length: 13 }, () => createTextCell(''))]
  })
  const stateRow = (
    key: string,
    label: string,
    values: EquityColumnState
  ): ReportSnapshotTableRow => ({
    key,
    cells: [createTextCell(label), ...equityStateToCells(values)]
  })

  const buildBlockRows = (
    prefix: 'current' | 'prior',
    opening: EquityColumnState,
    changes: EquityColumnState,
    comprehensive: EquityColumnState,
    contribution: EquityColumnState,
    distribution: EquityColumnState,
    residual: EquityColumnState,
    ending: EquityColumnState
  ): ReportSnapshotTableRow[] => [
    blockHeadingRow(`${prefix}-block-heading`, prefix === 'current' ? '本年金额' : '上年金额'),
    stateRow(`${prefix}-last-year-end`, '一、上年年末余额', opening),
    stateRow(`${prefix}-policy-change`, '加：会计政策变更', zero),
    stateRow(`${prefix}-error-correction`, '前期差错更正', zero),
    stateRow(`${prefix}-other-adjustments`, '其他', zero),
    stateRow(`${prefix}-beginning`, '二、本年年初余额', opening),
    stateRow(`${prefix}-total-change`, '三、本年增减变动金额（减少以“-”号填列）', changes),
    stateRow(`${prefix}-comprehensive`, '（一）综合收益总额', comprehensive),
    stateRow(`${prefix}-capital-change`, '（二）所有者投入和减少资本', contribution),
    stateRow(`${prefix}-ordinary-share`, '1．所有者投入的普通股', {
      ...zero,
      paidInCapital: contribution.paidInCapital,
      totalEquity: contribution.paidInCapital
    }),
    stateRow(`${prefix}-other-equity`, '2．其他权益工具持有者投入资本', {
      ...zero,
      otherEquityInstruments: contribution.otherEquityInstruments,
      preferredShares: contribution.preferredShares,
      perpetualBonds: contribution.perpetualBonds,
      otherEquityInstrumentsOther: contribution.otherEquityInstrumentsOther,
      totalEquity:
        contribution.otherEquityInstruments +
        contribution.preferredShares +
        contribution.perpetualBonds +
        contribution.otherEquityInstrumentsOther
    }),
    stateRow(`${prefix}-share-payment`, '3．股份支付计入所有者权益的金额', {
      ...zero,
      capitalReserve: contribution.capitalReserve,
      totalEquity: contribution.capitalReserve
    }),
    stateRow(`${prefix}-capital-other`, '4．其他', {
      ...zero,
      treasuryStock: contribution.treasuryStock,
      totalEquity: -contribution.treasuryStock
    }),
    stateRow(`${prefix}-profit-distribution`, '（三）利润分配', distribution),
    stateRow(`${prefix}-surplus`, '1．提取盈余公积', {
      ...zero,
      surplusReserve: distribution.surplusReserve,
      totalEquity: distribution.surplusReserve
    }),
    stateRow(`${prefix}-risk-reserve`, '2．提取一般风险准备', {
      ...zero,
      generalRiskReserve: distribution.generalRiskReserve,
      totalEquity: distribution.generalRiskReserve
    }),
    stateRow(`${prefix}-owner-distribution`, '3．对所有者（或股东）的分配', zero),
    stateRow(`${prefix}-profit-other`, '4．其他', zero),
    stateRow(`${prefix}-internal-carry`, '（四）所有者权益内部结转', residual),
    stateRow(`${prefix}-capital-reserve-transfer`, '1．资本公积转增资本（或股本）', zero),
    stateRow(`${prefix}-surplus-transfer`, '2．盈余公积转增资本（或股本）', zero),
    stateRow(`${prefix}-surplus-offset`, '3．盈余公积弥补亏损', zero),
    stateRow(`${prefix}-benefit-plan`, '4．设定受益计划变动额结转留存收益', zero),
    stateRow(`${prefix}-oci-carry`, '5．其他综合收益结转留存收益', {
      ...zero,
      otherComprehensiveIncome: residual.otherComprehensiveIncome,
      undistributedProfit: residual.undistributedProfit,
      totalEquity: residual.otherComprehensiveIncome + residual.undistributedProfit
    }),
    stateRow(`${prefix}-internal-other`, '6．其他', residual),
    stateRow(`${prefix}-ending`, '四、本年年末余额', ending)
  ]

  return {
    title: EQUITY_STATEMENT_TITLE,
    reportType: 'equity_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企04表',
    tables: [
      {
        key: 'enterprise-equity-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'paid_in_capital', label: '实收资本（或股本）' },
          { key: 'other_equity_instruments', label: '其他权益工具' },
          { key: 'preferred_shares', label: '优先股' },
          { key: 'perpetual_bonds', label: '永续债' },
          { key: 'other_equity_instruments_other', label: '其他' },
          { key: 'capital_reserve', label: '资本公积' },
          { key: 'treasury_stock', label: '减：库存股' },
          { key: 'other_comprehensive_income', label: '其他综合收益' },
          { key: 'special_reserve', label: '专项储备' },
          { key: 'surplus_reserve', label: '盈余公积' },
          { key: 'general_risk_reserve', label: '一般风险准备' },
          { key: 'undistributed_profit', label: '未分配利润' },
          { key: 'total_equity', label: '所有者权益合计' }
        ],
        rows: [
          ...buildBlockRows(
            'current',
            currentOpening,
            currentChanges,
            currentComprehensive,
            currentContribution,
            currentDistribution,
            currentResidual,
            currentEnding
          ),
          ...buildBlockRows(
            'prior',
            priorOpening,
            priorChanges,
            priorComprehensive,
            priorContribution,
            priorDistribution,
            priorResidual,
            priorEnding
          )
        ]
      }
    ],
    sections: [],
    totals: [
      {
        key: 'current_total_equity',
        label: '本年年末所有者权益合计',
        amountCents: currentEnding.totalEquity
      },
      {
        key: 'prior_total_equity',
        label: '上年年末所有者权益合计',
        amountCents: priorEnding.totalEquity
      }
    ]
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
  if (reportType === 'equity_statement') {
    return buildEnterpriseEquityStatementSnapshot(db, ledger, scope, generatedAt)
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
    .get(params.ledgerId, params.reportType, scope.periodLabel) as
    | DuplicateReportSnapshotRow
    | undefined

  if (duplicate) {
    throw new Error('已存在同会计期间同类型的报表，请先删除原报表后再生成')
  }

  let result: { lastInsertRowid: number }
  try {
    result = db
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
      ) as { lastInsertRowid: number }
  } catch (error) {
    if (error instanceof Error && error.message.includes('idx_report_snapshots_unique_scope')) {
      throw new Error('已存在同会计期间同类型的报表，请先删除原报表后再生成')
    }
    throw error
  }

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

export {
  deleteReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots
} from './reportSnapshotCatalog'
export {
  buildDefaultReportExportFileName,
  buildReportSnapshotHtml,
  writeReportSnapshotExcel,
  writeReportSnapshotHtml,
  writeReportSnapshotPdf
} from './reportSnapshotOutput'

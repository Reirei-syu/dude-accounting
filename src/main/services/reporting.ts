import type Database from 'better-sqlite3'

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
  tableColumns?: Array<{ key: string; label: string }>
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

function buildNgoBalanceSheetSnapshot(
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  openingMap: Map<string, number>,
  closingMap: Map<string, number>
): ReportSnapshotContent {
  const assetRows: ReportSnapshotLine[] = []
  const liabilityRows: ReportSnapshotLine[] = []

  const line = (
    collection: ReportSnapshotLine[],
    key: string,
    label: string,
    lineNo: string,
    specs: Array<{ code: string; sign?: 1 | -1 }>
  ): number => {
    const opening = sumTemplateAmount(openingMap, specs)
    const closing = sumTemplateAmount(closingMap, specs)
    collection.push(createTemplateRow(key, label, lineNo, opening, closing))
    return closing
  }

  const flowAssetClosing =
    line(assetRows, 'cash', '货币资金', '1', [
      { code: '1001' },
      { code: '1002' },
      { code: '1009' }
    ]) +
    line(assetRows, 'short_investment', '短期投资', '2', [
      { code: '1101' },
      { code: '1102', sign: -1 }
    ]) +
    line(assetRows, 'receivables', '应收款项', '3', [
      { code: '1111' },
      { code: '1121' },
      { code: '1122' },
      { code: '1131', sign: -1 }
    ]) +
    line(assetRows, 'prepayments', '预付账款', '4', [{ code: '1141' }]) +
    line(assetRows, 'inventory', '存货', '5', [
      { code: '1201' },
      { code: '1202', sign: -1 }
    ]) +
    line(assetRows, 'prepaid_expense', '待摊费用', '6', [{ code: '1301' }]) +
    line(assetRows, 'current_long_term_bond', '一年内到期的长期债权投资', '7', []) +
    line(assetRows, 'other_current_assets', '其他流动资产', '8', [])

  assetRows.push(
    createTemplateRow(
      'flow_assets_total',
      '流动资产合计',
      '9',
      assetRows.slice(0, 8).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      flowAssetClosing
    )
  )

  const longTermInvestmentClosing =
    line(assetRows, 'long_term_equity', '长期股权投资', '10', [{ code: '1401' }]) +
    line(assetRows, 'long_term_debt', '长期债权投资', '11', [{ code: '1402' }])

  assetRows.push(
    createTemplateRow(
      'long_term_investment_total',
      '长期投资合计',
      '12',
      assetRows.slice(9, 11).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      longTermInvestmentClosing
    )
  )

  line(assetRows, 'fixed_asset_cost', '固定资产原价', '13', [{ code: '1501' }])
  line(assetRows, 'accumulated_depreciation', '减：累计折旧', '14', [{ code: '1502' }])
  assetRows.push(
    createTemplateRow(
      'fixed_asset_net',
      '固定资产净值',
      '15',
      (assetRows[12].cells?.opening ?? 0) - (assetRows[13].cells?.opening ?? 0),
      (assetRows[12].cells?.closing ?? 0) - (assetRows[13].cells?.closing ?? 0)
    )
  )
  line(assetRows, 'construction_in_progress', '在建工程', '16', [{ code: '1505' }])
  line(assetRows, 'cultural_relic_asset', '文物文化资产', '17', [{ code: '1506' }])
  line(assetRows, 'fixed_asset_disposal', '固定资产清理', '18', [{ code: '1509' }])
  assetRows.push(
    createTemplateRow(
      'fixed_assets_total',
      '固定资产合计',
      '19',
      assetRows.slice(14, 18).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      assetRows.slice(14, 18).reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )
  )

  line(assetRows, 'intangible_assets', '无形资产', '20', [
    { code: '1601' },
    { code: '1602', sign: -1 }
  ])
  line(assetRows, 'entrusted_assets', '受托代理资产', '21', [{ code: '1801' }])
  assetRows.push(
    createTemplateRow(
      'asset_total',
      '资产总计',
      '22',
      assetRows.reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      assetRows.reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )
  )

  const flowLiabilityClosing =
    line(liabilityRows, 'short_term_loan', '短期借款', '61', [{ code: '2101' }]) +
    line(liabilityRows, 'payables', '应付款项', '62', [
      { code: '2201' },
      { code: '2202' },
      { code: '2209' }
    ]) +
    line(liabilityRows, 'payroll', '应付工资', '63', [{ code: '2204' }]) +
    line(liabilityRows, 'taxes', '应交税金', '64', [{ code: '2206' }]) +
    line(liabilityRows, 'advance_receipts', '预收账款', '65', [{ code: '2203' }]) +
    line(liabilityRows, 'accrued_expense', '预提费用', '66', [{ code: '2301' }]) +
    line(liabilityRows, 'estimated_liability', '预计负债', '67', [{ code: '2503' }]) +
    line(liabilityRows, 'current_long_term_liability', '一年内到期的长期负债', '68', []) +
    line(liabilityRows, 'other_current_liability', '其他流动负债', '69', [])

  liabilityRows.push(
    createTemplateRow(
      'flow_liability_total',
      '流动负债合计',
      '70',
      liabilityRows.slice(0, 9).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      flowLiabilityClosing
    )
  )

  const longTermLiabilityClosing =
    line(liabilityRows, 'long_term_loan', '长期借款', '71', [{ code: '2501' }]) +
    line(liabilityRows, 'long_term_payable', '长期应付款', '72', [{ code: '2502' }]) +
    line(liabilityRows, 'other_long_term_liability', '其他长期负债', '73', [])

  liabilityRows.push(
    createTemplateRow(
      'long_term_liability_total',
      '长期负债合计',
      '74',
      liabilityRows.slice(10, 13).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      longTermLiabilityClosing
    )
  )

  line(liabilityRows, 'entrusted_liability', '受托代理负债', '75', [{ code: '2601' }])
  liabilityRows.push(
    createTemplateRow(
      'liability_total',
      '负债合计',
      '76',
      liabilityRows
        .filter((row) => ['70', '74', '75'].includes(row.lineNo ?? ''))
        .reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      liabilityRows
        .filter((row) => ['70', '74', '75'].includes(row.lineNo ?? ''))
        .reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )
  )

  line(liabilityRows, 'unrestricted_net_assets', '非限定性净资产', '77', [{ code: '3101' }])
  line(liabilityRows, 'restricted_net_assets', '限定性净资产', '78', [{ code: '3102' }])
  liabilityRows.push(
    createTemplateRow(
      'net_assets_total',
      '净资产合计',
      '79',
      liabilityRows.slice(16, 18).reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      liabilityRows.slice(16, 18).reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )
  )
  liabilityRows.push(
    createTemplateRow(
      'liability_and_net_assets_total',
      '负债和净资产总计',
      '80',
      liabilityRows
        .filter((row) => ['76', '79'].includes(row.lineNo ?? ''))
        .reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      liabilityRows
        .filter((row) => ['76', '79'].includes(row.lineNo ?? ''))
        .reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )
  )

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    tableColumns: [
      { key: 'opening', label: '年初数' },
      { key: 'closing', label: '期末数' }
    ],
    sections: [
      { key: 'assets', title: '资产', rows: assetRows },
      { key: 'liabilities_and_net_assets', title: '负债和净资产', rows: liabilityRows }
    ],
    totals: [
      { key: 'assets', label: '资产总计', amountCents: assetRows[assetRows.length - 1].amountCents },
      { key: 'liabilities', label: '负债合计', amountCents: liabilityRows[15].amountCents },
      { key: 'net_assets', label: '净资产合计', amountCents: liabilityRows[18].amountCents }
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

  if (ledger.standard_type === 'npo') {
    return buildNgoBalanceSheetSnapshot(
      ledger,
      scope,
      generatedAt,
      openingBalanceMap,
      closingBalanceMap
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
  if (reportType === 'cashflow_statement') {
    return buildCashFlowSnapshot(db, ledger, scope, generatedAt)
  }
  return buildProfitLossSnapshot(db, ledger, scope, generatedAt, title)
}

function buildReportName(title: string, scope: ReportSnapshotScope): string {
  return `${title} ${scope.periodLabel}${scope.includeUnpostedVouchers ? '（含未记账凭证）' : ''}`
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

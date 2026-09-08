import type Database from 'better-sqlite3'
import type {
  ReportType,
  AccountingStandardType,
  LedgerRow,
  SubjectRow,
  InitialBalanceRow,
  VoucherRow,
  VoucherEntryRow,
  CashFlowItemRow,
  EntryWithVoucher,
  ReportSnapshotScope,
  ReportSnapshotTableCell,
  PrefixSpec,
  ReportSnapshotTableRow
} from './types'

export const BALANCE_SHEET_TITLE = '资产负债表'

const INCOME_STATEMENT_TITLE = '利润表'

export const ACTIVITY_STATEMENT_TITLE = '业务活动表'

export const CASHFLOW_STATEMENT_TITLE = '现金流量表'

export const EQUITY_STATEMENT_TITLE = '所有者权益变动表'

export function normalizeTimestamp(input?: string | Date): string {
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

export function getReportTitle(reportType: ReportType, standardType: AccountingStandardType): string {
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

export function getPeriodStartDate(period: string): string {
  assertPeriod(period)
  return `${period}-01`
}

export function getPeriodEndDate(period: string): string {
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

export function getLedger(db: Database.Database, ledgerId: number): LedgerRow {
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

export function getEffectiveLedgerStartPeriod(ledger: LedgerRow, targetPeriod: string): string {
  const candidates = [ledger.start_period, ledger.current_period, targetPeriod].filter((period) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  )

  return candidates.sort(comparePeriods)[0] ?? ledger.start_period
}

export function listSubjects(db: Database.Database, ledgerId: number): SubjectRow[] {
  return db
    .prepare(
      `SELECT code, name, category, balance_direction
       FROM subjects
       WHERE ledger_id = ?
       ORDER BY code ASC`
    )
    .all(ledgerId) as SubjectRow[]
}

export function listInitialBalances(
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

export function listVouchersInDateRange(
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

export function listVoucherEntriesByVoucherIds(
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

export function listCashFlowItems(db: Database.Database, ledgerId: number): CashFlowItemRow[] {
  return db
    .prepare(
      `SELECT id, code, name, category, direction
       FROM cash_flow_items
       WHERE ledger_id = ?
       ORDER BY category ASC, code ASC`
    )
    .all(ledgerId) as CashFlowItemRow[]
}

export function selectEffectiveVouchers(
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

export function mergeEntriesWithVouchers(
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

export function buildScope(
  reportType: ReportType,
  month: string | undefined,
  startPeriod: string | undefined,
  endPeriod: string | undefined,
  includeUnpostedVouchers: boolean
): ReportSnapshotScope {
  if (reportType === 'balance_sheet') {
    const normalizedMonth = month?.trim() ?? ''
    const normalizedStart = startPeriod?.trim() ?? ''
    const normalizedEnd = endPeriod?.trim() ?? ''
    if (!normalizedMonth && normalizedStart && normalizedEnd && normalizedStart !== normalizedEnd) {
      throw new Error('资产负债表只能按单月生成，起始月份和结束月份必须一致')
    }
    const targetMonth = normalizedMonth || normalizedStart || normalizedEnd
    if (!targetMonth) {
      throw new Error('资产负债表需要指定会计期间 month，或传入 startPeriod/endPeriod 中的一个 YYYY-MM 期间')
    }
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

export function addAmount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

export function getOpeningBalance(subject: SubjectRow, opening: InitialBalanceRow | undefined): number {
  return subject.balance_direction === 1
    ? (opening?.debit_amount ?? 0) - (opening?.credit_amount ?? 0)
    : (opening?.credit_amount ?? 0) - (opening?.debit_amount ?? 0)
}

export function buildSubjectBalanceMap(
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

export function sumTemplateAmount(
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

export function createTextCell(value: string | null = ''): ReportSnapshotTableCell {
  return { value }
}

export function createAmountCell(value: number): ReportSnapshotTableCell {
  return { value, isAmount: true }
}

export function insertHeaderBreakBeforeParenthesis(label: string): string {
  return label.replace('（', '\n（')
}

export function shiftPeriod(period: string, yearDelta: number): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  return `${String(Number(yearText) + yearDelta).padStart(4, '0')}-${monthText}`
}

function matchesPrefix(subjectCode: string, prefix: string): boolean {
  return subjectCode === prefix || subjectCode.startsWith(prefix)
}

export function sumEntriesByPrefixSpecs(
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

export function listEffectiveEntries(
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

export function getPreviousPeriod(period: string): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1))
  date.setUTCMonth(date.getUTCMonth() - 1)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function createEnterpriseMovementRow(
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

export function toSubjectBalance(
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

export function groupEntriesBySubject(entries: EntryWithVoucher[]): Map<string, EntryWithVoucher[]> {
  const map = new Map<string, EntryWithVoucher[]>()
  for (const entry of entries) {
    const items = map.get(entry.subject_code) ?? []
    items.push(entry)
    map.set(entry.subject_code, items)
  }
  return map
}

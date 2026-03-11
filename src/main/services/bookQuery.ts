import type Database from 'better-sqlite3'

type LedgerRow = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
}

type SubjectRow = {
  code: string
  name: string
  category: string
  balance_direction: number
  level: number
  is_leaf: 0 | 1
}

type InitialBalanceRow = {
  subject_code: string
  period: string
  debit_amount: number
  credit_amount: number
}

type AuxiliaryItemRow = {
  id: number
  category: string
  code: string
  name: string
}

type SubjectCustomAuxiliaryRow = {
  subject_code: string
  auxiliary_item_id: number
  auxiliary_category: string
  auxiliary_code: string
  auxiliary_name: string
}

type LedgerEntryRow = {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  voucher_date: string
  period: string
  voucher_number: number
  voucher_word: string
  voucher_status: 0 | 1 | 2
}

type AuxiliaryLedgerEntryRow = LedgerEntryRow & {
  auxiliary_item_id: number
  auxiliary_category: string
  auxiliary_code: string
  auxiliary_name: string
}

type ExactSubjectStat = {
  openingSigned: number
  periodDebit: number
  periodCredit: number
  endingSigned: number
}

export interface SubjectBalanceQuery {
  ledgerId: number
  startDate: string
  endDate: string
  keyword?: string
  includeUnpostedVouchers?: boolean
  includeZeroBalance?: boolean
}

export interface SubjectBalanceRow {
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
}

export interface DetailLedgerQuery {
  ledgerId: number
  subjectCode: string
  startDate: string
  endDate: string
  includeUnpostedVouchers?: boolean
}

export interface DetailLedgerRow {
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
}

export interface DetailLedgerResult {
  subject: {
    code: string
    name: string
    balance_direction: number
  }
  startDate: string
  endDate: string
  rows: DetailLedgerRow[]
}

export interface JournalQuery {
  ledgerId: number
  startDate: string
  endDate: string
  subjectCodeStart?: string
  subjectCodeEnd?: string
  includeUnpostedVouchers?: boolean
}

export interface JournalRow {
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
}

export interface AuxiliaryBalanceQuery {
  ledgerId: number
  startDate: string
  endDate: string
  subjectCodeStart?: string
  subjectCodeEnd?: string
  includeUnpostedVouchers?: boolean
}

export interface AuxiliaryBalanceRow {
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
}

export interface AuxiliaryDetailQuery {
  ledgerId: number
  subjectCode: string
  auxiliaryItemId: number
  startDate: string
  endDate: string
  includeUnpostedVouchers?: boolean
}

export interface AuxiliaryDetailRow {
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
}

export interface AuxiliaryDetailResult {
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
  rows: AuxiliaryDetailRow[]
}

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

function assertDate(date: string, fieldLabel: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date)) {
    throw new Error(`${fieldLabel}格式应为 YYYY-MM-DD`)
  }
}

function getPeriodStartDate(period: string): string {
  assertPeriod(period)
  return `${period}-01`
}

function comparePeriods(left: string, right: string): number {
  return left.localeCompare(right)
}

function matchesPrefix(subjectCode: string, prefix: string): boolean {
  return subjectCode === prefix || subjectCode.startsWith(prefix)
}

function isWithinSubjectCodeRange(
  subjectCode: string,
  startCode?: string,
  endCode?: string
): boolean {
  const normalizedStartCode = startCode?.trim() ?? ''
  const normalizedEndCode = endCode?.trim() ?? ''

  if (normalizedStartCode && subjectCode < normalizedStartCode) {
    return false
  }

  if (normalizedEndCode && subjectCode > normalizedEndCode) {
    return false
  }

  return true
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

  if (ledger.standard_type !== 'npo') {
    throw new Error('当前仅支持民非账套进行账簿查询试点')
  }

  return ledger
}

function getEffectiveLedgerStartPeriod(ledger: LedgerRow, targetPeriod: string): string {
  const candidates = [ledger.start_period, ledger.current_period, targetPeriod].filter((period) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(period)
  )

  return candidates.sort(comparePeriods)[0] ?? ledger.start_period
}

function listBookSubjects(db: Database.Database, ledgerId: number): SubjectRow[] {
  return db
    .prepare(
      `SELECT
         s.code,
         s.name,
         s.category,
         s.balance_direction,
         s.level,
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM subjects child
              WHERE child.ledger_id = s.ledger_id
                AND child.code <> s.code
                AND (child.parent_code = s.code OR child.code LIKE s.code || '%')
           ) THEN 0
           ELSE 1
         END AS is_leaf
       FROM subjects s
       WHERE s.ledger_id = ?
       ORDER BY s.code ASC`
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

function listLedgerEntries(
  db: Database.Database,
  ledgerId: number,
  startDate: string,
  endDate: string,
  includeUnpostedVouchers: boolean
): LedgerEntryRow[] {
  const statusCondition = includeUnpostedVouchers ? 'v.status IN (0, 1, 2)' : 'v.status = 2'

  return db
    .prepare(
      `SELECT
         ve.id,
         ve.voucher_id,
         ve.row_order,
         ve.summary,
         ve.subject_code,
         ve.debit_amount,
         ve.credit_amount,
         v.voucher_date,
         v.period,
         v.voucher_number,
         v.voucher_word,
         v.status AS voucher_status
       FROM vouchers v
       INNER JOIN voucher_entries ve ON ve.voucher_id = v.id
       WHERE v.ledger_id = ?
         AND ${statusCondition}
         AND v.voucher_date >= ?
         AND v.voucher_date <= ?
       ORDER BY
         v.voucher_date ASC,
         CASE WHEN v.voucher_word = '记' THEN 0 ELSE 1 END ASC,
         v.voucher_word ASC,
         v.voucher_number ASC,
         ve.row_order ASC,
         ve.id ASC`
    )
    .all(ledgerId, startDate, endDate) as LedgerEntryRow[]
}

function listAuxiliaryLedgerEntries(
  db: Database.Database,
  ledgerId: number,
  startDate: string,
  endDate: string,
  includeUnpostedVouchers: boolean
): AuxiliaryLedgerEntryRow[] {
  const statusCondition = includeUnpostedVouchers ? 'v.status IN (0, 1, 2)' : 'v.status = 2'

  return db
    .prepare(
      `SELECT
         ve.id,
         ve.voucher_id,
         ve.row_order,
         ve.summary,
         ve.subject_code,
         ve.debit_amount,
         ve.credit_amount,
         v.voucher_date,
         v.period,
         v.voucher_number,
         v.voucher_word,
         v.status AS voucher_status,
         ai.id AS auxiliary_item_id,
         ai.category AS auxiliary_category,
         ai.code AS auxiliary_code,
         ai.name AS auxiliary_name
       FROM vouchers v
       INNER JOIN voucher_entries ve ON ve.voucher_id = v.id
       INNER JOIN auxiliary_items ai ON ai.id = ve.auxiliary_item_id
       WHERE v.ledger_id = ?
         AND ${statusCondition}
         AND v.voucher_date >= ?
         AND v.voucher_date <= ?
       ORDER BY
         v.voucher_date ASC,
         CASE WHEN v.voucher_word = '记' THEN 0 ELSE 1 END ASC,
         v.voucher_word ASC,
         v.voucher_number ASC,
         ve.row_order ASC,
         ve.id ASC`
    )
    .all(ledgerId, startDate, endDate) as AuxiliaryLedgerEntryRow[]
}

function listSubjectCustomAuxiliaries(
  db: Database.Database,
  ledgerId: number
): Map<string, AuxiliaryItemRow[]> {
  const rows = db
    .prepare(
      `SELECT
         s.code AS subject_code,
         ai.id AS auxiliary_item_id,
         ai.category AS auxiliary_category,
         ai.code AS auxiliary_code,
         ai.name AS auxiliary_name
       FROM subject_auxiliary_custom_items saci
       INNER JOIN subjects s ON s.id = saci.subject_id
       INNER JOIN auxiliary_items ai ON ai.id = saci.auxiliary_item_id
       WHERE s.ledger_id = ?
       ORDER BY s.code ASC, ai.code ASC`
    )
    .all(ledgerId) as SubjectCustomAuxiliaryRow[]

  const grouped = new Map<string, AuxiliaryItemRow[]>()
  for (const row of rows) {
    const current = grouped.get(row.subject_code) ?? []
    current.push({
      id: row.auxiliary_item_id,
      category: row.auxiliary_category,
      code: row.auxiliary_code,
      name: row.auxiliary_name
    })
    grouped.set(row.subject_code, current)
  }

  return grouped
}

function listResolvedAuxiliaryLedgerEntries(
  db: Database.Database,
  ledgerId: number,
  startDate: string,
  endDate: string,
  includeUnpostedVouchers: boolean
): AuxiliaryLedgerEntryRow[] {
  const directAuxiliaryEntries = listAuxiliaryLedgerEntries(
    db,
    ledgerId,
    startDate,
    endDate,
    includeUnpostedVouchers
  )
  const directByEntryId = new Map(directAuxiliaryEntries.map((entry) => [entry.id, entry]))
  const customAuxiliariesBySubject = listSubjectCustomAuxiliaries(db, ledgerId)

  return listLedgerEntries(db, ledgerId, startDate, endDate, includeUnpostedVouchers)
    .map((entry) => {
      const directEntry = directByEntryId.get(entry.id)
      if (directEntry) {
        return directEntry
      }

      const inferredCustomItems = customAuxiliariesBySubject.get(entry.subject_code) ?? []
      if (inferredCustomItems.length !== 1) {
        return null
      }

      const [customItem] = inferredCustomItems
      return {
        ...entry,
        auxiliary_item_id: customItem.id,
        auxiliary_category: customItem.category,
        auxiliary_code: customItem.code,
        auxiliary_name: customItem.name
      } satisfies AuxiliaryLedgerEntryRow
    })
    .filter((entry): entry is AuxiliaryLedgerEntryRow => entry !== null)
}

function getAuxiliaryItem(
  db: Database.Database,
  ledgerId: number,
  auxiliaryItemId: number
): AuxiliaryItemRow {
  const item = db
    .prepare(
      `SELECT id, category, code, name
       FROM auxiliary_items
       WHERE ledger_id = ? AND id = ?`
    )
    .get(ledgerId, auxiliaryItemId) as AuxiliaryItemRow | undefined

  if (!item) {
    throw new Error('auxiliary item not found')
  }

  return item
}

function getSignedOpeningBalance(
  subject: SubjectRow,
  opening: InitialBalanceRow | undefined
): number {
  return subject.balance_direction === 1
    ? (opening?.debit_amount ?? 0) - (opening?.credit_amount ?? 0)
    : (opening?.credit_amount ?? 0) - (opening?.debit_amount ?? 0)
}

function getSignedDelta(
  subject: SubjectRow,
  entry: Pick<LedgerEntryRow, 'debit_amount' | 'credit_amount'>
): number {
  return subject.balance_direction === 1
    ? entry.debit_amount - entry.credit_amount
    : entry.credit_amount - entry.debit_amount
}

function splitBalanceToColumns(
  balanceDirection: number,
  signedBalance: number
): { debit: number; credit: number } {
  if (signedBalance === 0) {
    return { debit: 0, credit: 0 }
  }

  if (balanceDirection === 1) {
    return signedBalance > 0
      ? { debit: signedBalance, credit: 0 }
      : { debit: 0, credit: Math.abs(signedBalance) }
  }

  return signedBalance > 0
    ? { debit: 0, credit: signedBalance }
    : { debit: Math.abs(signedBalance), credit: 0 }
}

function getBalanceSide(
  balanceDirection: number,
  signedBalance: number
): 'debit' | 'credit' | 'flat' {
  if (signedBalance === 0) {
    return 'flat'
  }

  if (balanceDirection === 1) {
    return signedBalance > 0 ? 'debit' : 'credit'
  }

  return signedBalance > 0 ? 'credit' : 'debit'
}

function buildExactSubjectStats(
  subjects: SubjectRow[],
  openingBySubject: Map<string, InitialBalanceRow>,
  entries: LedgerEntryRow[],
  defaultStartPeriod: string,
  startDate: string,
  endDate: string
): Map<string, ExactSubjectStat> {
  const entriesBySubject = new Map<string, LedgerEntryRow[]>()

  for (const entry of entries) {
    const current = entriesBySubject.get(entry.subject_code) ?? []
    current.push(entry)
    entriesBySubject.set(entry.subject_code, current)
  }

  const stats = new Map<string, ExactSubjectStat>()
  for (const subject of subjects) {
    const subjectEntries = entriesBySubject.get(subject.code) ?? []
    const opening = openingBySubject.get(subject.code)
    const movementStartDate = getPeriodStartDate(opening?.period ?? defaultStartPeriod)

    let openingSigned = getSignedOpeningBalance(subject, opening)
    let periodDebit = 0
    let periodCredit = 0
    let periodSigned = 0

    for (const entry of subjectEntries) {
      if (entry.voucher_date < movementStartDate || entry.voucher_date > endDate) {
        continue
      }

      if (entry.voucher_date < startDate) {
        openingSigned += getSignedDelta(subject, entry)
        continue
      }

      periodDebit += entry.debit_amount
      periodCredit += entry.credit_amount
      periodSigned += getSignedDelta(subject, entry)
    }

    stats.set(subject.code, {
      openingSigned,
      periodDebit,
      periodCredit,
      endingSigned: openingSigned + periodSigned
    })
  }

  return stats
}

function buildBalanceRows(
  subjects: SubjectRow[],
  exactStats: Map<string, ExactSubjectStat>,
  includeZeroBalance: boolean
): SubjectBalanceRow[] {
  return subjects
    .map((subject) => {
      let openingSigned = 0
      let periodDebit = 0
      let periodCredit = 0
      let endingSigned = 0

      for (const candidate of subjects) {
        if (!matchesPrefix(candidate.code, subject.code)) {
          continue
        }

        const candidateStats = exactStats.get(candidate.code)
        if (!candidateStats) {
          continue
        }

        openingSigned += candidateStats.openingSigned
        periodDebit += candidateStats.periodDebit
        periodCredit += candidateStats.periodCredit
        endingSigned += candidateStats.endingSigned
      }

      const openingColumns = splitBalanceToColumns(subject.balance_direction, openingSigned)
      const endingColumns = splitBalanceToColumns(subject.balance_direction, endingSigned)

      return {
        subject_code: subject.code,
        subject_name: subject.name,
        category: subject.category,
        balance_direction: subject.balance_direction,
        level: subject.level,
        is_leaf: subject.is_leaf,
        opening_debit_amount: openingColumns.debit,
        opening_credit_amount: openingColumns.credit,
        period_debit_amount: periodDebit,
        period_credit_amount: periodCredit,
        ending_debit_amount: endingColumns.debit,
        ending_credit_amount: endingColumns.credit
      }
    })
    .filter((row) => {
      if (includeZeroBalance) {
        return true
      }

      return (
        row.opening_debit_amount !== 0 ||
        row.opening_credit_amount !== 0 ||
        row.period_debit_amount !== 0 ||
        row.period_credit_amount !== 0 ||
        row.ending_debit_amount !== 0 ||
        row.ending_credit_amount !== 0
      )
    })
}

export function listSubjectBalances(
  db: Database.Database,
  query: SubjectBalanceQuery
): SubjectBalanceRow[] {
  assertDate(query.startDate, '开始日期')
  assertDate(query.endDate, '结束日期')
  if (query.startDate > query.endDate) {
    throw new Error('开始日期不能晚于结束日期')
  }

  const ledger = getLedger(db, query.ledgerId)
  const subjects = listBookSubjects(db, query.ledgerId)
  const normalizedKeyword = query.keyword?.trim().toLowerCase() ?? ''
  const startPeriod = query.startDate.slice(0, 7)
  const effectiveStartPeriod = getEffectiveLedgerStartPeriod(ledger, startPeriod)
  const openingBySubject = listInitialBalances(db, query.ledgerId, startPeriod)
  const entries = listLedgerEntries(
    db,
    query.ledgerId,
    getPeriodStartDate(effectiveStartPeriod),
    query.endDate,
    query.includeUnpostedVouchers === true
  )
  const exactStats = buildExactSubjectStats(
    subjects,
    openingBySubject,
    entries,
    effectiveStartPeriod,
    query.startDate,
    query.endDate
  )

  const rows = buildBalanceRows(subjects, exactStats, query.includeZeroBalance === true)

  if (!normalizedKeyword) {
    return rows
  }

  return rows.filter((row) => {
    const haystack = `${row.subject_code} ${row.subject_name}`.toLowerCase()
    return haystack.includes(normalizedKeyword)
  })
}

export function getDetailLedger(
  db: Database.Database,
  query: DetailLedgerQuery
): DetailLedgerResult {
  assertDate(query.startDate, '开始日期')
  assertDate(query.endDate, '结束日期')
  if (query.startDate > query.endDate) {
    throw new Error('开始日期不能晚于结束日期')
  }

  const ledger = getLedger(db, query.ledgerId)
  const subjects = listBookSubjects(db, query.ledgerId)
  const subject = subjects.find((item) => item.code === query.subjectCode)

  if (!subject) {
    throw new Error('科目不存在')
  }

  const targetSubject = subject
  const startPeriod = query.startDate.slice(0, 7)
  const effectiveStartPeriod = getEffectiveLedgerStartPeriod(ledger, startPeriod)
  const openingBySubject = listInitialBalances(db, query.ledgerId, startPeriod)
  const subjectByCode = new Map(subjects.map((item) => [item.code, item]))
  const relevantSubjects = subjects.filter((item) => matchesPrefix(item.code, query.subjectCode))
  const relevantSubjectCodes = new Set(relevantSubjects.map((item) => item.code))
  const allEntries = listLedgerEntries(
    db,
    query.ledgerId,
    getPeriodStartDate(effectiveStartPeriod),
    query.endDate,
    query.includeUnpostedVouchers === true
  ).filter((entry) => relevantSubjectCodes.has(entry.subject_code))

  let openingSigned = relevantSubjects.reduce((total, item) => {
    const opening = openingBySubject.get(item.code)
    return total + getSignedOpeningBalance(item, opening)
  }, 0)
  const currentEntries: LedgerEntryRow[] = []

  for (const entry of allEntries) {
    const entrySubject = subjectByCode.get(entry.subject_code)
    if (!entrySubject) {
      continue
    }

    const entryOpening = openingBySubject.get(entry.subject_code)
    const movementStartDate = getPeriodStartDate(entryOpening?.period ?? effectiveStartPeriod)

    if (entry.voucher_date < movementStartDate) {
      continue
    }
    if (entry.voucher_date < query.startDate) {
      openingSigned += getSignedDelta(entrySubject, entry)
      continue
    }
    if (entry.voucher_date > query.endDate) {
      continue
    }
    currentEntries.push(entry)
  }

  const rows: DetailLedgerRow[] = [
    {
      row_type: 'opening',
      voucher_id: null,
      voucher_date: '',
      voucher_number: null,
      voucher_word: null,
      summary: '期初余额',
      debit_amount: 0,
      credit_amount: 0,
      balance_amount: Math.abs(openingSigned),
      balance_side: getBalanceSide(targetSubject.balance_direction, openingSigned)
    }
  ]

  let runningBalance = openingSigned
  for (const entry of currentEntries) {
    const entrySubject = subjectByCode.get(entry.subject_code)
    if (!entrySubject) {
      continue
    }

    runningBalance += getSignedDelta(entrySubject, entry)
    rows.push({
      row_type: 'entry',
      voucher_id: entry.voucher_id,
      voucher_date: entry.voucher_date,
      voucher_number: entry.voucher_number,
      voucher_word: entry.voucher_word,
      summary: entry.summary,
      debit_amount: entry.debit_amount,
      credit_amount: entry.credit_amount,
      balance_amount: Math.abs(runningBalance),
      balance_side: getBalanceSide(targetSubject.balance_direction, runningBalance)
    })
  }

  return {
    subject: {
      code: targetSubject.code,
      name: targetSubject.name,
      balance_direction: targetSubject.balance_direction
    },
    startDate: query.startDate,
    endDate: query.endDate,
    rows
  }
}

export function getJournal(db: Database.Database, query: JournalQuery): JournalRow[] {
  assertDate(query.startDate, 'startDate')
  assertDate(query.endDate, 'endDate')
  if (query.startDate > query.endDate) {
    throw new Error('startDate cannot be later than endDate')
  }

  getLedger(db, query.ledgerId)
  const subjects = listBookSubjects(db, query.ledgerId)
  const subjectNameByCode = new Map(subjects.map((item) => [item.code, item.name]))

  return listLedgerEntries(
    db,
    query.ledgerId,
    query.startDate,
    query.endDate,
    query.includeUnpostedVouchers === true
  )
    .filter((entry) =>
      isWithinSubjectCodeRange(entry.subject_code, query.subjectCodeStart, query.subjectCodeEnd)
    )
    .map((entry) => ({
      entry_id: entry.id,
      voucher_id: entry.voucher_id,
      voucher_date: entry.voucher_date,
      voucher_number: entry.voucher_number,
      voucher_word: entry.voucher_word,
      summary: entry.summary,
      subject_code: entry.subject_code,
      subject_name: subjectNameByCode.get(entry.subject_code) ?? entry.subject_code,
      debit_amount: entry.debit_amount,
      credit_amount: entry.credit_amount
    }))
}

export function getAuxiliaryBalances(
  db: Database.Database,
  query: AuxiliaryBalanceQuery
): AuxiliaryBalanceRow[] {
  assertDate(query.startDate, 'startDate')
  assertDate(query.endDate, 'endDate')
  if (query.startDate > query.endDate) {
    throw new Error('startDate cannot be later than endDate')
  }

  const ledger = getLedger(db, query.ledgerId)
  const subjects = listBookSubjects(db, query.ledgerId)
  const subjectByCode = new Map(subjects.map((item) => [item.code, item]))
  const effectiveStartPeriod = getEffectiveLedgerStartPeriod(ledger, query.startDate.slice(0, 7))
  const entries = listResolvedAuxiliaryLedgerEntries(
    db,
    query.ledgerId,
    getPeriodStartDate(effectiveStartPeriod),
    query.endDate,
    query.includeUnpostedVouchers === true
  ).filter((entry) =>
    isWithinSubjectCodeRange(entry.subject_code, query.subjectCodeStart, query.subjectCodeEnd)
  )

  const grouped = new Map<
    string,
    {
      subject: SubjectRow
      auxiliary: AuxiliaryItemRow
      openingSigned: number
      periodDebit: number
      periodCredit: number
      endingSigned: number
    }
  >()

  for (const entry of entries) {
    const subject = subjectByCode.get(entry.subject_code)
    if (!subject) {
      continue
    }

    const key = `${entry.subject_code}:${entry.auxiliary_item_id}`
    const current = grouped.get(key) ?? {
      subject,
      auxiliary: {
        id: entry.auxiliary_item_id,
        category: entry.auxiliary_category,
        code: entry.auxiliary_code,
        name: entry.auxiliary_name
      },
      openingSigned: 0,
      periodDebit: 0,
      periodCredit: 0,
      endingSigned: 0
    }

    const delta = getSignedDelta(subject, entry)
    if (entry.voucher_date < query.startDate) {
      current.openingSigned += delta
      current.endingSigned += delta
      grouped.set(key, current)
      continue
    }

    current.periodDebit += entry.debit_amount
    current.periodCredit += entry.credit_amount
    current.endingSigned += delta
    grouped.set(key, current)
  }

  return Array.from(grouped.values())
    .map((item) => {
      const openingColumns = splitBalanceToColumns(
        item.subject.balance_direction,
        item.openingSigned
      )
      const endingColumns = splitBalanceToColumns(item.subject.balance_direction, item.endingSigned)

      return {
        subject_code: item.subject.code,
        subject_name: item.subject.name,
        auxiliary_item_id: item.auxiliary.id,
        auxiliary_category: item.auxiliary.category,
        auxiliary_code: item.auxiliary.code,
        auxiliary_name: item.auxiliary.name,
        opening_debit_amount: openingColumns.debit,
        opening_credit_amount: openingColumns.credit,
        period_debit_amount: item.periodDebit,
        period_credit_amount: item.periodCredit,
        ending_debit_amount: endingColumns.debit,
        ending_credit_amount: endingColumns.credit
      }
    })
    .sort((left, right) => {
      if (left.subject_code !== right.subject_code) {
        return left.subject_code.localeCompare(right.subject_code)
      }
      return left.auxiliary_code.localeCompare(right.auxiliary_code)
    })
}

export function getAuxiliaryDetail(
  db: Database.Database,
  query: AuxiliaryDetailQuery
): AuxiliaryDetailResult {
  assertDate(query.startDate, 'startDate')
  assertDate(query.endDate, 'endDate')
  if (query.startDate > query.endDate) {
    throw new Error('startDate cannot be later than endDate')
  }

  const ledger = getLedger(db, query.ledgerId)
  const subjects = listBookSubjects(db, query.ledgerId)
  const subject = subjects.find((item) => item.code === query.subjectCode)

  if (!subject) {
    throw new Error('subject not found')
  }

  const targetSubject = subject
  const subjectByCode = new Map(subjects.map((item) => [item.code, item]))
  const relevantSubjectCodes = new Set(
    subjects.filter((item) => matchesPrefix(item.code, query.subjectCode)).map((item) => item.code)
  )
  const startPeriod = query.startDate.slice(0, 7)
  const effectiveStartPeriod = getEffectiveLedgerStartPeriod(ledger, startPeriod)
  const auxiliaryItem = getAuxiliaryItem(db, query.ledgerId, query.auxiliaryItemId)
  const entries = listResolvedAuxiliaryLedgerEntries(
    db,
    query.ledgerId,
    getPeriodStartDate(effectiveStartPeriod),
    query.endDate,
    query.includeUnpostedVouchers === true
  ).filter(
    (entry) =>
      relevantSubjectCodes.has(entry.subject_code) &&
      entry.auxiliary_item_id === query.auxiliaryItemId
  )

  let openingSigned = 0
  const currentEntries: AuxiliaryLedgerEntryRow[] = []

  for (const entry of entries) {
    const entrySubject = subjectByCode.get(entry.subject_code)
    if (!entrySubject) {
      continue
    }

    if (entry.voucher_date < query.startDate) {
      openingSigned += getSignedDelta(entrySubject, entry)
      continue
    }
    if (entry.voucher_date > query.endDate) {
      continue
    }
    currentEntries.push(entry)
  }

  const rows: AuxiliaryDetailRow[] = [
    {
      row_type: 'opening',
      voucher_id: null,
      voucher_date: '',
      voucher_number: null,
      voucher_word: null,
      summary: '期初余额',
      debit_amount: 0,
      credit_amount: 0,
      balance_amount: Math.abs(openingSigned),
      balance_side: getBalanceSide(targetSubject.balance_direction, openingSigned)
    }
  ]

  let runningBalance = openingSigned
  for (const entry of currentEntries) {
    const entrySubject = subjectByCode.get(entry.subject_code)
    if (!entrySubject) {
      continue
    }

    runningBalance += getSignedDelta(entrySubject, entry)
    rows.push({
      row_type: 'entry',
      voucher_id: entry.voucher_id,
      voucher_date: entry.voucher_date,
      voucher_number: entry.voucher_number,
      voucher_word: entry.voucher_word,
      summary: entry.summary,
      debit_amount: entry.debit_amount,
      credit_amount: entry.credit_amount,
      balance_amount: Math.abs(runningBalance),
      balance_side: getBalanceSide(targetSubject.balance_direction, runningBalance)
    })
  }

  return {
    subject: {
      code: targetSubject.code,
      name: targetSubject.name,
      balance_direction: targetSubject.balance_direction
    },
    auxiliary: {
      id: auxiliaryItem.id,
      category: auxiliaryItem.category,
      code: auxiliaryItem.code,
      name: auxiliaryItem.name
    },
    startDate: query.startDate,
    endDate: query.endDate,
    rows
  }
}

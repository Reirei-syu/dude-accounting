import type Database from 'better-sqlite3'

export type LedgerRow = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
}

export type SubjectRow = {
  code: string
  name: string
  category: string
  balance_direction: number
  level: number
  is_leaf: 0 | 1
}

export type InitialBalanceRow = {
  subject_code: string
  period: string
  debit_amount: number
  credit_amount: number
}

export type AuxiliaryItemRow = {
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

export type LedgerEntryRow = {
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

export type AuxiliaryLedgerEntryRow = LedgerEntryRow & {
  auxiliary_item_id: number
  auxiliary_category: string
  auxiliary_code: string
  auxiliary_name: string
}

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

export function getPeriodStartDate(period: string): string {
  assertPeriod(period)
  return `${period}-01`
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

export function listBookSubjects(db: Database.Database, ledgerId: number): SubjectRow[] {
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

export function listLedgerEntries(
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

export function listResolvedAuxiliaryLedgerEntries(
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

export function getAuxiliaryItem(
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

import type Database from 'better-sqlite3'

export interface VoucherNumberRow {
  id: number
  ledgerId: number
  period: string
  voucherDate: string
  voucherNumber: number
  voucherWord: string
  status: number
  deletedFromStatus: number | null
}

export interface VoucherNumberChange {
  voucherId: number
  voucherWord: string
  status: number
  deletedFromStatus: number | null
  oldNumber: number
  newNumber: number
}

export interface VoucherNumberGroupResult {
  voucherWord: string
  totalCount: number
  activeCount: number
  deletedCount: number
  updatedCount: number
  firstNumber: number | null
  lastNumber: number | null
}

export interface VoucherNumberRenumberResult {
  ledgerId: number
  period: string
  totalCount: number
  updatedCount: number
  groups: VoucherNumberGroupResult[]
  changes: VoucherNumberChange[]
}

interface VoucherNumberAssignment extends VoucherNumberChange {
  temporaryNumber: number
}

interface VoucherNumberRenumberPlan extends VoucherNumberRenumberResult {
  assignments: VoucherNumberAssignment[]
}

export class VoucherNumberRenumberValidationError extends Error {
  details: Record<string, unknown> | null

  constructor(message: string, details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'VoucherNumberRenumberValidationError'
    this.details = details
  }
}

const VOUCHER_WORD_PRIORITY: Record<string, number> = {
  记: 0,
  结: 1
}

function getVoucherWordPriority(voucherWord: string): number {
  return VOUCHER_WORD_PRIORITY[voucherWord] ?? 9
}

function compareVoucherWords(left: string, right: string): number {
  const priorityDelta = getVoucherWordPriority(left) - getVoucherWordPriority(right)
  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return left.localeCompare(right)
}

function compareRowsByNumberDateId(left: VoucherNumberRow, right: VoucherNumberRow): number {
  if (left.voucherNumber !== right.voucherNumber) {
    return left.voucherNumber - right.voucherNumber
  }

  if (left.voucherDate !== right.voucherDate) {
    return left.voucherDate.localeCompare(right.voucherDate)
  }

  return left.id - right.id
}

function toPublicResult(plan: VoucherNumberRenumberPlan): VoucherNumberRenumberResult {
  return {
    ledgerId: plan.ledgerId,
    period: plan.period,
    totalCount: plan.totalCount,
    updatedCount: plan.updatedCount,
    groups: plan.groups,
    changes: plan.changes
  }
}

export function listVoucherNumberRows(
  db: Database.Database,
  ledgerId: number,
  period: string
): VoucherNumberRow[] {
  const rows = db
    .prepare(
      `SELECT
         id,
         ledger_id,
         period,
         voucher_date,
         voucher_number,
         voucher_word,
         status,
         deleted_from_status
       FROM vouchers
       WHERE ledger_id = ? AND period = ? AND status IN (0, 1, 2, 3)
       ORDER BY voucher_word ASC, voucher_number ASC, voucher_date ASC, id ASC`
    )
    .all(ledgerId, period) as Array<{
    id: number
    ledger_id: number
    period: string
    voucher_date: string
    voucher_number: number
    voucher_word: string
    status: number
    deleted_from_status: number | null
  }>

  return rows.map((row) => ({
    id: row.id,
    ledgerId: row.ledger_id,
    period: row.period,
    voucherDate: row.voucher_date,
    voucherNumber: row.voucher_number,
    voucherWord: row.voucher_word,
    status: row.status,
    deletedFromStatus: row.deleted_from_status
  }))
}

export function assertVoucherNumberRenumberAllowed(rows: VoucherNumberRow[]): void {
  const postedVoucher = rows.find((row) => row.status === 2)
  if (postedVoucher) {
    throw new VoucherNumberRenumberValidationError('存在已记账凭证，不允许整理凭证号', {
      voucherId: postedVoucher.id,
      voucherWord: postedVoucher.voucherWord,
      voucherNumber: postedVoucher.voucherNumber
    })
  }

  const deletedPostedVoucher = rows.find(
    (row) => row.status === 3 && row.deletedFromStatus === 2
  )
  if (deletedPostedVoucher) {
    throw new VoucherNumberRenumberValidationError(
      '存在历史已记账的删除态凭证，不允许整理凭证号',
      {
        voucherId: deletedPostedVoucher.id,
        voucherWord: deletedPostedVoucher.voucherWord,
        voucherNumber: deletedPostedVoucher.voucherNumber
      }
    )
  }
}

export function buildVoucherNumberRenumberPlan(
  ledgerId: number,
  period: string,
  rows: VoucherNumberRow[]
): VoucherNumberRenumberPlan {
  assertVoucherNumberRenumberAllowed(rows)

  const voucherWords = Array.from(new Set(rows.map((row) => row.voucherWord))).sort(
    compareVoucherWords
  )
  const groups: VoucherNumberGroupResult[] = []
  const assignments: VoucherNumberAssignment[] = []
  let tempIndex = 1

  for (const voucherWord of voucherWords) {
    const groupRows = rows.filter((row) => row.voucherWord === voucherWord)
    const activeRows = groupRows
      .filter((row) => row.status === 0 || row.status === 1)
      .sort(compareRowsByNumberDateId)
    const deletedRows = groupRows.filter((row) => row.status === 3).sort(compareRowsByNumberDateId)
    const groupChanges: VoucherNumberChange[] = []

    for (const [index, row] of activeRows.entries()) {
      const newNumber = index + 1
      const assignment: VoucherNumberAssignment = {
        voucherId: row.id,
        voucherWord: row.voucherWord,
        status: row.status,
        deletedFromStatus: row.deletedFromStatus,
        oldNumber: row.voucherNumber,
        newNumber,
        temporaryNumber: -1_000_000_000 - tempIndex
      }
      tempIndex += 1
      assignments.push(assignment)

      if (row.voucherNumber !== newNumber) {
        groupChanges.push({
          voucherId: assignment.voucherId,
          voucherWord: assignment.voucherWord,
          status: assignment.status,
          deletedFromStatus: assignment.deletedFromStatus,
          oldNumber: assignment.oldNumber,
          newNumber: assignment.newNumber
        })
      }
    }

    groups.push({
      voucherWord,
      totalCount: activeRows.length + deletedRows.length,
      activeCount: activeRows.length,
      deletedCount: deletedRows.length,
      updatedCount: groupChanges.length,
      firstNumber: activeRows.length > 0 ? 1 : null,
      lastNumber: activeRows.length > 0 ? activeRows.length : null
    })
  }

  const changes = groups.flatMap((group) =>
    assignments
      .filter(
        (assignment) =>
          assignment.voucherWord === group.voucherWord &&
          assignment.oldNumber !== assignment.newNumber
      )
      .map((assignment) => ({
        voucherId: assignment.voucherId,
        voucherWord: assignment.voucherWord,
        status: assignment.status,
        deletedFromStatus: assignment.deletedFromStatus,
        oldNumber: assignment.oldNumber,
        newNumber: assignment.newNumber
      }))
  )

  return {
    ledgerId,
    period,
    totalCount: assignments.filter((assignment) => assignment.status !== 3).length,
    updatedCount: changes.length,
    groups,
    changes,
    assignments
  }
}

export function applyVoucherNumberRenumberPlan(
  db: Database.Database,
  plan: VoucherNumberRenumberPlan
): void {
  if (plan.updatedCount === 0) {
    return
  }

  const runTx = db.transaction(() => {
    const updateStmt = db.prepare(
      `UPDATE vouchers
         SET voucher_number = ?, updated_at = datetime('now')
       WHERE id = ?`
    )

    for (const assignment of plan.assignments) {
      updateStmt.run(assignment.temporaryNumber, assignment.voucherId)
    }

    for (const assignment of plan.assignments) {
      updateStmt.run(assignment.newNumber, assignment.voucherId)
    }
  })

  runTx()
}

export function renumberVoucherNumbers(
  db: Database.Database,
  ledgerId: number,
  period: string
): VoucherNumberRenumberResult {
  const rows = listVoucherNumberRows(db, ledgerId, period)
  const plan = buildVoucherNumberRenumberPlan(ledgerId, period, rows)
  applyVoucherNumberRenumberPlan(db, plan)
  return toPublicResult(plan)
}

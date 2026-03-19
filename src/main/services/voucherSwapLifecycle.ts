import type Database from 'better-sqlite3'

export interface VoucherSwapVoucher {
  id: number
  ledgerId: number
  period: string
  voucherDate: string
  status: number
  creatorId: number | null
  auditorId: number | null
  bookkeeperId: number | null
  attachmentCount: number
  isCarryForward: number
}

export interface VoucherSwapEntry {
  rowOrder: number
  summary: string
  subjectCode: string
  debitAmount: number
  creditAmount: number
  auxiliaryItemId: number | null
  cashFlowItemId: number | null
}

export interface VoucherSwapVoucherUpdate {
  voucherDate: string
  status: number
  creatorId: number | null
  auditorId: number | null
  bookkeeperId: number | null
  attachmentCount: number
  isCarryForward: number
}

export interface VoucherSwapPlan {
  firstVoucherId: number
  secondVoucherId: number
  firstVoucherUpdate: VoucherSwapVoucherUpdate
  secondVoucherUpdate: VoucherSwapVoucherUpdate
  firstVoucherEntries: VoucherSwapEntry[]
  secondVoucherEntries: VoucherSwapEntry[]
}

const cloneEntry = (entry: VoucherSwapEntry): VoucherSwapEntry => ({ ...entry })

const buildVoucherUpdate = (voucher: VoucherSwapVoucher): VoucherSwapVoucherUpdate => ({
  voucherDate: voucher.voucherDate,
  status: voucher.status,
  creatorId: voucher.creatorId,
  auditorId: voucher.auditorId,
  bookkeeperId: voucher.bookkeeperId,
  attachmentCount: voucher.attachmentCount,
  isCarryForward: voucher.isCarryForward
})

export function buildVoucherSwapPlan(
  firstVoucher: VoucherSwapVoucher,
  secondVoucher: VoucherSwapVoucher,
  firstEntries: VoucherSwapEntry[],
  secondEntries: VoucherSwapEntry[]
): VoucherSwapPlan {
  return {
    firstVoucherId: firstVoucher.id,
    secondVoucherId: secondVoucher.id,
    firstVoucherUpdate: buildVoucherUpdate(secondVoucher),
    secondVoucherUpdate: buildVoucherUpdate(firstVoucher),
    firstVoucherEntries: secondEntries.map(cloneEntry),
    secondVoucherEntries: firstEntries.map(cloneEntry)
  }
}

export function listVoucherSwapVouchers(
  db: Database.Database,
  voucherIds: number[]
): VoucherSwapVoucher[] {
  if (voucherIds.length === 0) {
    return []
  }

  const placeholders = voucherIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT
         id,
         ledger_id,
         period,
         voucher_date,
         status,
         creator_id,
         auditor_id,
         bookkeeper_id,
         attachment_count,
         is_carry_forward
       FROM vouchers
       WHERE id IN (${placeholders})`
    )
    .all(...voucherIds)
    .map((voucher) => {
      const typedVoucher = voucher as {
        id: number
        ledger_id: number
        period: string
        voucher_date: string
        status: number
        creator_id: number | null
        auditor_id: number | null
        bookkeeper_id: number | null
        attachment_count: number
        is_carry_forward: number
      }

      return {
        id: typedVoucher.id,
        ledgerId: typedVoucher.ledger_id,
        period: typedVoucher.period,
        voucherDate: typedVoucher.voucher_date,
        status: typedVoucher.status,
        creatorId: typedVoucher.creator_id,
        auditorId: typedVoucher.auditor_id,
        bookkeeperId: typedVoucher.bookkeeper_id,
        attachmentCount: typedVoucher.attachment_count,
        isCarryForward: typedVoucher.is_carry_forward
      }
    })
}

export function listVoucherSwapEntriesByVoucherId(
  db: Database.Database,
  voucherIds: number[]
): Map<number, VoucherSwapEntry[]> {
  const grouped = new Map<number, VoucherSwapEntry[]>()

  if (voucherIds.length === 0) {
    return grouped
  }

  const placeholders = voucherIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT
         voucher_id,
         row_order,
         summary,
         subject_code,
         debit_amount,
         credit_amount,
         auxiliary_item_id,
         cash_flow_item_id
       FROM voucher_entries
       WHERE voucher_id IN (${placeholders})
       ORDER BY voucher_id ASC, row_order ASC, id ASC`
    )
    .all(...voucherIds) as Array<{
    voucher_id: number
    row_order: number
    summary: string
    subject_code: string
    debit_amount: number
    credit_amount: number
    auxiliary_item_id: number | null
    cash_flow_item_id: number | null
  }>

  for (const row of rows) {
    const entries = grouped.get(row.voucher_id) ?? []
    entries.push({
      rowOrder: row.row_order,
      summary: row.summary,
      subjectCode: row.subject_code,
      debitAmount: row.debit_amount,
      creditAmount: row.credit_amount,
      auxiliaryItemId: row.auxiliary_item_id,
      cashFlowItemId: row.cash_flow_item_id
    })
    grouped.set(row.voucher_id, entries)
  }

  return grouped
}

export function applyVoucherSwapPlan(db: Database.Database, plan: VoucherSwapPlan): void {
  const updateVoucherStmt = db.prepare(
    `UPDATE vouchers
     SET voucher_date = ?,
         status = ?,
         creator_id = ?,
         auditor_id = ?,
         bookkeeper_id = ?,
         attachment_count = ?,
         is_carry_forward = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  )
  const deleteEntriesStmt = db.prepare('DELETE FROM voucher_entries WHERE voucher_id = ?')
  const insertEntryStmt = db.prepare(
    `INSERT INTO voucher_entries (
       voucher_id,
       row_order,
       summary,
       subject_code,
       debit_amount,
       credit_amount,
       auxiliary_item_id,
       cash_flow_item_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const swapTx = db.transaction(() => {
    updateVoucherStmt.run(
      plan.firstVoucherUpdate.voucherDate,
      plan.firstVoucherUpdate.status,
      plan.firstVoucherUpdate.creatorId,
      plan.firstVoucherUpdate.auditorId,
      plan.firstVoucherUpdate.bookkeeperId,
      plan.firstVoucherUpdate.attachmentCount,
      plan.firstVoucherUpdate.isCarryForward,
      plan.firstVoucherId
    )
    updateVoucherStmt.run(
      plan.secondVoucherUpdate.voucherDate,
      plan.secondVoucherUpdate.status,
      plan.secondVoucherUpdate.creatorId,
      plan.secondVoucherUpdate.auditorId,
      plan.secondVoucherUpdate.bookkeeperId,
      plan.secondVoucherUpdate.attachmentCount,
      plan.secondVoucherUpdate.isCarryForward,
      plan.secondVoucherId
    )

    deleteEntriesStmt.run(plan.firstVoucherId)
    deleteEntriesStmt.run(plan.secondVoucherId)

    for (const entry of plan.firstVoucherEntries) {
      insertEntryStmt.run(
        plan.firstVoucherId,
        entry.rowOrder,
        entry.summary,
        entry.subjectCode,
        entry.debitAmount,
        entry.creditAmount,
        entry.auxiliaryItemId,
        entry.cashFlowItemId
      )
    }

    for (const entry of plan.secondVoucherEntries) {
      insertEntryStmt.run(
        plan.secondVoucherId,
        entry.rowOrder,
        entry.summary,
        entry.subjectCode,
        entry.debitAmount,
        entry.creditAmount,
        entry.auxiliaryItemId,
        entry.cashFlowItemId
      )
    }
  })

  swapTx()
}

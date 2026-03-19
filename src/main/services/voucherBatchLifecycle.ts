import type Database from 'better-sqlite3'
import type { EmergencyReversalPayload } from './voucherControl'

export type VoucherBatchAction =
  | 'audit'
  | 'bookkeep'
  | 'unbookkeep'
  | 'unaudit'
  | 'delete'
  | 'restoreDelete'
  | 'purgeDelete'

export interface VoucherBatchTarget {
  id: number
  status: number
  deleted_from_status: number | null
  ledger_id: number
  period: string
  voucher_word: string
  auditor_id: number | null
  bookkeeper_id: number | null
}

export function isVoucherEligibleForBatchAction(
  action: VoucherBatchAction,
  status: number
): boolean {
  switch (action) {
    case 'audit':
      return status === 0
    case 'bookkeep':
      return status === 1
    case 'unbookkeep':
      return status === 2
    case 'unaudit':
      return status === 1
    case 'delete':
      return status === 0 || status === 1
    case 'restoreDelete':
      return status === 3
    case 'purgeDelete':
      return status === 3
    default:
      return false
  }
}

export function splitVouchersByBatchAction<T extends { status: number }>(
  action: VoucherBatchAction,
  vouchers: T[]
): { applicable: T[]; skipped: T[] } {
  const applicable: T[] = []
  const skipped: T[] = []

  for (const voucher of vouchers) {
    if (isVoucherEligibleForBatchAction(action, voucher.status)) {
      applicable.push(voucher)
    } else {
      skipped.push(voucher)
    }
  }

  return { applicable, skipped }
}

export function listVoucherBatchTargets(
  db: Database.Database,
  voucherIds: number[]
): VoucherBatchTarget[] {
  if (voucherIds.length === 0) {
    return []
  }

  const placeholders = voucherIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT
         id,
         status,
         deleted_from_status,
         ledger_id,
         period,
         voucher_word,
         auditor_id,
         bookkeeper_id
       FROM vouchers
       WHERE id IN (${placeholders})`
    )
    .all(...voucherIds) as VoucherBatchTarget[]
}

export function applyVoucherBatchAction(
  db: Database.Database,
  action: VoucherBatchAction,
  vouchers: VoucherBatchTarget[],
  operatorUserId: number,
  emergencyReversal: EmergencyReversalPayload | null
): { applicable: VoucherBatchTarget[]; skipped: VoucherBatchTarget[] } {
  const { applicable, skipped } = splitVouchersByBatchAction(action, vouchers)

  const runTx = db.transaction(() => {
    for (const voucher of applicable) {
      if (action === 'audit') {
        db.prepare(
          `UPDATE vouchers
             SET status = 1, auditor_id = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(operatorUserId, voucher.id)
      } else if (action === 'bookkeep') {
        db.prepare(
          `UPDATE vouchers
             SET status = 2,
                 bookkeeper_id = ?,
                 posted_at = datetime('now'),
                 updated_at = datetime('now')
           WHERE id = ?`
        ).run(operatorUserId, voucher.id)
      } else if (action === 'unbookkeep') {
        db.prepare(
          `UPDATE vouchers
             SET status = 1,
                 bookkeeper_id = NULL,
                 emergency_reversal_reason = ?,
                 emergency_reversal_by = ?,
                 emergency_reversal_at = datetime('now'),
                 reversal_approval_tag = ?,
                 updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          emergencyReversal?.reason ?? null,
          operatorUserId,
          emergencyReversal?.approvalTag ?? null,
          voucher.id
        )
      } else if (action === 'unaudit') {
        db.prepare(
          `UPDATE vouchers
             SET status = 0, auditor_id = NULL, updated_at = datetime('now')
           WHERE id = ?`
        ).run(voucher.id)
      } else if (action === 'delete') {
        db.prepare(
          `UPDATE vouchers
             SET status = 3, deleted_from_status = status, updated_at = datetime('now')
           WHERE id = ?`
        ).run(voucher.id)
      } else if (action === 'restoreDelete') {
        const restoredStatus = voucher.deleted_from_status ?? 0
        if (restoredStatus === 0) {
          db.prepare(
            `UPDATE vouchers
               SET status = 0,
                   deleted_from_status = NULL,
                   auditor_id = NULL,
                   bookkeeper_id = NULL,
                   updated_at = datetime('now')
             WHERE id = ?`
          ).run(voucher.id)
        } else if (restoredStatus === 1) {
          db.prepare(
            `UPDATE vouchers
               SET status = 1,
                   deleted_from_status = NULL,
                   bookkeeper_id = NULL,
                   updated_at = datetime('now')
             WHERE id = ?`
          ).run(voucher.id)
        } else {
          db.prepare(
            `UPDATE vouchers
               SET status = ?,
                   deleted_from_status = NULL,
                   updated_at = datetime('now')
             WHERE id = ?`
          ).run(restoredStatus, voucher.id)
        }
      } else if (action === 'purgeDelete') {
        db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucher.id)
      }
    }
  })

  runTx()

  return { applicable, skipped }
}

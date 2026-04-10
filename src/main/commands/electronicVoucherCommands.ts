import fs from 'node:fs'
import path from 'node:path'
import {
  buildElectronicVoucherFingerprint,
  importElectronicVoucher
} from '../services/electronicVoucher'
import {
  requireCommandLedgerAccess,
  requireCommandPermission
} from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function getElectronicVoucherRootDir(context: CommandContext): string {
  return path.join(context.runtime.userDataPath, 'electronic-vouchers')
}

export async function importElectronicVoucherCommand(
  context: CommandContext,
  payload: {
    ledgerId: number
    sourcePath: string
    sourceNumber?: string | null
    sourceDate?: string | null
    amountCents?: number | null
  }
): Promise<
  CommandResult<{ fileId: number; recordId: number; voucherType: string; fingerprint: string }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    if (!fs.existsSync(payload.sourcePath)) {
      throw new CommandError('NOT_FOUND', '电子凭证源文件不存在', { sourcePath: payload.sourcePath }, 5)
    }
    const ledger = context.db
      .prepare('SELECT id FROM ledgers WHERE id = ?')
      .get(payload.ledgerId) as { id: number } | undefined
    if (!ledger) {
      throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId: payload.ledgerId }, 5)
    }
    const ledgerDir = path.join(getElectronicVoucherRootDir(context), `ledger-${payload.ledgerId}`)
    const imported = importElectronicVoucher(context.db, {
      ledgerId: payload.ledgerId,
      sourcePath: payload.sourcePath,
      storageDir: ledgerDir,
      importedBy: actor.id,
      sourceNumber: payload.sourceNumber ?? null,
      sourceDate: payload.sourceDate ?? null,
      amountCents: payload.amountCents ?? null
    })
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: payload.ledgerId,
        module: 'electronic_voucher',
        action: 'import',
        targetType: 'electronic_voucher_record',
        targetId: imported.recordId,
        details: {
          sourcePath: payload.sourcePath,
          storedPath: imported.storedPath,
          voucherType: imported.voucherType
        }
      }
    )
    return {
      fileId: imported.fileId,
      recordId: imported.recordId,
      voucherType: imported.voucherType,
      fingerprint: imported.fingerprint
    }
  })
}

export async function listElectronicVouchersCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<unknown[]>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return context.db
      .prepare(
        `SELECT
           r.*,
           f.original_name,
           f.stored_path,
           f.sha256,
           f.file_size,
           (
             SELECT verification_status
             FROM electronic_voucher_verifications v
             WHERE v.record_id = r.id
             ORDER BY v.id DESC
             LIMIT 1
           ) AS latest_verification_status
         FROM electronic_voucher_records r
         INNER JOIN electronic_voucher_files f ON f.id = r.file_id
         WHERE r.ledger_id = ?
         ORDER BY r.id DESC`
      )
      .all(payload.ledgerId) as unknown[]
  })
}

export async function verifyElectronicVoucherCommand(
  context: CommandContext,
  payload: {
    recordId: number
    verificationStatus?: 'verified' | 'failed'
    verificationMethod?: string
    verificationMessage?: string
  }
): Promise<CommandResult<{ verificationStatus: 'verified' | 'failed' }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const record = context.db
      .prepare('SELECT id, ledger_id, voucher_type FROM electronic_voucher_records WHERE id = ?')
      .get(payload.recordId) as
      | { id: number; ledger_id: number; voucher_type: string }
      | undefined
    if (!record) {
      throw new CommandError('NOT_FOUND', '电子凭证记录不存在', { recordId: payload.recordId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, record.ledger_id)

    const verificationStatus =
      payload.verificationStatus ?? (record.voucher_type === 'unknown' ? 'failed' : 'verified')
    context.db
      .prepare(
        `INSERT INTO electronic_voucher_verifications (
           record_id,
           verification_status,
           verification_method,
           verification_message,
           verified_at
         ) VALUES (?, ?, ?, ?, CASE WHEN ? = 'verified' THEN datetime('now') ELSE NULL END)`
      )
      .run(
        payload.recordId,
        verificationStatus,
        payload.verificationMethod ?? 'manual',
        payload.verificationMessage ?? (verificationStatus === 'verified' ? '校验通过' : '校验失败'),
        verificationStatus
      )
    context.db
      .prepare(
        `UPDATE electronic_voucher_records
         SET status = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(verificationStatus === 'verified' ? 'verified' : 'rejected', payload.recordId)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: record.ledger_id,
        module: 'electronic_voucher',
        action: 'verify',
        targetType: 'electronic_voucher_record',
        targetId: payload.recordId,
        details: {
          verificationStatus,
          verificationMethod: payload.verificationMethod ?? 'manual'
        }
      }
    )
    return { verificationStatus }
  })
}

export async function parseElectronicVoucherCommand(
  context: CommandContext,
  payload: {
    recordId: number
    sourceNumber?: string | null
    sourceDate?: string | null
    amountCents?: number | null
    counterpartName?: string | null
  }
): Promise<CommandResult<{ structuredData: Record<string, unknown> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const record = context.db
      .prepare(
        `SELECT
           r.*,
           f.sha256,
           f.original_name
         FROM electronic_voucher_records r
         INNER JOIN electronic_voucher_files f ON f.id = r.file_id
         WHERE r.id = ?`
      )
      .get(payload.recordId) as
      | {
          id: number
          ledger_id: number
          voucher_type: 'digital_invoice' | 'bank_receipt' | 'bank_statement' | 'unknown'
          sha256: string
          original_name: string
        }
      | undefined
    if (!record) {
      throw new CommandError('NOT_FOUND', '电子凭证记录不存在', { recordId: payload.recordId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, record.ledger_id)
    const fingerprint = buildElectronicVoucherFingerprint({
      sha256: record.sha256,
      type: record.voucher_type,
      sourceNumber: payload.sourceNumber ?? null,
      sourceDate: payload.sourceDate ?? null,
      amountCents: payload.amountCents ?? null
    })
    const duplicate = context.db
      .prepare(
        `SELECT id
         FROM electronic_voucher_records
         WHERE ledger_id = ? AND fingerprint = ? AND id <> ?
         LIMIT 1`
      )
      .get(record.ledger_id, fingerprint, payload.recordId) as { id: number } | undefined
    if (duplicate) {
      throw new CommandError('CONFLICT', '解析结果与已有电子凭证重复，已阻止更新', null, 6)
    }
    context.db
      .prepare(
        `UPDATE electronic_voucher_records
         SET source_number = ?,
             source_date = ?,
             amount_cents = ?,
             counterpart_name = ?,
             fingerprint = ?,
             status = 'parsed',
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        payload.sourceNumber ?? null,
        payload.sourceDate ?? null,
        payload.amountCents ?? null,
        payload.counterpartName ?? null,
        fingerprint,
        payload.recordId
      )
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: record.ledger_id,
        module: 'electronic_voucher',
        action: 'parse',
        targetType: 'electronic_voucher_record',
        targetId: payload.recordId,
        details: {
          sourceNumber: payload.sourceNumber ?? null,
          sourceDate: payload.sourceDate ?? null,
          amountCents: payload.amountCents ?? null
        }
      }
    )
    return {
      structuredData: {
        sourceNumber: payload.sourceNumber ?? null,
        sourceDate: payload.sourceDate ?? null,
        amountCents: payload.amountCents ?? null,
        counterpartName: payload.counterpartName ?? null,
        originalName: record.original_name
      }
    }
  })
}

export async function convertElectronicVoucherCommand(
  context: CommandContext,
  payload: { recordId: number; voucherDate?: string; voucherWord?: string }
): Promise<CommandResult<{ draftVoucher: Record<string, unknown> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const record = context.db
      .prepare(
        `SELECT
           r.*,
           f.original_name
         FROM electronic_voucher_records r
         INNER JOIN electronic_voucher_files f ON f.id = r.file_id
         WHERE r.id = ?`
      )
      .get(payload.recordId) as
      | {
          id: number
          ledger_id: number
          source_number: string | null
          source_date: string | null
          counterpart_name: string | null
          amount_cents: number | null
          original_name: string
        }
      | undefined
    if (!record) {
      throw new CommandError('NOT_FOUND', '电子凭证记录不存在', { recordId: payload.recordId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, record.ledger_id)
    const draftVoucher = {
      ledgerId: record.ledger_id,
      voucherDate: payload.voucherDate ?? record.source_date ?? new Date().toISOString().slice(0, 10),
      voucherWord: payload.voucherWord ?? '记',
      summary: record.source_number?.trim() || record.counterpart_name?.trim() || record.original_name,
      sourceRecordId: record.id,
      entries: [] as Array<{
        summary: string
        subjectCode: string
        debitAmount: string
        creditAmount: string
        cashFlowItemId: number | null
      }>
    }
    context.db
      .prepare(
        `UPDATE electronic_voucher_records
         SET status = 'converted', updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(payload.recordId)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: record.ledger_id,
        module: 'electronic_voucher',
        action: 'convert',
        targetType: 'electronic_voucher_record',
        targetId: payload.recordId,
        details: {
          voucherDate: draftVoucher.voucherDate
        }
      }
    )
    return { draftVoucher }
  })
}

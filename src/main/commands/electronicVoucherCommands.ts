import fs from 'node:fs'
import type { IpcResult } from '../../shared/contracts/ipc'
import type { ElectronicVoucherListRow } from '../../shared/contracts/electronicVoucher'
import { fileOperationCommandError } from './fileOperationError'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveSessionActor } from '../security/sessionAuthority'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { FileOperationLifecycle } from '../services/fileOperationLifecycle'
import {
  fileOperationArtifactRecovery,
  prepareFileOperationArtifact
} from '../services/fileOperationArtifact'
import {
  buildElectronicVoucherFingerprint,
  buildImportedVoucherMetadata,
  persistImportedElectronicVoucher
} from '../services/electronicVoucher'
import type { ImportElectronicVoucherResult } from '../services/electronicVoucher'
import { requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import { withAuditedCommandResult } from './auditedResult'
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
    operationId?: string
    sourceNumber?: string | null
    sourceDate?: string | null
    amountCents?: number | null
  }
): Promise<
  CommandResult<{
    operationId: string
    fileId: number
    recordId: number
    voucherType: ImportElectronicVoucherResult['voucherType']
    fingerprint: string
  }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    if (!fs.existsSync(payload.sourcePath)) {
      throw new CommandError(
        'NOT_FOUND',
        '电子凭证源文件不存在',
        { sourcePath: payload.sourcePath },
        5
      )
    }
    const ledger = context.db
      .prepare('SELECT id FROM ledgers WHERE id = ?')
      .get(payload.ledgerId) as { id: number } | undefined
    if (!ledger) {
      throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId: payload.ledgerId }, 5)
    }
    const ledgerDir = path.join(getElectronicVoucherRootDir(context), `ledger-${payload.ledgerId}`)
    const operationId = requireOperationId(payload.operationId)
    const metadata = buildImportedVoucherMetadata(payload.sourcePath)
    const input = {
      ledgerId: payload.ledgerId,
      sourcePath: payload.sourcePath,
      storageDir: ledgerDir,
      importedBy: actor.id,
      sourceNumber: payload.sourceNumber ?? null,
      sourceDate: payload.sourceDate ?? null,
      amountCents: payload.amountCents ?? null
    }
    const journal = new FileOperationJournal(context.db.name)
    let storedPath = ''
    try {
      return new FileOperationLifecycle(journal, context.db).execute(
        {
          operationId,
          kind: 'electronic_voucher_import',
          actorId: actor.id,
          username: actor.username,
          ledgerId: payload.ledgerId,
          requestHash: createHash('sha256')
            .update(
              JSON.stringify([
                payload.ledgerId,
                metadata,
                input.sourceNumber,
                input.sourceDate,
                input.amountCents
              ])
            )
            .digest('hex')
        },
        fileOperationArtifactRecovery,
        (lease) => {
          fs.mkdirSync(ledgerDir, { recursive: true })
          const resultDirectory = prepareFileOperationArtifact(
            journal,
            lease,
            operationId,
            ledgerDir,
            (staging) => {
              const stagedPath = path.join(staging, metadata.originalName)
              fs.copyFileSync(payload.sourcePath, stagedPath, fs.constants.COPYFILE_EXCL)
              if (buildImportedVoucherMetadata(stagedPath).sha256 !== metadata.sha256)
                throw new Error('电子凭证源文件在导入期间发生变化')
            }
          )
          storedPath = path.join(resultDirectory, metadata.originalName)
        },
        () => {
          context.actor = resolveSessionActor(context.db, actor.session, actor.source)
          requireCommandPermission(context.actor, 'voucher_entry')
          requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
          const imported = persistImportedElectronicVoucher(context.db, input, storedPath, metadata)
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
                operationId,
                voucherType: imported.voucherType
              }
            }
          )
          return {
            operationId,
            fileId: imported.fileId,
            recordId: imported.recordId,
            voucherType: imported.voucherType,
            fingerprint: imported.fingerprint
          }
        }
      )
    } catch (error) {
      throw fileOperationCommandError(error, operationId, journal)
    } finally {
      journal.close()
    }
  })
}

export async function listElectronicVouchersCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ElectronicVoucherListRow[]>> {
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
      .all(payload.ledgerId) as ElectronicVoucherListRow[]
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
  return withAuditedCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const record = context.db
      .prepare('SELECT id, ledger_id, voucher_type FROM electronic_voucher_records WHERE id = ?')
      .get(payload.recordId) as { id: number; ledger_id: number; voucher_type: string } | undefined
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
        payload.verificationMessage ??
          (verificationStatus === 'verified' ? '校验通过' : '校验失败'),
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
  return withAuditedCommandResult(context, () => {
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
): Promise<
  CommandResult<{ draftVoucher: NonNullable<IpcResult<'eVoucher:convert'>['draftVoucher']> }>
> {
  return withAuditedCommandResult(context, () => {
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
      voucherDate:
        payload.voucherDate ?? record.source_date ?? new Date().toISOString().slice(0, 10),
      voucherWord: payload.voucherWord ?? '记',
      summary:
        record.source_number?.trim() || record.counterpart_name?.trim() || record.original_name,
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

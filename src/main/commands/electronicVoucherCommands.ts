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
import { normalizeExplicitFilePath } from './explicitFilePath'
import { writeContextDiagnostic } from './contextDiagnostics'
import {
  inspectElectronicVoucherFile,
  loadElectronicVoucher,
  MANUAL_VERIFICATION_METHOD,
  requireUnlinkedElectronicVoucher,
  requireVerifiedElectronicVoucher,
  trackElectronicVoucherResult
} from './electronicVoucherWorkflow'

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
    payload = { ...payload, sourcePath: normalizeExplicitFilePath(payload.sourcePath) }
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
    writeContextDiagnostic(context.runtime, {
      event: '电子凭证接收路径',
      db: context.db,
      context: {
        ledgerId: payload.ledgerId,
        sourcePath: payload.sourcePath,
        writeTarget: ledgerDir
      }
    })
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
          writeContextDiagnostic(context.runtime, {
            event: '电子凭证实际落库路径',
            db: context.db,
            context: {
              ledgerId: payload.ledgerId,
              sourcePath: payload.sourcePath,
              writeTarget: ledgerDir,
              storedPath,
              recordId: imported.recordId
            }
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
           (SELECT voucher_id FROM voucher_source_links l WHERE l.source_type = 'electronic_voucher'
             AND l.source_record_id = r.id LIMIT 1) AS linked_voucher_id,
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

/** 只补充已记账凭证的来源，不改动分录、金额或记账状态。 */
export async function linkElectronicVoucherCommand(
  context: CommandContext,
  payload: { recordId: number; voucherId: number; sourceFingerprint: string }
): Promise<CommandResult<{ voucherId: number }>> {
  return trackElectronicVoucherResult(
    context,
    payload.recordId,
    'link',
    withAuditedCommandResult(context, () => {
      const record = loadElectronicVoucher(context, payload.recordId)
      requireVerifiedElectronicVoucher(context, record, true)
      if (!payload.sourceFingerprint || record.fingerprint !== payload.sourceFingerprint) {
        throw new CommandError('CONFLICT', '电子凭证来源已变化，请刷新后重新复核', null, 6)
      }
      const voucher = context.db
        .prepare('SELECT ledger_id, status FROM vouchers WHERE id = ?')
        .get(payload.voucherId) as { ledger_id: number; status: number } | undefined
      if (!voucher || voucher.ledger_id !== record.ledger_id || voucher.status !== 2) {
        throw new CommandError('VALIDATION_ERROR', '只能关联当前账套已记账凭证', null, 2)
      }
      context.db
        .prepare(
          `INSERT INTO voucher_source_links (voucher_id, source_type, source_record_id)
      VALUES (?, 'electronic_voucher', ?)`
        )
        .run(payload.voucherId, record.id)
      context.db
        .prepare(
          `UPDATE electronic_voucher_records SET status = 'converted', last_error = NULL,
      updated_at = datetime('now') WHERE id = ?`
        )
        .run(record.id)
      appendActorOperationLog(context, {
        ledgerId: record.ledger_id,
        module: 'electronic_voucher',
        action: 'link',
        targetType: 'electronic_voucher_record',
        targetId: record.id,
        details: { voucherId: payload.voucherId, existingBookkept: true }
      })
      return { voucherId: payload.voucherId }
    })
  )
}

export async function verifyElectronicVoucherCommand(
  context: CommandContext,
  payload: {
    recordId: number
    verificationStatus?: 'verified' | 'failed'
    verificationMethod?: string
    verificationMessage?: string
    manualConfirmation?: boolean
  }
): Promise<CommandResult<{ verificationStatus: 'pending' | 'verified' | 'failed' }>> {
  return trackElectronicVoucherResult(
    context,
    payload.recordId,
    'verify',
    withAuditedCommandResult(context, () => {
      const actor = requireCommandPermission(context.actor, 'voucher_entry')
      const record = loadElectronicVoucher(context, payload.recordId)
      requireUnlinkedElectronicVoucher(context, record.id)
      const inspected = inspectElectronicVoucherFile(record)
      let verificationStatus: 'pending' | 'verified' | 'failed' = inspected.status
      let verificationMethod = 'local-integrity-only'
      let verificationMessage = inspected.message
      if (payload.verificationStatus === 'verified' && inspected.supported) {
        if (payload.manualConfirmation !== true || !payload.verificationMessage?.trim()) {
          throw new CommandError(
            'VALIDATION_ERROR',
            '人工核验通过必须明确确认并填写核验依据；文件完整不代表真实',
            null,
            2
          )
        }
        verificationStatus = 'verified'
        verificationMethod = MANUAL_VERIFICATION_METHOD
        verificationMessage = payload.verificationMessage.trim()
      } else if (payload.verificationStatus === 'failed') {
        verificationStatus = 'failed'
        verificationMethod = 'manual-rejection'
        verificationMessage = payload.verificationMessage?.trim() || '人工核验未通过'
      }
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
          verificationMethod,
          verificationMessage,
          verificationStatus
        )
      context.db
        .prepare(
          `UPDATE electronic_voucher_records
         SET status = ?, last_error = ?, updated_at = datetime('now')
         WHERE id = ?`
        )
        .run(
          verificationStatus === 'verified'
            ? 'verified'
            : verificationStatus === 'failed'
              ? 'rejected'
              : 'imported',
          verificationStatus === 'verified' ? null : verificationMessage,
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
          action: 'verify',
          targetType: 'electronic_voucher_record',
          targetId: payload.recordId,
          details: {
            verificationStatus,
            state: verificationStatus === 'failed' ? 'failed' : 'succeeded',
            verificationMethod
          }
        }
      )
      return { verificationStatus }
    })
  )
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
  return trackElectronicVoucherResult(
    context,
    payload.recordId,
    'parse',
    withAuditedCommandResult(context, () => {
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
      const current = loadElectronicVoucher(context, payload.recordId)
      requireVerifiedElectronicVoucher(context, current)
      const sourceNumber =
        payload.sourceNumber === undefined ? current.source_number : payload.sourceNumber?.trim()
      const sourceDate =
        payload.sourceDate === undefined ? current.source_date : payload.sourceDate?.trim()
      const amountCents =
        payload.amountCents === undefined ? current.amount_cents : payload.amountCents
      const counterpartName =
        payload.counterpartName === undefined
          ? current.counterpart_name
          : payload.counterpartName?.trim()
      if (
        !sourceNumber ||
        !sourceDate ||
        !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) ||
        !Number.isFinite(Date.parse(sourceDate)) ||
        new Date(sourceDate).toISOString().slice(0, 10) !== sourceDate ||
        !Number.isSafeInteger(amountCents)
      ) {
        throw new CommandError(
          'VALIDATION_ERROR',
          '结构化复核需填写来源号码、有效日期和整数分金额',
          null,
          2
        )
      }
      if (
        context.db
          .prepare(
            `SELECT id FROM electronic_voucher_records WHERE ledger_id = ?
      AND voucher_type = ? AND trim(source_number) = ? AND id <> ? LIMIT 1`
          )
          .get(current.ledger_id, current.voucher_type, sourceNumber, current.id)
      ) {
        throw new CommandError(
          'CONFLICT',
          '相同类型和来源号码已存在，已阻止重复或冲突入账',
          null,
          6
        )
      }
      payload = { ...payload, sourceNumber, sourceDate, amountCents, counterpartName }
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
             last_error = NULL,
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
  )
}

export async function convertElectronicVoucherCommand(
  context: CommandContext,
  payload: { recordId: number; voucherDate?: string; voucherWord?: string }
): Promise<
  CommandResult<{ draftVoucher: NonNullable<IpcResult<'eVoucher:convert'>['draftVoucher']> }>
> {
  return trackElectronicVoucherResult(
    context,
    payload.recordId,
    'convert',
    withAuditedCommandResult(context, () => {
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
      const current = loadElectronicVoucher(context, payload.recordId)
      requireVerifiedElectronicVoucher(context, current, true)
      const draftVoucher = {
        ledgerId: record.ledger_id,
        voucherDate:
          payload.voucherDate ?? record.source_date ?? new Date().toISOString().slice(0, 10),
        voucherWord: payload.voucherWord ?? '记',
        summary:
          record.source_number?.trim() || record.counterpart_name?.trim() || record.original_name,
        sourceRecordId: record.id,
        sourceFingerprint: current.fingerprint,
        amountCents: current.amount_cents,
        entries: [] as Array<{
          summary: string
          subjectCode: string
          debitAmount: string
          creditAmount: string
          cashFlowItemId: number | null
        }>
      }
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
  )
}

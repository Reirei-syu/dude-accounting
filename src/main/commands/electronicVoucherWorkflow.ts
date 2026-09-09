import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ElectronicVoucherListRow } from '../../shared/contracts/electronicVoucher'
import { requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { CommandError, type CommandContext, type CommandResult } from './types'
import { withAuditedCommandResult } from './auditedResult'
import { appendActorOperationLog } from './operationLog'

export const MANUAL_VERIFICATION_METHOD = 'manual-evidence-v1'

/** 业务失败先回滚，再单独审计错误；日志写入失败时也回滚错误字段。 */
export async function trackElectronicVoucherResult<T>(
  context: CommandContext,
  recordId: number | undefined,
  action: string,
  pending: Promise<CommandResult<T>>
): Promise<CommandResult<T>> {
  const result = await pending
  if (result.status !== 'error' || !Number.isSafeInteger(recordId) || !recordId) return result
  const message =
    result.error?.code === 'INTERNAL_ERROR'
      ? '电子凭证处理失败，请检查存档和操作日志后重试'
      : (result.error?.message ?? '电子凭证处理失败')
  await withAuditedCommandResult(context, () => {
    const record = loadElectronicVoucher(context, recordId)
    context.db
      .prepare('UPDATE electronic_voucher_records SET last_error = ? WHERE id = ?')
      .run(message, record.id)
    appendActorOperationLog(context, {
      ledgerId: record.ledger_id,
      module: 'electronic_voucher',
      action: `${action}_failed`,
      targetType: 'electronic_voucher_record',
      targetId: record.id,
      details: { state: 'failed', error: message }
    })
  })
  return result
}

export function loadElectronicVoucher(
  context: CommandContext,
  recordId: number
): ElectronicVoucherListRow {
  requireCommandPermission(context.actor, 'voucher_entry')
  const record = context.db
    .prepare(
      `SELECT r.*, f.original_name, f.stored_path, f.sha256,
    f.file_size FROM electronic_voucher_records r
    JOIN electronic_voucher_files f ON f.id = r.file_id WHERE r.id = ?`
    )
    .get(recordId) as ElectronicVoucherListRow | undefined
  if (!record) throw new CommandError('NOT_FOUND', '电子凭证记录不存在', null, 5)
  requireCommandLedgerAccess(context.db, context.actor, record.ledger_id)
  return record
}

export function requireUnlinkedElectronicVoucher(context: CommandContext, recordId: number): void {
  if (
    context.db
      .prepare(
        `SELECT id FROM voucher_source_links
    WHERE source_type = 'electronic_voucher' AND source_record_id = ? LIMIT 1`
      )
      .get(recordId)
  ) {
    throw new CommandError('CONFLICT', '该电子凭证已关联记账凭证，不允许重复处理或入账', null, 6)
  }
}

/** 这里只检查存档文件完整性和基础格式，不代表签名或税务真实性验证。 */
export function inspectElectronicVoucherFile(record: ElectronicVoucherListRow): {
  status: 'pending' | 'failed'
  message: string
  supported: boolean
} {
  let bytes: Buffer
  try {
    if (!fs.statSync(record.stored_path).isFile()) throw new Error('not a file')
    bytes = fs.readFileSync(record.stored_path)
  } catch {
    return {
      status: 'failed',
      message: '存档文件不存在或无法读取，请检查原始文件',
      supported: false
    }
  }
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
    return { status: 'failed', message: '存档文件校验和不一致，已阻止处理', supported: false }
  }
  if (path.extname(record.original_name).toLowerCase() !== '.pdf') {
    return {
      status: 'pending',
      message: '当前格式尚无离线核验处理能力，保留待核验',
      supported: false
    }
  }
  if (
    bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
    !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
  ) {
    return { status: 'failed', message: 'PDF 基础格式不完整，已阻止处理', supported: false }
  }
  return {
    status: 'pending',
    message: '文件完整性检查通过；尚未验签验真，请提供人工核验依据',
    supported: true
  }
}

export function requireVerifiedElectronicVoucher(
  context: CommandContext,
  record: ElectronicVoucherListRow,
  parsed = false
): void {
  requireUnlinkedElectronicVoucher(context, record.id)
  const verification = context.db
    .prepare(
      `SELECT verification_status, verification_method, verification_message
    FROM electronic_voucher_verifications WHERE record_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(record.id) as
    | {
        verification_status: string
        verification_method: string
        verification_message: string
      }
    | undefined
  if (
    !verification ||
    verification.verification_status !== 'verified' ||
    verification.verification_method !== MANUAL_VERIFICATION_METHOD ||
    !verification.verification_message?.trim() ||
    !(parsed ? ['parsed'] : ['verified', 'parsed']).includes(record.status)
  ) {
    throw new CommandError(
      'VALIDATION_ERROR',
      parsed ? '请先完成有依据的核验和结构化复核' : '请先完成有依据的人工核验',
      null,
      2
    )
  }
  const inspected = inspectElectronicVoucherFile(record)
  if (!inspected.supported) throw new CommandError('VALIDATION_ERROR', inspected.message, null, 2)
}

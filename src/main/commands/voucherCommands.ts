import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertPeriodWritable } from '../services/periodState'
import {
  applyVoucherBatchAction,
  listVoucherBatchTargets,
  type VoucherBatchAction
} from '../services/voucherBatchLifecycle'
import {
  getNextVoucherNumber,
  getVoucherLedgerId,
  listVoucherEntries,
  listVoucherSummaries,
  type VoucherListStatusFilter
} from '../services/voucherCatalog'
import {
  createVoucherWithEntries,
  isVoucherNumberConflictError,
  updateVoucherWithEntries,
  type VoucherEntryInput
} from '../services/voucherLifecycle'
import {
  assertVoucherSwapAllowed,
  normalizeEmergencyReversalPayload,
  type EmergencyReversalPayload
} from '../services/voucherControl'
import {
  applyVoucherSwapPlan,
  buildVoucherSwapPlan,
  listVoucherSwapEntriesByVoucherId,
  listVoucherSwapVouchers,
  type VoucherSwapVoucher
} from '../services/voucherSwapLifecycle'
import {
  renumberVoucherNumbers,
  VoucherNumberRenumberValidationError,
  type VoucherNumberRenumberResult
} from '../services/voucherNumberLifecycle'
import {
  requireCommandActor,
  requireCommandLedgerAccess,
  requireCommandPermission
} from './authz'
import { writeContextDiagnostic } from './contextDiagnostics'
import { appendActorOperationLog } from './operationLog'
import {
  asCommandPayloadRecord,
  normalizeAmountText,
  normalizeBooleanField,
  normalizeOptionalPositiveInteger,
  normalizeOptionalStringField,
  normalizePositiveInteger,
  normalizePositiveIntegerArray,
  normalizeStringField
} from './payloadNormalizers'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

interface SaveVoucherInput {
  ledgerId: number
  voucherDate: string
  voucherWord?: string
  isCarryForward?: boolean
  entries: VoucherEntryInput[]
}

interface UpdateVoucherInput {
  voucherId: number
  ledgerId: number
  voucherDate: string
  entries: VoucherEntryInput[]
}

interface VoucherEditPayload {
  voucherId: number
  ledgerId: number
  period: string
  voucherDate: string
  entries: VoucherEntryInput[]
}

interface ExportVoucherEditPayloadInput {
  voucherId: number
  filePath?: string
}

interface SwapVoucherPositionsInput {
  voucherIds: number[]
}

const WSL_DRIVE_PATH_PATTERN = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/

function toWindowsSeparators(value: string): string {
  return value.replace(/\//g, '\\')
}

function convertPosixPathWithWslPath(filePath: string): string | null {
  try {
    const output = execFileSync('wsl.exe', ['wslpath', '-w', filePath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    }).trim()
    return output || null
  } catch {
    return null
  }
}

function normalizeCommandFilePath(filePath: string): string {
  const trimmedPath = filePath.trim()
  if (!trimmedPath) {
    throw new CommandError('VALIDATION_ERROR', 'filePath 不能为空', { field: 'filePath' }, 2)
  }

  if (process.platform !== 'win32') {
    return trimmedPath
  }

  const driveMatch = trimmedPath.match(WSL_DRIVE_PATH_PATTERN)
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase()
    const rest = driveMatch[2] ? toWindowsSeparators(driveMatch[2]) : ''
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`
  }

  const distroName = process.env.DUDEACC_WSL_DISTRO_NAME?.trim()
  if (distroName && trimmedPath.startsWith('/') && !trimmedPath.startsWith('//')) {
    return `\\\\wsl.localhost\\${distroName}${toWindowsSeparators(trimmedPath)}`
  }

  if (trimmedPath.startsWith('/') && !trimmedPath.startsWith('//')) {
    return convertPosixPathWithWslPath(trimmedPath) ?? trimmedPath
  }

  return trimmedPath
}

function formatAmountCents(amountCents: number): string {
  if (!Number.isFinite(amountCents)) {
    return '0'
  }

  const normalizedCents = Math.trunc(amountCents)
  const sign = normalizedCents < 0 ? '-' : ''
  const absoluteCents = Math.abs(normalizedCents)
  const yuan = Math.floor(absoluteCents / 100)
  const cents = absoluteCents % 100
  if (cents === 0) {
    return `${sign}${yuan}`
  }

  return `${sign}${yuan}.${String(cents).padStart(2, '0').replace(/0$/, '')}`
}

function normalizeExportVoucherEditPayload(payload: unknown): ExportVoucherEditPayloadInput {
  const rawPayload = asCommandPayloadRecord(payload, '导出凭证编辑载荷 payload 格式不正确')
  return {
    voucherId: normalizePositiveInteger(rawPayload.voucherId, 'voucherId', '缺少凭证 voucherId'),
    filePath: normalizeOptionalStringField(rawPayload.filePath, 'filePath')
  }
}

function writeVoucherEditPayloadFile(filePath: string, payload: VoucherEditPayload): string {
  const normalizedPath = normalizeCommandFilePath(filePath)
  fs.mkdirSync(path.dirname(normalizedPath), { recursive: true })
  fs.writeFileSync(normalizedPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return normalizedPath
}

function normalizeVoucherDateField(payload: Record<string, unknown>): string {
  const rawValue = payload.voucherDate ?? payload.date

  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw new CommandError(
      'VALIDATION_ERROR',
      '缺少凭证日期字段 voucherDate（兼容别名 date）',
      {
        field: 'voucherDate',
        aliases: ['date']
      },
      2
    )
  }

  const voucherDate = rawValue.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(voucherDate)) {
    throw new CommandError(
      'VALIDATION_ERROR',
      '凭证日期格式不正确，必须为 YYYY-MM-DD',
      {
        field: 'voucherDate',
        received: rawValue
      },
      2
    )
  }

  const rawPeriod = payload.period
  if (
    typeof rawPeriod === 'string' &&
    rawPeriod.trim() &&
    rawPeriod.trim() !== voucherDate.slice(0, 7)
  ) {
    throw new CommandError(
      'VALIDATION_ERROR',
      'payload.period 与凭证日期不一致',
      {
        period: rawPeriod.trim(),
        voucherDate
      },
      2
    )
  }

  return voucherDate
}

function normalizeVoucherWordField(payload: Record<string, unknown>): string | undefined {
  const rawValue = payload.voucherWord ?? payload.word
  if (typeof rawValue !== 'string') {
    return undefined
  }
  const voucherWord = rawValue.trim()
  return voucherWord ? voucherWord : undefined
}

function normalizeAmountField(
  value: unknown,
  rowNumber: number,
  sideLabel: '借方' | '贷方'
): string {
  try {
    return normalizeAmountText(value, sideLabel === '借方' ? 'debitAmount' : 'creditAmount')
  } catch {
    throw new CommandError(
      'VALIDATION_ERROR',
      `第${rowNumber}行${sideLabel}金额格式不正确`,
      {
        row: rowNumber,
        field: sideLabel === '借方' ? 'debitAmount' : 'creditAmount',
        received: value
      },
      2
    )
  }
}

function resolveCashFlowItemId(
  context: CommandContext,
  ledgerId: number,
  entry: Record<string, unknown>,
  rowNumber: number
): number | null {
  const rawId = entry.cashFlowItemId ?? entry.cashflowItemId
  if (rawId !== null && rawId !== undefined && rawId !== '') {
    return normalizePositiveInteger(
      rawId,
      'cashFlowItemId',
      `第${rowNumber}行现金流量项目编号无效`,
      {
        row: rowNumber,
        field: 'cashFlowItemId',
        received: rawId
      }
    )
  }

  const rawCode = entry.cashFlowItemCode ?? entry.cashflowItemCode
  if (typeof rawCode !== 'string' || !rawCode.trim()) {
    return null
  }

  const code = rawCode.trim()
  const row = context.db
    .prepare('SELECT id FROM cash_flow_items WHERE ledger_id = ? AND code = ?')
    .get(ledgerId, code) as { id: number } | undefined

  if (!row) {
    throw new CommandError(
      'VALIDATION_ERROR',
      `第${rowNumber}行现金流量项目编码无效：${code}`,
      {
        row: rowNumber,
        field: 'cashFlowItemCode',
        code
      },
      2
    )
  }

  return row.id
}

function normalizeVoucherEntriesField(
  context: CommandContext,
  ledgerId: number,
  payload: Record<string, unknown>
): VoucherEntryInput[] {
  if (!Array.isArray(payload.entries)) {
    throw new CommandError('VALIDATION_ERROR', 'entries 必须为数组', { field: 'entries' }, 2)
  }

  const defaultSummary =
    typeof payload.description === 'string' && payload.description.trim()
      ? payload.description.trim()
      : ''

  return payload.entries.map((rawEntry, index) => {
    const rowNumber = index + 1
    const entry = asCommandPayloadRecord(rawEntry, `第${rowNumber}行分录格式不正确`, {
      row: rowNumber
    })

    const rawSummary = entry.summary
    const summary =
      typeof rawSummary === 'string' && rawSummary.trim() ? rawSummary.trim() : defaultSummary

    const rawSubjectCode = entry.subjectCode ?? entry.subject_code ?? entry.subject
    if (
      !(
        (typeof rawSubjectCode === 'string' && rawSubjectCode.trim()) ||
        (typeof rawSubjectCode === 'number' && Number.isFinite(rawSubjectCode))
      )
    ) {
      throw new CommandError(
        'VALIDATION_ERROR',
        `第${rowNumber}行缺少会计科目 subjectCode`,
        {
          row: rowNumber,
          field: 'subjectCode'
        },
        2
      )
    }

    return {
      summary,
      subjectCode: String(rawSubjectCode).trim(),
      debitAmount: normalizeAmountField(entry.debitAmount ?? entry.debit, rowNumber, '借方'),
      creditAmount: normalizeAmountField(entry.creditAmount ?? entry.credit, rowNumber, '贷方'),
      cashFlowItemId: resolveCashFlowItemId(context, ledgerId, entry, rowNumber)
    }
  })
}

function normalizeSaveVoucherPayload(
  context: CommandContext,
  payload: SaveVoucherInput | Record<string, unknown>
): SaveVoucherInput {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  const ledgerId = normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId')

  return {
    ledgerId,
    voucherDate: normalizeVoucherDateField(rawPayload),
    voucherWord: normalizeVoucherWordField(rawPayload),
    isCarryForward: normalizeBooleanField(rawPayload.isCarryForward, 'isCarryForward', false),
    entries: normalizeVoucherEntriesField(context, ledgerId, rawPayload)
  }
}

function normalizeUpdateVoucherPayload(
  context: CommandContext,
  payload: UpdateVoucherInput | Record<string, unknown>
): UpdateVoucherInput {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  const ledgerId = normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId')

  return {
    voucherId: normalizePositiveInteger(rawPayload.voucherId, 'voucherId', '缺少凭证 voucherId'),
    ledgerId,
    voucherDate: normalizeVoucherDateField(rawPayload),
    entries: normalizeVoucherEntriesField(context, ledgerId, rawPayload)
  }
}

function extractLedgerIdFromVoucherPayload(
  payload: SaveVoucherInput | UpdateVoucherInput | Record<string, unknown>
): number {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  return normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId')
}

function normalizeVoucherPeriodPayload(payload: unknown): { ledgerId: number; period: string } {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    period: normalizeStringField(rawPayload.period, 'period', '缺少会计期间 period')
  }
}

function throwInvalidVoucherListStatus(value: unknown): never {
  throw new CommandError(
    'VALIDATION_ERROR',
    'status 仅支持 0、1、2、3 或 all；默认不返回已删除凭证，status=all 可包含已删除凭证',
    {
      field: 'status',
      received: value,
      allowed: [0, 1, 2, 3, 'all']
    },
    2
  )
}

function normalizeVoucherListStatus(value: unknown): VoucherListStatusFilter | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3) {
    return value as VoucherListStatusFilter
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    throwInvalidVoucherListStatus(value)
  }

  const status = String(value).trim().toLowerCase()
  if (!status) {
    return undefined
  }
  if (status === 'all') {
    return 'all'
  }
  if (/^[0-3]$/.test(status)) {
    return Number(status) as VoucherListStatusFilter
  }

  throwInvalidVoucherListStatus(value)
}

function normalizeVoucherListPayload(payload: unknown): {
  ledgerId: number
  voucherId?: number
  period?: string
  dateFrom?: string
  dateTo?: string
  keyword?: string
  status?: VoucherListStatusFilter
} {
  const rawPayload = asCommandPayloadRecord(payload, '凭证列表 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    voucherId: normalizeOptionalPositiveInteger(rawPayload.voucherId, 'voucherId'),
    period: normalizeOptionalStringField(rawPayload.period, 'period'),
    dateFrom: normalizeOptionalStringField(rawPayload.dateFrom, 'dateFrom'),
    dateTo: normalizeOptionalStringField(rawPayload.dateTo, 'dateTo'),
    keyword: normalizeOptionalStringField(rawPayload.keyword, 'keyword'),
    status: normalizeVoucherListStatus(rawPayload.status)
  }
}

function normalizeVoucherIdPayload(payload: unknown): { voucherId: number } {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  return {
    voucherId: normalizePositiveInteger(rawPayload.voucherId, 'voucherId', '缺少凭证 voucherId')
  }
}

function normalizeVoucherIdsPayload(payload: unknown): { voucherIds: number[] } {
  const rawPayload = asCommandPayloadRecord(payload, '凭证 payload 格式不正确')
  return {
    voucherIds: normalizePositiveIntegerArray(rawPayload.voucherIds, 'voucherIds')
  }
}

function normalizeVoucherBatchPayload(payload: unknown): {
  action: VoucherBatchAction
  voucherIds: number[]
  reason?: string
  approvalTag?: string
} {
  const rawPayload = asCommandPayloadRecord(payload, '凭证批量操作 payload 格式不正确')
  return {
    action: normalizeStringField(rawPayload.action, 'action', '缺少批量操作 action') as VoucherBatchAction,
    voucherIds: normalizePositiveIntegerArray(rawPayload.voucherIds, 'voucherIds'),
    reason: normalizeOptionalStringField(rawPayload.reason, 'reason'),
    approvalTag: normalizeOptionalStringField(rawPayload.approvalTag, 'approvalTag')
  }
}

function ensureWritableVoucherPeriodForCommand(
  context: CommandContext,
  ledgerId: number,
  period: string
): { period: string } {
  try {
    return ensureVoucherPeriod(context, ledgerId, period, 'period')
  } catch (error) {
    if (error instanceof CommandError) {
      throw error
    }
    if (error instanceof Error) {
      throw new CommandError('VALIDATION_ERROR', error.message, null, 2)
    }
    throw error
  }
}

function ensureVoucherPeriod(
  context: CommandContext,
  ledgerId: number,
  voucherDateOrPeriod: string,
  mode: 'date' | 'period'
): { period: string } {
  const period = mode === 'date' ? voucherDateOrPeriod.slice(0, 7) : voucherDateOrPeriod
  const ledger = context.db
    .prepare('SELECT current_period FROM ledgers WHERE id = ?')
    .get(ledgerId) as { current_period: string } | undefined
  if (!ledger) {
    throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId }, 5)
  }
  const currentPeriod = ledger.current_period?.trim() ?? ''
  const details: Record<string, unknown> = {
    ledgerId,
    currentPeriod: currentPeriod || null,
    requestedPeriod: period
  }
  if (mode === 'date') {
    details.voucherDate = voucherDateOrPeriod
  }

  if (!currentPeriod) {
    throw new CommandError('VALIDATION_ERROR', '账套当前会计期间未设置，无法保存或整理凭证', details, 2)
  }

  if (currentPeriod !== period) {
    const message =
      mode === 'date'
        ? `凭证日期所属期间（${period}）与当前会计期间（${currentPeriod}）不一致`
        : `凭证会计期间（${period}）与当前会计期间（${currentPeriod}）不一致`
    throw new CommandError(
      'VALIDATION_ERROR',
      message,
      details,
      2
    )
  }

  try {
    assertPeriodWritable(context.db, ledgerId, period)
  } catch (error) {
    if (error instanceof CommandError) {
      throw error
    }
    if (error instanceof Error) {
      throw new CommandError('VALIDATION_ERROR', error.message, details, 2)
    }
    throw error
  }
  return { period }
}

export async function getNextVoucherNumberCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<{ voucherNumber: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeVoucherPeriodPayload(payload)
    requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const { period } = ensureVoucherPeriod(
      context,
      normalizedPayload.ledgerId,
      normalizedPayload.period,
      'period'
    )
    return { voucherNumber: getNextVoucherNumber(context.db, normalizedPayload.ledgerId, period) }
  })
}

export async function createVoucherCommand(
  context: CommandContext,
  payload: SaveVoucherInput
): Promise<CommandResult<{ voucherId: number; voucherNumber: number; status: number }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const ledgerId = extractLedgerIdFromVoucherPayload(payload)
    requireCommandLedgerAccess(context.db, context.actor, ledgerId)
    const normalizedPayload = normalizeSaveVoucherPayload(context, payload)
    const { period } = ensureVoucherPeriod(
      context,
      normalizedPayload.ledgerId,
      normalizedPayload.voucherDate,
      'date'
    )
    const allowSameRow = context.db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get('allow_same_maker_auditor') as { value: string } | undefined
    const result = createVoucherWithEntries(context.db, {
      ledgerId: normalizedPayload.ledgerId,
      period,
      voucherDate: normalizedPayload.voucherDate,
      voucherWord: normalizedPayload.voucherWord,
      isCarryForward: normalizedPayload.isCarryForward,
      entries: normalizedPayload.entries,
      creatorId: actor.id,
      allowSameMakerAuditor: allowSameRow?.value === '1'
    })
    writeContextDiagnostic(context.runtime, {
      event: 'voucher.save.context',
      db: context.db,
      context: {
        ledgerId: normalizedPayload.ledgerId,
        period,
        voucherDate: normalizedPayload.voucherDate,
        voucherId: result.voucherId,
        voucherNumber: result.voucherNumber,
        entryCount: normalizedPayload.entries.length,
        status: 'success'
      }
    })
    return result
  })
}

export async function updateVoucherCommand(
  context: CommandContext,
  payload: UpdateVoucherInput
): Promise<CommandResult<{ voucherId: number; voucherNumber: number; status: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'voucher_entry')
    const ledgerId = extractLedgerIdFromVoucherPayload(payload)
    requireCommandLedgerAccess(context.db, context.actor, ledgerId)
    const normalizedPayload = normalizeUpdateVoucherPayload(context, payload)
    const voucher = context.db
      .prepare(
        `SELECT id, ledger_id, voucher_number, status
         FROM vouchers
         WHERE id = ?`
      )
      .get(normalizedPayload.voucherId) as
      | {
          id: number
          ledger_id: number
          voucher_number: number
          status: number
        }
      | undefined
    if (!voucher) {
      throw new CommandError('NOT_FOUND', '凭证不存在', { voucherId: normalizedPayload.voucherId }, 5)
    }
    if (voucher.ledger_id !== normalizedPayload.ledgerId) {
      throw new CommandError('VALIDATION_ERROR', '凭证不属于当前账套', null, 2)
    }
    if (voucher.status !== 0) {
      throw new CommandError('VALIDATION_ERROR', '仅未审核凭证可修改', null, 2)
    }
    const { period } = ensureVoucherPeriod(
      context,
      normalizedPayload.ledgerId,
      normalizedPayload.voucherDate,
      'date'
    )
    try {
      updateVoucherWithEntries(context.db, {
        voucherId: normalizedPayload.voucherId,
        ledgerId: normalizedPayload.ledgerId,
        period,
        voucherDate: normalizedPayload.voucherDate,
        entries: normalizedPayload.entries
      })
    } catch (error) {
      if (isVoucherNumberConflictError(error)) {
        throw new CommandError('CONFLICT', '凭证编号冲突，请调整日期后重试', null, 6)
      }
      throw error
    }
    return {
      voucherId: voucher.id,
      voucherNumber: voucher.voucher_number,
      status: voucher.status
    }
  })
}

export async function exportVoucherEditPayloadCommand(
  context: CommandContext,
  payload: ExportVoucherEditPayloadInput
): Promise<CommandResult<{ payload: VoucherEditPayload; filePath?: string }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'voucher_entry')
    const normalizedPayload = normalizeExportVoucherEditPayload(payload)
    const voucher = context.db
      .prepare(
        `SELECT id, ledger_id, period, voucher_date, status
         FROM vouchers
         WHERE id = ?`
      )
      .get(normalizedPayload.voucherId) as
      | {
          id: number
          ledger_id: number
          period: string
          voucher_date: string
          status: number
        }
      | undefined

    if (!voucher) {
      throw new CommandError('NOT_FOUND', '凭证不存在', { voucherId: normalizedPayload.voucherId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, voucher.ledger_id)
    if (voucher.status !== 0) {
      throw new CommandError('VALIDATION_ERROR', '仅未审核凭证可导出编辑载荷', null, 2)
    }
    ensureVoucherPeriod(context, voucher.ledger_id, voucher.voucher_date, 'date')

    const entries = listVoucherEntries(context.db, normalizedPayload.voucherId)
    const editPayload: VoucherEditPayload = {
      voucherId: voucher.id,
      ledgerId: voucher.ledger_id,
      period: voucher.period,
      voucherDate: voucher.voucher_date,
      entries: entries.map((entry) => ({
        summary: entry.summary,
        subjectCode: entry.subject_code,
        debitAmount: formatAmountCents(entry.debit_amount),
        creditAmount: formatAmountCents(entry.credit_amount),
        cashFlowItemId: entry.cash_flow_item_id
      }))
    }

    const filePath = normalizedPayload.filePath
      ? writeVoucherEditPayloadFile(normalizedPayload.filePath, editPayload)
      : undefined

    return filePath
      ? {
          payload: editPayload,
          filePath
        }
      : {
          payload: editPayload
        }
  })
}

export async function listVouchersCommand(
  context: CommandContext,
  query: {
    ledgerId: number
    voucherId?: number
    period?: string
    dateFrom?: string
    dateTo?: string
    keyword?: string
    status?: VoucherListStatusFilter
  }
): Promise<CommandResult<ReturnType<typeof listVoucherSummaries>>> {
  return withCommandResult(context, () => {
    const normalizedQuery = normalizeVoucherListPayload(query)
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedQuery.ledgerId)
    return listVoucherSummaries(context.db, normalizedQuery)
  })
}

export async function getVoucherEntriesCommand(
  context: CommandContext,
  payload: { voucherId: number }
): Promise<CommandResult<ReturnType<typeof listVoucherEntries>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeVoucherIdPayload(payload)
    requireCommandActor(context.actor)
    const ledgerId = getVoucherLedgerId(context.db, normalizedPayload.voucherId)
    if (ledgerId === null) {
      throw new CommandError('NOT_FOUND', '凭证不存在', { voucherId: normalizedPayload.voucherId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, ledgerId)
    return listVoucherEntries(context.db, normalizedPayload.voucherId)
  })
}

export async function swapVoucherPositionsCommand(
  context: CommandContext,
  payload: SwapVoucherPositionsInput
): Promise<CommandResult<{ voucherIds: number[] }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const normalizedPayload = normalizeVoucherIdsPayload(payload)
    if (normalizedPayload.voucherIds.length !== 2) {
      throw new CommandError('VALIDATION_ERROR', '仅选择 2 张凭证时才可交换位置', null, 2)
    }
    const voucherIds = Array.from(new Set(normalizedPayload.voucherIds))
    if (voucherIds.length !== 2) {
      throw new CommandError('VALIDATION_ERROR', '请选择两张不同的凭证', null, 2)
    }

    const vouchers = listVoucherSwapVouchers(context.db, voucherIds)
    if (vouchers.length !== 2) {
      throw new CommandError('VALIDATION_ERROR', '存在无效凭证，交换失败', null, 2)
    }
    for (const voucher of vouchers) {
      requireCommandLedgerAccess(context.db, context.actor, voucher.ledgerId)
    }
    const vouchersById = new Map<number, VoucherSwapVoucher>(
      vouchers.map((voucher) => [voucher.id, voucher])
    )
    const firstVoucher = vouchersById.get(voucherIds[0])
    const secondVoucher = vouchersById.get(voucherIds[1])
    if (!firstVoucher || !secondVoucher) {
      throw new CommandError('VALIDATION_ERROR', '存在无效凭证，交换失败', null, 2)
    }
    assertVoucherSwapAllowed([firstVoucher, secondVoucher])
    if (
      firstVoucher.ledgerId !== secondVoucher.ledgerId ||
      firstVoucher.period !== secondVoucher.period
    ) {
      throw new CommandError(
        'VALIDATION_ERROR',
        '仅支持同一账套、同一期间的两张凭证交换位置',
        null,
        2
      )
    }
    const entryMap = listVoucherSwapEntriesByVoucherId(context.db, voucherIds)
    const plan = buildVoucherSwapPlan(
      firstVoucher,
      secondVoucher,
      entryMap.get(firstVoucher.id) ?? [],
      entryMap.get(secondVoucher.id) ?? []
    )
    applyVoucherSwapPlan(context.db, plan)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: firstVoucher.ledgerId,
        module: 'voucher',
        action: 'swap_positions',
        targetType: 'voucher_pair',
        targetId: voucherIds.join(','),
        details: { voucherIds }
      }
    )
    return { voucherIds }
  })
}

export async function renumberVoucherNumbersCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<VoucherNumberRenumberResult>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    const normalizedPayload = normalizeVoucherPeriodPayload(payload)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const { period } = ensureWritableVoucherPeriodForCommand(
      context,
      normalizedPayload.ledgerId,
      normalizedPayload.period
    )

    let result: VoucherNumberRenumberResult
    try {
      result = renumberVoucherNumbers(context.db, normalizedPayload.ledgerId, period)
    } catch (error) {
      if (error instanceof VoucherNumberRenumberValidationError) {
        throw new CommandError('VALIDATION_ERROR', error.message, error.details, 2)
      }
      throw error
    }

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: normalizedPayload.ledgerId,
        module: 'voucher',
        action: 'renumber_voucher_numbers',
        targetType: 'voucher_period',
        targetId: `${normalizedPayload.ledgerId}:${period}`,
        details: {
          period,
          totalCount: result.totalCount,
          updatedCount: result.updatedCount,
          groups: result.groups,
          changeCount: result.changes.length,
          changes: result.changes.slice(0, 50)
        }
      }
    )

    return result
  })
}

export async function voucherBatchActionCommand(
  context: CommandContext,
  payload: {
    action: VoucherBatchAction
    voucherIds: number[]
    reason?: string
    approvalTag?: string
  }
): Promise<
  CommandResult<{ processedCount: number; skippedCount: number; requestedCount: number }>
> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeVoucherBatchPayload(payload)
    if (normalizedPayload.voucherIds.length === 0) {
      throw new CommandError('VALIDATION_ERROR', '请选择凭证', null, 2)
    }

    const action = normalizedPayload.action
    const actor =
      action === 'audit' || action === 'unaudit'
        ? requireCommandPermission(context.actor, 'audit')
        : action === 'bookkeep'
          ? requireCommandPermission(context.actor, 'bookkeeping')
          : action === 'unbookkeep'
            ? requireCommandPermission(context.actor, 'unbookkeep')
            : requireCommandPermission(context.actor, 'voucher_entry')
    const emergencyReversal: EmergencyReversalPayload | null =
      action === 'unbookkeep'
        ? normalizeEmergencyReversalPayload({
            reason: normalizedPayload.reason,
            approvalTag: normalizedPayload.approvalTag
          })
        : null

    const vouchers = listVoucherBatchTargets(context.db, normalizedPayload.voucherIds)
    if (vouchers.length !== normalizedPayload.voucherIds.length) {
      throw new CommandError('VALIDATION_ERROR', '存在无效凭证，操作中止', null, 2)
    }
    for (const voucher of vouchers) {
      requireCommandLedgerAccess(context.db, context.actor, voucher.ledger_id)
    }

    const { applicable, skipped } = applyVoucherBatchAction(
      context.db,
      action,
      vouchers,
      actor.id,
      emergencyReversal
    )

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId:
          applicable.length > 0
            ? applicable[0].ledger_id
            : vouchers.length > 0
              ? vouchers[0].ledger_id
              : null,
        module: 'voucher',
        action,
        targetType: 'voucher_batch',
        targetId: normalizedPayload.voucherIds.join(','),
        reason: emergencyReversal?.reason ?? null,
        approvalTag: emergencyReversal?.approvalTag ?? null,
        details: {
          processedCount: applicable.length,
          skippedCount: skipped.length,
          requestedCount: vouchers.length
        }
      }
    )

    return {
      processedCount: applicable.length,
      skippedCount: skipped.length,
      requestedCount: vouchers.length
    }
  })
}

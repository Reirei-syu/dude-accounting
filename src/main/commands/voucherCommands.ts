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

interface SwapVoucherPositionsInput {
  voucherIds: number[]
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
    status: normalizeOptionalStringField(rawPayload.status, 'status') as
      | VoucherListStatusFilter
      | undefined
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
  if (ledger.current_period !== period) {
    throw new CommandError(
      'VALIDATION_ERROR',
      `凭证日期必须在当前会计期间（${ledger.current_period}）内`,
      null,
      2
    )
  }
  assertPeriodWritable(context.db, ledgerId, period)
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

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
import { appendActorOperationLog } from './operationLog'
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
    requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const { period } = ensureVoucherPeriod(context, payload.ledgerId, payload.period, 'period')
    return { voucherNumber: getNextVoucherNumber(context.db, payload.ledgerId, period) }
  })
}

export async function createVoucherCommand(
  context: CommandContext,
  payload: SaveVoucherInput
): Promise<CommandResult<{ voucherId: number; voucherNumber: number; status: number }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    if (!payload.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.voucherDate)) {
      throw new CommandError('VALIDATION_ERROR', '凭证日期格式不正确', null, 2)
    }
    const { period } = ensureVoucherPeriod(context, payload.ledgerId, payload.voucherDate, 'date')
    const allowSameRow = context.db
      .prepare('SELECT value FROM system_settings WHERE key = ?')
      .get('allow_same_maker_auditor') as { value: string } | undefined
    const result = createVoucherWithEntries(context.db, {
      ledgerId: payload.ledgerId,
      period,
      voucherDate: payload.voucherDate,
      voucherWord: payload.voucherWord,
      isCarryForward: payload.isCarryForward,
      entries: payload.entries,
      creatorId: actor.id,
      allowSameMakerAuditor: allowSameRow?.value === '1'
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
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    if (!payload.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.voucherDate)) {
      throw new CommandError('VALIDATION_ERROR', '凭证日期格式不正确', null, 2)
    }
    const voucher = context.db
      .prepare(
        `SELECT id, ledger_id, voucher_number, status
         FROM vouchers
         WHERE id = ?`
      )
      .get(payload.voucherId) as
      | {
          id: number
          ledger_id: number
          voucher_number: number
          status: number
        }
      | undefined
    if (!voucher) {
      throw new CommandError('NOT_FOUND', '凭证不存在', { voucherId: payload.voucherId }, 5)
    }
    if (voucher.ledger_id !== payload.ledgerId) {
      throw new CommandError('VALIDATION_ERROR', '凭证不属于当前账套', null, 2)
    }
    if (voucher.status !== 0) {
      throw new CommandError('VALIDATION_ERROR', '仅未审核凭证可修改', null, 2)
    }
    const { period } = ensureVoucherPeriod(context, payload.ledgerId, payload.voucherDate, 'date')
    try {
      updateVoucherWithEntries(context.db, {
        voucherId: payload.voucherId,
        ledgerId: payload.ledgerId,
        period,
        voucherDate: payload.voucherDate,
        entries: payload.entries
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
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return listVoucherSummaries(context.db, query)
  })
}

export async function getVoucherEntriesCommand(
  context: CommandContext,
  payload: { voucherId: number }
): Promise<CommandResult<ReturnType<typeof listVoucherEntries>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    const ledgerId = getVoucherLedgerId(context.db, payload.voucherId)
    if (ledgerId === null) {
      throw new CommandError('NOT_FOUND', '凭证不存在', { voucherId: payload.voucherId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, ledgerId)
    return listVoucherEntries(context.db, payload.voucherId)
  })
}

export async function swapVoucherPositionsCommand(
  context: CommandContext,
  payload: SwapVoucherPositionsInput
): Promise<CommandResult<{ voucherIds: number[] }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'voucher_entry')
    if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length !== 2) {
      throw new CommandError('VALIDATION_ERROR', '仅选择 2 张凭证时才可交换位置', null, 2)
    }
    const voucherIds = Array.from(new Set(payload.voucherIds))
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
    const vouchersById = new Map<number, VoucherSwapVoucher>(vouchers.map((voucher) => [voucher.id, voucher]))
    const firstVoucher = vouchersById.get(voucherIds[0])
    const secondVoucher = vouchersById.get(voucherIds[1])
    if (!firstVoucher || !secondVoucher) {
      throw new CommandError('VALIDATION_ERROR', '存在无效凭证，交换失败', null, 2)
    }
    assertVoucherSwapAllowed([firstVoucher, secondVoucher])
    if (firstVoucher.ledgerId !== secondVoucher.ledgerId || firstVoucher.period !== secondVoucher.period) {
      throw new CommandError('VALIDATION_ERROR', '仅支持同一账套、同一期间的两张凭证交换位置', null, 2)
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
    if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length === 0) {
      throw new CommandError('VALIDATION_ERROR', '请选择凭证', null, 2)
    }

    const action = payload.action
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
            reason: payload.reason,
            approvalTag: payload.approvalTag
          })
        : null

    const vouchers = listVoucherBatchTargets(context.db, payload.voucherIds)
    if (vouchers.length !== payload.voucherIds.length) {
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
        targetId: payload.voucherIds.join(','),
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

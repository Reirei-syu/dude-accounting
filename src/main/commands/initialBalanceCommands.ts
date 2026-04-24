import {
  listInitialBalances,
  saveInitialBalances,
  type InitialBalanceEntryInput
} from '../services/initialBalance'
import { requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import {
  asCommandPayloadRecord,
  normalizeAmountText,
  normalizePositiveInteger,
  normalizeStringField
} from './payloadNormalizers'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function normalizeCodeLikeField(value: unknown, fieldName: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  throw new CommandError('VALIDATION_ERROR', `${fieldName} 必须为字符串`, { field: fieldName }, 2)
}

function normalizeInitialBalanceListPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '查询期初余额 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    period: normalizeStringField(rawPayload.period, 'period', '缺少会计期间 period')
  }
}

function normalizeInitialBalanceEntries(value: unknown): InitialBalanceEntryInput[] {
  if (!Array.isArray(value)) {
    throw new CommandError('VALIDATION_ERROR', 'entries 必须为数组', { field: 'entries' }, 2)
  }

  return value.map((item, index) => {
    const entry = asCommandPayloadRecord(item, `第 ${index + 1} 行期初余额格式不正确`, {
      row: index + 1
    })
    return {
      subjectCode: normalizeCodeLikeField(entry.subjectCode, 'subjectCode'),
      debitAmount: normalizeAmountText(entry.debitAmount ?? entry.debit, 'debitAmount'),
      creditAmount: normalizeAmountText(entry.creditAmount ?? entry.credit, 'creditAmount')
    }
  })
}

function normalizeInitialBalanceSavePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '保存期初余额 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    period: normalizeStringField(rawPayload.period, 'period', '缺少会计期间 period'),
    entries: normalizeInitialBalanceEntries(rawPayload.entries)
  }
}

export async function listInitialBalancesCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<ReturnType<typeof listInitialBalances>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeInitialBalanceListPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listInitialBalances(context.db, normalizedPayload.ledgerId, normalizedPayload.period)
  })
}

export async function saveInitialBalancesCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string; entries: InitialBalanceEntryInput[] }
): Promise<CommandResult<{ ledgerId: number; period: string }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeInitialBalanceSavePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    saveInitialBalances(context.db, normalizedPayload)

    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'initial_balance',
      action: 'save',
      targetType: 'initial_balance',
      targetId: `${normalizedPayload.ledgerId}:${normalizedPayload.period}`,
      details: {
        period: normalizedPayload.period,
        entryCount: normalizedPayload.entries.length
      }
    })

    return {
      ledgerId: normalizedPayload.ledgerId,
      period: normalizedPayload.period
    }
  })
}

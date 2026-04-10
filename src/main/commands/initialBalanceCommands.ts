import {
  listInitialBalances,
  saveInitialBalances,
  type InitialBalanceEntryInput
} from '../services/initialBalance'
import { requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

export async function listInitialBalancesCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<ReturnType<typeof listInitialBalances>>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listInitialBalances(context.db, payload.ledgerId, payload.period)
  })
}

export async function saveInitialBalancesCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string; entries: InitialBalanceEntryInput[] }
): Promise<CommandResult<{ ledgerId: number; period: string }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    saveInitialBalances(context.db, payload)

    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'initial_balance',
      action: 'save',
      targetType: 'initial_balance',
      targetId: `${payload.ledgerId}:${payload.period}`,
      details: {
        period: payload.period,
        entryCount: Array.isArray(payload.entries) ? payload.entries.length : 0
      }
    })

    return {
      ledgerId: payload.ledgerId,
      period: payload.period
    }
  })
}

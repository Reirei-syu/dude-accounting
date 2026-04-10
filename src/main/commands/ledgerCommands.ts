import { getStandardTemplateSummaries } from '../database/seed'
import { listAccessibleLedgers, listLedgerPeriods } from '../services/ledgerCatalog'
import { getLedgerDeletionRiskSnapshot } from '../services/ledgerCompliance'
import {
  applyLedgerStandardTemplate,
  createLedgerWithTemplate,
  updateLedgerConfiguration,
  type LedgerStandardType
} from '../services/ledgerLifecycle'
import { requireCommandActor, requireCommandLedgerAccess, requireCommandPermission, assertRiskConfirmed } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function assertStandardType(value: string): LedgerStandardType {
  if (value !== 'enterprise' && value !== 'npo') {
    throw new CommandError('VALIDATION_ERROR', '账套准则类型不合法', { standardType: value }, 2)
  }
  return value
}

export async function listLedgersCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof listAccessibleLedgers>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    return listAccessibleLedgers(context.db, {
      userId: actor.id,
      isAdmin: actor.isAdmin
    })
  })
}

export async function createLedgerCommand(
  context: CommandContext,
  payload: {
    name: string
    standardType: string
    startPeriod: string
  }
): Promise<CommandResult<{ id: number }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const result = createLedgerWithTemplate(context.db, {
      name: payload.name,
      standardType: assertStandardType(payload.standardType),
      startPeriod: payload.startPeriod,
      operatorUserId: actor.id,
      operatorIsAdmin: actor.isAdmin
    })

    appendActorOperationLog(context, {
      ledgerId: result.ledgerId,
      module: 'ledger',
      action: 'create',
      targetType: 'ledger',
      targetId: result.ledgerId,
      details: {
        standardType: payload.standardType,
        startPeriod: payload.startPeriod,
        customSubjectCount: result.customSubjectCount
      }
    })

    return { id: result.ledgerId }
  })
}

export async function updateLedgerCommand(
  context: CommandContext,
  payload: { id: number; name?: string; currentPeriod?: string }
): Promise<CommandResult<{ id: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.id)
    updateLedgerConfiguration(context.db, {
      ledgerId: payload.id,
      name: payload.name,
      currentPeriod: payload.currentPeriod
    })

    appendActorOperationLog(context, {
      ledgerId: payload.id,
      module: 'ledger',
      action: 'update',
      targetType: 'ledger',
      targetId: payload.id,
      details: {
        name: payload.name,
        currentPeriod: payload.currentPeriod
      }
    })

    return { id: payload.id }
  })
}

export async function deleteLedgerCommand(
  context: CommandContext,
  payload: { ledgerId: number; riskAcknowledged?: boolean }
): Promise<CommandResult<{ ledgerId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const riskSnapshot = getLedgerDeletionRiskSnapshot(context.db, payload.ledgerId)
    if (riskSnapshot.missingValidatedBackup || riskSnapshot.missingValidatedArchive) {
      assertRiskConfirmed(
        payload.riskAcknowledged,
        '当前账套仍缺少已校验备份或电子档案导出，请显式确认风险后再继续删除。'
      )
    }

    context.db.prepare('DELETE FROM ledgers WHERE id = ?').run(payload.ledgerId)
    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'ledger',
      action: 'delete',
      targetType: 'ledger',
      targetId: payload.ledgerId,
      details: {
        ...riskSnapshot,
        riskAcknowledged: payload.riskAcknowledged === true
      }
    })

    return { ledgerId: payload.ledgerId }
  })
}

export async function getLedgerDeletionRiskCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof getLedgerDeletionRiskSnapshot>>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return getLedgerDeletionRiskSnapshot(context.db, payload.ledgerId)
  })
}

export async function listLedgerPeriodsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listLedgerPeriods>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listLedgerPeriods(context.db, payload.ledgerId)
  })
}

export async function listLedgerTemplatesCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getStandardTemplateSummaries>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getStandardTemplateSummaries()
  })
}

export async function applyLedgerTemplateCommand(
  context: CommandContext,
  payload: { ledgerId: number; standardType: string }
): Promise<CommandResult<{ ledger: unknown; subjectCount: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const result = applyLedgerStandardTemplate(context.db, {
      ledgerId: payload.ledgerId,
      standardType: assertStandardType(payload.standardType)
    })

    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'ledger',
      action: 'apply_standard_template',
      targetType: 'ledger',
      targetId: payload.ledgerId,
      details: {
        standardType: payload.standardType,
        subjectCount: result.subjectCount,
        customSubjectCount: result.customSubjectCount
      }
    })

    return {
      ledger: result.updatedLedger ?? null,
      subjectCount: result.subjectCount
    }
  })
}

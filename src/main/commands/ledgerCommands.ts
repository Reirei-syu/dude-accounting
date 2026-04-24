import { getStandardTemplateSummaries } from '../database/seed'
import { listAccessibleLedgers, listLedgerPeriods } from '../services/ledgerCatalog'
import { getLedgerDeletionRiskSnapshot } from '../services/ledgerCompliance'
import {
  applyLedgerStandardTemplate,
  createLedgerWithTemplate,
  updateLedgerConfiguration,
  type LedgerStandardType
} from '../services/ledgerLifecycle'
import {
  requireCommandActor,
  requireCommandLedgerAccess,
  requireCommandPermission,
  assertRiskConfirmed
} from './authz'
import { appendActorOperationLog } from './operationLog'
import {
  asCommandPayloadRecord,
  normalizeBooleanField,
  normalizeOptionalStringField,
  normalizePositiveInteger,
  normalizeStringField
} from './payloadNormalizers'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function assertStandardType(value: string): LedgerStandardType {
  if (value !== 'enterprise' && value !== 'npo') {
    throw new CommandError('VALIDATION_ERROR', '账套准则类型不合法', { standardType: value }, 2)
  }
  return value
}

function normalizeLedgerIdPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '账套 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId ?? rawPayload.id, 'ledgerId', '缺少账套 ledgerId')
  }
}

function normalizeCreateLedgerPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '创建账套 payload 格式不正确')
  return {
    name: normalizeStringField(rawPayload.name, 'name', '账套名称不能为空'),
    standardType: normalizeStringField(rawPayload.standardType, 'standardType', '账套准则类型不能为空'),
    startPeriod: normalizeStringField(rawPayload.startPeriod, 'startPeriod', '账套启用期间不能为空')
  }
}

function normalizeUpdateLedgerPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '更新账套 payload 格式不正确')
  return {
    id: normalizePositiveInteger(rawPayload.id ?? rawPayload.ledgerId, 'id', '缺少账套 id'),
    name: normalizeOptionalStringField(rawPayload.name, 'name', 'name 必须为字符串'),
    currentPeriod: normalizeOptionalStringField(
      rawPayload.currentPeriod,
      'currentPeriod',
      'currentPeriod 必须为字符串'
    )
  }
}

function normalizeDeleteLedgerPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '删除账套 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId ?? rawPayload.id, 'ledgerId', '缺少账套 ledgerId'),
    riskAcknowledged: normalizeBooleanField(rawPayload.riskAcknowledged, 'riskAcknowledged', false)
  }
}

function normalizeApplyLedgerTemplatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '应用账套模板 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    standardType: normalizeStringField(rawPayload.standardType, 'standardType', '账套准则类型不能为空')
  }
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
    const normalizedPayload = normalizeCreateLedgerPayload(payload)
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const result = createLedgerWithTemplate(context.db, {
      name: normalizedPayload.name,
      standardType: assertStandardType(normalizedPayload.standardType),
      startPeriod: normalizedPayload.startPeriod,
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
        standardType: normalizedPayload.standardType,
        startPeriod: normalizedPayload.startPeriod,
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
    const normalizedPayload = normalizeUpdateLedgerPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.id)
    updateLedgerConfiguration(context.db, {
      ledgerId: normalizedPayload.id,
      name: normalizedPayload.name,
      currentPeriod: normalizedPayload.currentPeriod
    })

    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.id,
      module: 'ledger',
      action: 'update',
      targetType: 'ledger',
      targetId: normalizedPayload.id,
      details: {
        name: normalizedPayload.name,
        currentPeriod: normalizedPayload.currentPeriod
      }
    })

    return { id: normalizedPayload.id }
  })
}

export async function deleteLedgerCommand(
  context: CommandContext,
  payload: { ledgerId: number; riskAcknowledged?: boolean }
): Promise<CommandResult<{ ledgerId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeDeleteLedgerPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const riskSnapshot = getLedgerDeletionRiskSnapshot(context.db, normalizedPayload.ledgerId)
    if (riskSnapshot.missingValidatedBackup || riskSnapshot.missingValidatedArchive) {
      assertRiskConfirmed(
        normalizedPayload.riskAcknowledged,
        '当前账套仍缺少已校验备份或电子档案导出，请显式确认风险后再继续删除。'
      )
    }

    context.db.prepare('DELETE FROM ledgers WHERE id = ?').run(normalizedPayload.ledgerId)
    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'ledger',
      action: 'delete',
      targetType: 'ledger',
      targetId: normalizedPayload.ledgerId,
      details: {
        ...riskSnapshot,
        riskAcknowledged: normalizedPayload.riskAcknowledged === true
      }
    })

    return { ledgerId: normalizedPayload.ledgerId }
  })
}

export async function getLedgerDeletionRiskCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof getLedgerDeletionRiskSnapshot>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return getLedgerDeletionRiskSnapshot(context.db, normalizedPayload.ledgerId)
  })
}

export async function listLedgerPeriodsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listLedgerPeriods>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload)
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listLedgerPeriods(context.db, normalizedPayload.ledgerId)
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
    const normalizedPayload = normalizeApplyLedgerTemplatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const result = applyLedgerStandardTemplate(context.db, {
      ledgerId: normalizedPayload.ledgerId,
      standardType: assertStandardType(normalizedPayload.standardType)
    })

    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'ledger',
      action: 'apply_standard_template',
      targetType: 'ledger',
      targetId: normalizedPayload.ledgerId,
      details: {
        standardType: normalizedPayload.standardType,
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

import {
  createAuxiliaryItem,
  createSubject,
  deleteAuxiliaryItem,
  listAuxiliaryItems,
  listSubjects,
  searchSubjects,
  updateAuxiliaryItem,
  updateSubject
} from '../services/accountSetup'
import {
  createCashFlowMapping,
  deleteCashFlowMapping,
  listCashFlowItems,
  listCashFlowMappings,
  updateCashFlowMapping
} from '../services/cashFlowMapping'
import {
  requireCommandActor,
  requireCommandLedgerAccess,
  requireCommandPermission
} from './authz'
import { appendActorOperationLog } from './operationLog'
import {
  asCommandPayloadRecord,
  normalizeBooleanField,
  normalizeOptionalStringField,
  normalizePositiveInteger,
  normalizePositiveIntegerArray,
  normalizeStringArray,
  normalizeStringField
} from './payloadNormalizers'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function normalizeCodeLikeField(value: unknown, fieldName: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }
  throw new CommandError('VALIDATION_ERROR', `${fieldName} 必须为字符串`, { field: fieldName }, 2)
}

function normalizeOptionalCodeLikeField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return normalizeCodeLikeField(value, fieldName)
}

function normalizeLedgerIdPayload(payload: unknown, message: string) {
  const rawPayload = asCommandPayloadRecord(payload, message)
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId')
  }
}

function normalizeSubjectCreatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '创建科目 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    parentCode:
      rawPayload.parentCode === null
        ? null
        : normalizeCodeLikeField(rawPayload.parentCode, 'parentCode'),
    code: normalizeCodeLikeField(rawPayload.code, 'code'),
    name: normalizeStringField(rawPayload.name, 'name', '科目名称不能为空'),
    auxiliaryCategories:
      rawPayload.auxiliaryCategories === undefined
        ? []
        : normalizeStringArray(rawPayload.auxiliaryCategories, 'auxiliaryCategories'),
    customAuxiliaryItemIds:
      rawPayload.customAuxiliaryItemIds === undefined
        ? undefined
        : normalizePositiveIntegerArray(rawPayload.customAuxiliaryItemIds, 'customAuxiliaryItemIds'),
    isCashFlow: normalizeBooleanField(rawPayload.isCashFlow, 'isCashFlow', false)
  }
}

function normalizeSubjectSearchPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '查询科目 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    keyword: normalizeCodeLikeField(rawPayload.keyword, 'keyword')
  }
}

function normalizeSubjectUpdatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '更新科目 payload 格式不正确')
  return {
    subjectId: normalizePositiveInteger(rawPayload.subjectId, 'subjectId', '缺少科目 subjectId'),
    name: normalizeOptionalStringField(rawPayload.name, 'name', 'name 必须为字符串'),
    auxiliaryCategories:
      rawPayload.auxiliaryCategories === undefined
        ? undefined
        : normalizeStringArray(rawPayload.auxiliaryCategories, 'auxiliaryCategories'),
    customAuxiliaryItemIds:
      rawPayload.customAuxiliaryItemIds === undefined
        ? undefined
        : normalizePositiveIntegerArray(rawPayload.customAuxiliaryItemIds, 'customAuxiliaryItemIds'),
    isCashFlow:
      rawPayload.isCashFlow === undefined
        ? undefined
        : normalizeBooleanField(rawPayload.isCashFlow, 'isCashFlow')
  }
}

function normalizeSubjectIdPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '科目 payload 格式不正确')
  return {
    subjectId: normalizePositiveInteger(rawPayload.subjectId, 'subjectId', '缺少科目 subjectId')
  }
}

function normalizeAuxiliaryListPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '查询辅助核算 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    category: normalizeOptionalStringField(rawPayload.category, 'category', 'category 必须为字符串')
  }
}

function normalizeAuxiliaryCreatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '创建辅助核算 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    category: normalizeStringField(rawPayload.category, 'category', '辅助核算类别不能为空'),
    code: normalizeCodeLikeField(rawPayload.code, 'code'),
    name: normalizeStringField(rawPayload.name, 'name', '辅助核算名称不能为空')
  }
}

function normalizeAuxiliaryUpdatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '更新辅助核算 payload 格式不正确')
  return {
    id: normalizePositiveInteger(rawPayload.id, 'id', '缺少辅助核算 id'),
    code: normalizeOptionalCodeLikeField(rawPayload.code, 'code'),
    name: normalizeOptionalStringField(rawPayload.name, 'name', 'name 必须为字符串')
  }
}

function normalizeIdPayload(payload: unknown, message: string) {
  const rawPayload = asCommandPayloadRecord(payload, message)
  return {
    id: normalizePositiveInteger(rawPayload.id, 'id', '缺少 id')
  }
}

function normalizeCashFlowMappingCreatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '创建现金流映射 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    subjectCode: normalizeCodeLikeField(rawPayload.subjectCode, 'subjectCode'),
    counterpartSubjectCode: normalizeCodeLikeField(
      rawPayload.counterpartSubjectCode,
      'counterpartSubjectCode'
    ),
    entryDirection: normalizeStringField(rawPayload.entryDirection, 'entryDirection'),
    cashFlowItemId: normalizePositiveInteger(
      rawPayload.cashFlowItemId,
      'cashFlowItemId',
      '缺少现金流量项目 cashFlowItemId'
    )
  }
}

function normalizeCashFlowMappingUpdatePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '更新现金流映射 payload 格式不正确')
  return {
    id: normalizePositiveInteger(rawPayload.id, 'id', '缺少现金流映射 id'),
    subjectCode: normalizeCodeLikeField(rawPayload.subjectCode, 'subjectCode'),
    counterpartSubjectCode: normalizeCodeLikeField(
      rawPayload.counterpartSubjectCode,
      'counterpartSubjectCode'
    ),
    entryDirection: normalizeStringField(rawPayload.entryDirection, 'entryDirection'),
    cashFlowItemId: normalizePositiveInteger(
      rawPayload.cashFlowItemId,
      'cashFlowItemId',
      '缺少现金流量项目 cashFlowItemId'
    )
  }
}

export async function listSubjectsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listSubjects>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload, '查询科目 payload 格式不正确')
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listSubjects(context.db, normalizedPayload.ledgerId)
  })
}

export async function createSubjectCommand(
  context: CommandContext,
  payload: Parameters<typeof createSubject>[1]
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeSubjectCreatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const subjectId = createSubject(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'subject',
      action: 'create',
      targetType: 'subject',
      targetId: subjectId,
      details: {
        code: normalizedPayload.code,
        parentCode: normalizedPayload.parentCode
      }
    })
    return { subjectId }
  })
}

export async function searchSubjectsCommand(
  context: CommandContext,
  payload: { ledgerId: number; keyword: string }
): Promise<CommandResult<ReturnType<typeof searchSubjects>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeSubjectSearchPayload(payload)
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return searchSubjects(context.db, normalizedPayload.ledgerId, normalizedPayload.keyword)
  })
}

export async function updateSubjectCommand(
  context: CommandContext,
  payload: Parameters<typeof updateSubject>[1]
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeSubjectUpdatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    const subject = context.db
      .prepare('SELECT ledger_id FROM subjects WHERE id = ?')
      .get(normalizedPayload.subjectId) as { ledger_id: number } | undefined
    if (!subject) {
      throw new Error('科目不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, subject.ledger_id)
    updateSubject(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: subject.ledger_id,
      module: 'subject',
      action: 'update',
      targetType: 'subject',
      targetId: normalizedPayload.subjectId
    })
    return { subjectId: normalizedPayload.subjectId }
  })
}

export async function deleteSubjectCommand(
  context: CommandContext,
  payload: { subjectId: number }
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeSubjectIdPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    const subject = context.db
      .prepare('SELECT ledger_id, is_system FROM subjects WHERE id = ?')
      .get(normalizedPayload.subjectId) as { ledger_id: number; is_system: number } | undefined
    if (!subject) {
      throw new Error('科目不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, subject.ledger_id)
    if (subject.is_system === 1) {
      throw new Error('系统科目不可删除')
    }
    context.db.prepare('DELETE FROM subjects WHERE id = ?').run(normalizedPayload.subjectId)
    appendActorOperationLog(context, {
      ledgerId: subject.ledger_id,
      module: 'subject',
      action: 'delete',
      targetType: 'subject',
      targetId: normalizedPayload.subjectId
    })
    return { subjectId: normalizedPayload.subjectId }
  })
}

export async function listAuxiliaryItemsCommand(
  context: CommandContext,
  payload: { ledgerId: number; category?: string }
): Promise<CommandResult<ReturnType<typeof listAuxiliaryItems>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeAuxiliaryListPayload(payload)
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listAuxiliaryItems(context.db, normalizedPayload.ledgerId, normalizedPayload.category)
  })
}

export async function createAuxiliaryItemCommand(
  context: CommandContext,
  payload: Parameters<typeof createAuxiliaryItem>[1]
): Promise<CommandResult<{ auxiliaryItemId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeAuxiliaryCreatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const auxiliaryItemId = createAuxiliaryItem(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'auxiliary',
      action: 'create',
      targetType: 'auxiliary_item',
      targetId: auxiliaryItemId,
      details: {
        category: normalizedPayload.category,
        code: normalizedPayload.code
      }
    })
    return { auxiliaryItemId }
  })
}

export async function updateAuxiliaryItemCommand(
  context: CommandContext,
  payload: Parameters<typeof updateAuxiliaryItem>[1]
): Promise<CommandResult<{ auxiliaryItemId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeAuxiliaryUpdatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    const item = context.db
      .prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?')
      .get(normalizedPayload.id) as { ledger_id: number } | undefined
    if (!item) {
      throw new Error('辅助账不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, item.ledger_id)
    updateAuxiliaryItem(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: item.ledger_id,
      module: 'auxiliary',
      action: 'update',
      targetType: 'auxiliary_item',
      targetId: normalizedPayload.id
    })
    return { auxiliaryItemId: normalizedPayload.id }
  })
}

export async function deleteAuxiliaryItemCommand(
  context: CommandContext,
  payload: { id: number }
): Promise<CommandResult<{ auxiliaryItemId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeIdPayload(payload, '删除辅助核算 payload 格式不正确')
    requireCommandPermission(context.actor, 'ledger_settings')
    const item = context.db
      .prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?')
      .get(normalizedPayload.id) as { ledger_id: number } | undefined
    if (!item) {
      throw new Error('辅助账不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, item.ledger_id)
    deleteAuxiliaryItem(context.db, normalizedPayload.id)
    appendActorOperationLog(context, {
      ledgerId: item.ledger_id,
      module: 'auxiliary',
      action: 'delete',
      targetType: 'auxiliary_item',
      targetId: normalizedPayload.id
    })
    return { auxiliaryItemId: normalizedPayload.id }
  })
}

export async function listCashFlowMappingsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listCashFlowMappings>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload, '查询现金流映射 payload 格式不正确')
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listCashFlowMappings(context.db, normalizedPayload.ledgerId)
  })
}

export async function listCashFlowItemsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listCashFlowItems>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload, '查询现金流项目 payload 格式不正确')
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listCashFlowItems(context.db, normalizedPayload.ledgerId)
  })
}

export async function createCashFlowMappingCommand(
  context: CommandContext,
  payload: Parameters<typeof createCashFlowMapping>[1]
): Promise<CommandResult<{ mappingId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeCashFlowMappingCreatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const mappingId = createCashFlowMapping(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'cashflow',
      action: 'create_mapping',
      targetType: 'cash_flow_mapping',
      targetId: mappingId
    })
    return { mappingId }
  })
}

export async function updateCashFlowMappingCommand(
  context: CommandContext,
  payload: Parameters<typeof updateCashFlowMapping>[1]
): Promise<CommandResult<{ mappingId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeCashFlowMappingUpdatePayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    const mapping = context.db
      .prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?')
      .get(normalizedPayload.id) as { ledger_id: number } | undefined
    if (!mapping) {
      throw new Error('现金流匹配规则不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, mapping.ledger_id)
    updateCashFlowMapping(context.db, normalizedPayload)
    appendActorOperationLog(context, {
      ledgerId: mapping.ledger_id,
      module: 'cashflow',
      action: 'update_mapping',
      targetType: 'cash_flow_mapping',
      targetId: normalizedPayload.id
    })
    return { mappingId: normalizedPayload.id }
  })
}

export async function deleteCashFlowMappingCommand(
  context: CommandContext,
  payload: { id: number }
): Promise<CommandResult<{ mappingId: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeIdPayload(payload, '删除现金流映射 payload 格式不正确')
    requireCommandPermission(context.actor, 'ledger_settings')
    const mapping = context.db
      .prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?')
      .get(normalizedPayload.id) as { ledger_id: number } | undefined
    if (!mapping) {
      throw new Error('现金流匹配规则不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, mapping.ledger_id)
    deleteCashFlowMapping(context.db, normalizedPayload.id)
    appendActorOperationLog(context, {
      ledgerId: mapping.ledger_id,
      module: 'cashflow',
      action: 'delete_mapping',
      targetType: 'cash_flow_mapping',
      targetId: normalizedPayload.id
    })
    return { mappingId: normalizedPayload.id }
  })
}

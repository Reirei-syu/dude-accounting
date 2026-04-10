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
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

export async function listSubjectsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listSubjects>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listSubjects(context.db, payload.ledgerId)
  })
}

export async function createSubjectCommand(
  context: CommandContext,
  payload: Parameters<typeof createSubject>[1]
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const subjectId = createSubject(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'subject',
      action: 'create',
      targetType: 'subject',
      targetId: subjectId,
      details: {
        code: payload.code,
        parentCode: payload.parentCode
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
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return searchSubjects(context.db, payload.ledgerId, payload.keyword)
  })
}

export async function updateSubjectCommand(
  context: CommandContext,
  payload: Parameters<typeof updateSubject>[1]
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const subject = context.db
      .prepare('SELECT ledger_id FROM subjects WHERE id = ?')
      .get(payload.subjectId) as { ledger_id: number } | undefined
    if (!subject) {
      throw new Error('科目不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, subject.ledger_id)
    updateSubject(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: subject.ledger_id,
      module: 'subject',
      action: 'update',
      targetType: 'subject',
      targetId: payload.subjectId
    })
    return { subjectId: payload.subjectId }
  })
}

export async function deleteSubjectCommand(
  context: CommandContext,
  payload: { subjectId: number }
): Promise<CommandResult<{ subjectId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const subject = context.db
      .prepare('SELECT ledger_id, is_system FROM subjects WHERE id = ?')
      .get(payload.subjectId) as { ledger_id: number; is_system: number } | undefined
    if (!subject) {
      throw new Error('科目不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, subject.ledger_id)
    if (subject.is_system === 1) {
      throw new Error('系统科目不可删除')
    }
    context.db.prepare('DELETE FROM subjects WHERE id = ?').run(payload.subjectId)
    appendActorOperationLog(context, {
      ledgerId: subject.ledger_id,
      module: 'subject',
      action: 'delete',
      targetType: 'subject',
      targetId: payload.subjectId
    })
    return { subjectId: payload.subjectId }
  })
}

export async function listAuxiliaryItemsCommand(
  context: CommandContext,
  payload: { ledgerId: number; category?: string }
): Promise<CommandResult<ReturnType<typeof listAuxiliaryItems>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listAuxiliaryItems(context.db, payload.ledgerId, payload.category)
  })
}

export async function createAuxiliaryItemCommand(
  context: CommandContext,
  payload: Parameters<typeof createAuxiliaryItem>[1]
): Promise<CommandResult<{ auxiliaryItemId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const auxiliaryItemId = createAuxiliaryItem(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'auxiliary',
      action: 'create',
      targetType: 'auxiliary_item',
      targetId: auxiliaryItemId,
      details: {
        category: payload.category,
        code: payload.code
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
    requireCommandPermission(context.actor, 'ledger_settings')
    const item = context.db
      .prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?')
      .get(payload.id) as { ledger_id: number } | undefined
    if (!item) {
      throw new Error('辅助账不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, item.ledger_id)
    updateAuxiliaryItem(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: item.ledger_id,
      module: 'auxiliary',
      action: 'update',
      targetType: 'auxiliary_item',
      targetId: payload.id
    })
    return { auxiliaryItemId: payload.id }
  })
}

export async function deleteAuxiliaryItemCommand(
  context: CommandContext,
  payload: { id: number }
): Promise<CommandResult<{ auxiliaryItemId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const item = context.db
      .prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?')
      .get(payload.id) as { ledger_id: number } | undefined
    if (!item) {
      throw new Error('辅助账不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, item.ledger_id)
    deleteAuxiliaryItem(context.db, payload.id)
    appendActorOperationLog(context, {
      ledgerId: item.ledger_id,
      module: 'auxiliary',
      action: 'delete',
      targetType: 'auxiliary_item',
      targetId: payload.id
    })
    return { auxiliaryItemId: payload.id }
  })
}

export async function listCashFlowMappingsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listCashFlowMappings>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listCashFlowMappings(context.db, payload.ledgerId)
  })
}

export async function listCashFlowItemsCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listCashFlowItems>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listCashFlowItems(context.db, payload.ledgerId)
  })
}

export async function createCashFlowMappingCommand(
  context: CommandContext,
  payload: Parameters<typeof createCashFlowMapping>[1]
): Promise<CommandResult<{ mappingId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const mappingId = createCashFlowMapping(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
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
    requireCommandPermission(context.actor, 'ledger_settings')
    const mapping = context.db
      .prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?')
      .get(payload.id) as { ledger_id: number } | undefined
    if (!mapping) {
      throw new Error('现金流匹配规则不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, mapping.ledger_id)
    updateCashFlowMapping(context.db, payload)
    appendActorOperationLog(context, {
      ledgerId: mapping.ledger_id,
      module: 'cashflow',
      action: 'update_mapping',
      targetType: 'cash_flow_mapping',
      targetId: payload.id
    })
    return { mappingId: payload.id }
  })
}

export async function deleteCashFlowMappingCommand(
  context: CommandContext,
  payload: { id: number }
): Promise<CommandResult<{ mappingId: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const mapping = context.db
      .prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?')
      .get(payload.id) as { ledger_id: number } | undefined
    if (!mapping) {
      throw new Error('现金流匹配规则不存在')
    }
    requireCommandLedgerAccess(context.db, context.actor, mapping.ledger_id)
    deleteCashFlowMapping(context.db, payload.id)
    appendActorOperationLog(context, {
      ledgerId: mapping.ledger_id,
      module: 'cashflow',
      action: 'delete_mapping',
      targetType: 'cash_flow_mapping',
      targetId: payload.id
    })
    return { mappingId: payload.id }
  })
}

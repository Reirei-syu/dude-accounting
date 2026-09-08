import path from 'node:path'
import { createHash } from 'node:crypto'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { FileOperationLifecycle } from '../services/fileOperationLifecycle'
import { fileOperationFileExportRecovery, prepareFileOperationFileExport } from '../services/fileOperationFileExport'
import { fileOperationCommandError } from './fileOperationError'
import { resolveSessionActor } from '../security/sessionAuthority'
import { listAuditableOperations } from '../services/fileOperationAudit'
import { exportOperationLogsAsCsv, listOperationLogs, type OperationLogFilters } from '../services/auditLog'
import { requireCommandAdmin } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

export async function listAuditLogsCommand(
  context: CommandContext,
  filters: OperationLogFilters = {}
): Promise<CommandResult<ReturnType<typeof listOperationLogs>>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    return listAuditableOperations(context.db, filters)
  })
}

export async function exportAuditLogsCommand(
  context: CommandContext,
  payload: { filters?: OperationLogFilters; filePath?: string; operationId?: string } = {}
): Promise<CommandResult<{ csv?: string; filePath?: string; rowCount: number; operationId?: string }>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    const rows = listAuditableOperations(context.db, payload.filters ?? {})
    const csv = exportOperationLogsAsCsv(rows)
    if (payload.filePath) {
      const actor = requireCommandAdmin(context.actor)
      const operationId = requireOperationId(payload.operationId)
      const target = payload.filePath
      const journal = new FileOperationJournal(context.db.name)
      try {
        return new FileOperationLifecycle(journal, context.db).execute(
          { operationId, kind: 'audit_log_export', actorId: actor.id, username: actor.username,
            ledgerId: null, requestHash: createHash('sha256').update(JSON.stringify([path.resolve(target), payload.filters ?? {}])).digest('hex') },
          fileOperationFileExportRecovery,
          lease => { prepareFileOperationFileExport(journal, lease, operationId, target, csv) },
          () => {
            context.actor = resolveSessionActor(context.db, actor.session, actor.source)
            requireCommandAdmin(context.actor)
            appendActorOperationLog(context, { module: 'audit_log', action: 'export', details: { operationId, rowCount: rows.length } })
            return { operationId, rowCount: rows.length, filePath: target }
          }
        )
      } catch (error) { throw fileOperationCommandError(error, operationId, journal) }
      finally { journal.close() }
    }
    appendActorOperationLog(context, {
      module: 'audit_log',
      action: 'export',
      details: {
        rowCount: rows.length,
        filePath: payload.filePath ?? null
      }
    })
    return {
      rowCount: rows.length,
      filePath: payload.filePath,
      csv: payload.filePath ? undefined : csv
    }
  })
}

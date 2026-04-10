import fs from 'node:fs'
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
    return listOperationLogs(context.db, filters)
  })
}

export async function exportAuditLogsCommand(
  context: CommandContext,
  payload: { filters?: OperationLogFilters; filePath?: string } = {}
): Promise<CommandResult<{ csv?: string; filePath?: string; rowCount: number }>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    const rows = listOperationLogs(context.db, payload.filters ?? {})
    const csv = exportOperationLogsAsCsv(rows)
    if (payload.filePath) {
      fs.writeFileSync(payload.filePath, csv, 'utf8')
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

import fs from 'node:fs'
import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  appendOperationLog,
  exportOperationLogsAsCsv,
  listOperationLogs,
  type OperationLogFilters
} from '../services/auditLog'
import { requireAdmin } from './session'

export function registerAuditLogHandlers(): void {
  ipcMain.handle('auditLog:list', (event, filters?: OperationLogFilters) => {
    requireAdmin(event)
    return listOperationLogs(getDatabase(), filters ?? {})
  })

  ipcMain.handle(
    'auditLog:export',
    (
      event,
      payload?: {
        filters?: OperationLogFilters
        filePath?: string
      }
    ) => {
      try {
        const user = requireAdmin(event)
        const db = getDatabase()
        const rows = listOperationLogs(db, payload?.filters ?? {})
        const csv = exportOperationLogsAsCsv(rows)

        if (payload?.filePath) {
          fs.writeFileSync(payload.filePath, csv, 'utf8')
        }

        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'audit_log',
          action: 'export',
          details: {
            rowCount: rows.length,
            filePath: payload?.filePath ?? null
          }
        })

        return {
          success: true,
          rowCount: rows.length,
          filePath: payload?.filePath,
          csv: payload?.filePath ? undefined : csv
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '导出操作日志失败'
        }
      }
    }
  )
}

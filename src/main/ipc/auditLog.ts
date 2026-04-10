import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { exportAuditLogsCommand, listAuditLogsCommand } from '../commands/auditLogCommands'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import type { OperationLogFilters } from '../services/auditLog'

export function registerAuditLogHandlers(): void {
  getDatabase()

  ipcMain.handle('auditLog:list', async (event, filters?: OperationLogFilters) => {
    const result = await listAuditLogsCommand(createCommandContextFromEvent(event), filters ?? {})
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取操作日志失败')
  })

  ipcMain.handle(
    'auditLog:export',
    async (
      event,
      payload?: {
        filters?: OperationLogFilters
        filePath?: string
      }
    ) => {
      const result = await exportAuditLogsCommand(createCommandContextFromEvent(event), payload)
      if (isCommandSuccess(result)) {
        return {
          success: true,
          ...result.data
        }
      }

      return {
        success: false,
        error: result.error?.message ?? '导出操作日志失败'
      }
    }
  )
}

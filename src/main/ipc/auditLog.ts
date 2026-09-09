import { handleInvoke } from './typedInvoke'
import { BrowserWindow, dialog } from 'electron'
import { getDatabase } from '../database/init'
import { exportAuditLogsCommand, listAuditLogsCommand } from '../commands/auditLogCommands'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import type { OperationLogFilters } from '../services/auditLog'
import { requireCommandAdmin } from '../commands/authz'
import { withCommandResult } from '../commands/result'
import { SESSION_DENIED_MESSAGE } from '../security/sessionAuthority'

export function registerAuditLogHandlers(): void {
  getDatabase()

  handleInvoke('auditLog:list', async (event, filters?: OperationLogFilters) => {
    const result = await listAuditLogsCommand(createCommandContextFromEvent(event), filters ?? {})
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取操作日志失败')
  })

  handleInvoke(
    'auditLog:export',
    async (
      event,
      payload?: {
        filters?: OperationLogFilters
        filePath?: string
        operationId?: string
        choosePath?: boolean
      }
    ) => {
      const context = createCommandContextFromEvent(event)
      if (payload?.choosePath) {
        const authorization = await withCommandResult(context, () =>
          requireCommandAdmin(context.actor)
        )
        if (!isCommandSuccess(authorization)) {
          return { success: false, error: authorization.error?.message ?? '无权限导出操作日志' }
        }
        const parent = BrowserWindow.fromWebContents(event.sender)
        const options = {
          title: '导出当前页操作日志',
          defaultPath: '操作日志.csv',
          filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
        }
        const selected = parent
          ? await dialog.showSaveDialog(parent, options)
          : await dialog.showSaveDialog(options)
        if (selected.canceled || !selected.filePath) return { success: false, cancelled: true }
        let sameSession = false
        try {
          const current = createCommandContextFromEvent(event).actor?.session
          const initial = context.actor?.session
          sameSession = Boolean(
            initial &&
            current &&
            initial.userId === current.userId &&
            initial.token === current.token &&
            initial.authRevision === current.authRevision &&
            initial.createdAt === current.createdAt
          )
        } catch {
          /* 已失效会话不能将旧操作移交给其他账号。 */
        }
        if (!sameSession)
          return { success: false, error: SESSION_DENIED_MESSAGE, errorCode: 'UNAUTHORIZED' }
        payload = { ...payload, filePath: selected.filePath }
      }
      // 对话框等待期间权限可能已撤销，命令入口必须再次刷新会话。
      const result = await exportAuditLogsCommand(context, payload)
      if (isCommandSuccess(result)) {
        return {
          success: true,
          ...result.data
        }
      }

      return {
        success: false,
        error: result.error?.message ?? '导出操作日志失败',
        errorCode: result.error?.code,
        details: result.error?.details
      }
    }
  )
}

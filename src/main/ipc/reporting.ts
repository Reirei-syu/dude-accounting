import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  deleteReportCommand,
  exportReportCommand,
  exportReportsBatchCommand,
  generateReportCommand,
  getReportDetailCommand,
  listReportsCommand
} from '../commands/reportingCommands'
import {
  buildReportExportDefaultPath,
  getPreferredReportExportDir,
  getReportExportFilters,
  rememberReportExportDir
} from '../services/reportExport'
import {
  type ReportExportFormat,
  type GenerateReportSnapshotParams,
  type ReportListFilters,
  type ReportSnapshotDetail
} from '../services/reporting'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

function toLegacyFailure(
  error:
    | {
        message?: string | null
        code?: string | null
        details?: Record<string, unknown> | null
      }
    | null
    | undefined,
  fallbackMessage: string
): {
  success: false
  error: string
  errorCode: string
  errorDetails: Record<string, unknown> | null
} {
  return {
    success: false,
    error: error?.message ?? fallbackMessage,
    errorCode: error?.code ?? 'INTERNAL_ERROR',
    errorDetails: error?.details ?? null
  }
}

export function registerReportingHandlers(): void {
  ipcMain.handle('reporting:list', (event, filters: ReportListFilters) =>
    withIpcTelemetry(
      {
        channel: 'reporting:list',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: filters.ledgerId,
          reportTypeCount: filters.reportTypes?.length ?? 0,
          periodCount: filters.periods?.length ?? 0
        }
      },
      async () => {
        const result = await listReportsCommand(createCommandContextFromEvent(event), filters)
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取报表列表失败')
      }
    )
  )

  ipcMain.handle(
    'reporting:getDetail',
    (event, payload: { snapshotId: number; ledgerId?: number }) =>
      withIpcTelemetry(
        {
          channel: 'reporting:getDetail',
          baseDir: app.getPath('userData'),
          context: {
            snapshotId: payload.snapshotId,
            ledgerId: payload.ledgerId ?? null
          }
        },
        async () => {
          const result = await getReportDetailCommand(createCommandContextFromEvent(event), payload)
          if (isCommandSuccess(result)) {
            return result.data
          }

          throw new Error(result.error?.message ?? '获取报表详情失败')
        }
      )
  )

  ipcMain.handle(
    'reporting:export',
    async (
      event,
      payload: {
        snapshotId: number
        ledgerId?: number
        format: ReportExportFormat
        filePath?: string
        renderOptions?: {
          showCashflowPreviousAmount?: boolean
        }
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'reporting:export',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId ?? null,
            snapshotId: payload.snapshotId,
            format: payload.format
          }
        },
        async () => {
          try {
            const db = getDatabase()
            const detailResult = await getReportDetailCommand(
              createCommandContextFromEvent(event),
              {
                snapshotId: payload.snapshotId,
                ledgerId: payload.ledgerId
              }
            )
            if (!isCommandSuccess(detailResult)) {
              return toLegacyFailure(detailResult.error, '获取报表详情失败')
            }
            const detail: ReportSnapshotDetail = detailResult.data
            const preferredDir = getPreferredReportExportDir(db, app.getPath('documents'))
            const defaultPath = buildReportExportDefaultPath(preferredDir, detail, payload.format)
            const browserWindow = BrowserWindow.fromWebContents(event.sender)
            const saveResult = payload.filePath
              ? { canceled: false, filePath: payload.filePath }
              : browserWindow
                ? await dialog.showSaveDialog(browserWindow, {
                    defaultPath,
                    filters: getReportExportFilters(payload.format)
                  })
                : await dialog.showSaveDialog({
                    defaultPath,
                    filters: getReportExportFilters(payload.format)
                  })

            if (saveResult.canceled || !saveResult.filePath) {
              return {
                success: false,
                cancelled: true
              }
            }

            const result = await exportReportCommand(createCommandContextFromEvent(event), {
              ...payload,
              filePath: saveResult.filePath
            })
            if (!isCommandSuccess(result)) {
              return toLegacyFailure(result.error, '导出报表失败')
            }
            const exportPath = result.data.filePath
            rememberReportExportDir(db, exportPath)

            return {
              success: true,
              filePath: exportPath
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '导出报表失败',
              errorCode: 'INTERNAL_ERROR',
              errorDetails: null
            }
          }
        }
      )
  )

  ipcMain.handle(
    'reporting:exportBatch',
    async (
      event,
      payload: {
        snapshotIds: number[]
        ledgerId?: number
        format: ReportExportFormat
        directoryPath?: string
        renderOptions?: {
          showCashflowPreviousAmount?: boolean
        }
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'reporting:exportBatch',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId ?? null,
            snapshotCount: Array.isArray(payload.snapshotIds) ? payload.snapshotIds.length : 0,
            format: payload.format
          }
        },
        async () => {
          try {
            const db = getDatabase()

            if (!Array.isArray(payload.snapshotIds) || payload.snapshotIds.length === 0) {
              return {
                success: false,
                error: '请先选择至少一张报表',
                errorCode: 'VALIDATION_ERROR',
                errorDetails: null
              }
            }

            const detailResults = await Promise.all(
              payload.snapshotIds.map((snapshotId) =>
                getReportDetailCommand(createCommandContextFromEvent(event), {
                  snapshotId,
                  ledgerId: payload.ledgerId
                })
              )
            )
            const failedDetailResult = detailResults.find((result) => !isCommandSuccess(result))
            if (failedDetailResult && !isCommandSuccess(failedDetailResult)) {
              return toLegacyFailure(failedDetailResult.error, '获取报表详情失败')
            }
            const preferredDir = getPreferredReportExportDir(db, app.getPath('documents'))
            const browserWindow = BrowserWindow.fromWebContents(event.sender)
            const openResult = payload.directoryPath
              ? { canceled: false, filePaths: [payload.directoryPath] }
              : browserWindow
                ? await dialog.showOpenDialog(browserWindow, {
                    defaultPath: preferredDir,
                    properties: ['openDirectory', 'createDirectory']
                  })
                : await dialog.showOpenDialog({
                    defaultPath: preferredDir,
                    properties: ['openDirectory', 'createDirectory']
                  })

            if (openResult.canceled || openResult.filePaths.length === 0) {
              return { success: false, cancelled: true }
            }

            const directoryPath = openResult.filePaths[0]
            const result = await exportReportsBatchCommand(createCommandContextFromEvent(event), {
              ...payload,
              directoryPath
            })
            if (!isCommandSuccess(result)) {
              return toLegacyFailure(result.error, '批量导出报表失败')
            }
            const filePaths = result.data.filePaths
            rememberReportExportDir(db, directoryPath)

            return {
              success: true,
              directoryPath,
              filePaths
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '批量导出报表失败',
              errorCode: 'INTERNAL_ERROR',
              errorDetails: null
            }
          }
        }
      )
  )

  ipcMain.handle('reporting:delete', (event, payload: { snapshotId: number; ledgerId: number }) =>
    withIpcTelemetry(
      {
        channel: 'reporting:delete',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: payload.ledgerId,
          snapshotId: payload.snapshotId
        }
      },
      async () => {
        return toLegacySuccess(
          await deleteReportCommand(createCommandContextFromEvent(event), payload),
          () => ({})
        )
      }
    )
  )

  ipcMain.handle('reporting:generate', (event, payload: GenerateReportSnapshotParams) =>
    withIpcTelemetry(
      {
        channel: 'reporting:generate',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: payload.ledgerId,
          reportType: payload.reportType,
          month: payload.month ?? null,
          startPeriod: payload.startPeriod ?? null,
          endPeriod: payload.endPeriod ?? null,
          includeUnpostedVouchers: payload.includeUnpostedVouchers === true
        }
      },
      async () => {
        return toLegacySuccess(
          await generateReportCommand(createCommandContextFromEvent(event), payload),
          (commandData) => ({
            snapshot: commandData.snapshot
          })
        )
      }
    )
  )
}

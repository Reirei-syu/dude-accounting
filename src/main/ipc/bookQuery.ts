import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  exportBookQueryCommand,
  getAuxiliaryBalancesCommand,
  getAuxiliaryDetailCommand,
  getDetailLedgerCommand,
  getJournalCommand,
  listSubjectBalancesCommand
} from '../commands/reportingCommands'
import {
  buildBookQueryExportDefaultPath,
  getBookQueryExportFilters,
  getPreferredBookQueryExportDir,
  rememberBookQueryExportDir,
  type BookQueryExportPayload
} from '../services/bookQueryExport'
import type {
  AuxiliaryBalanceQuery,
  AuxiliaryDetailQuery,
  DetailLedgerQuery,
  JournalQuery,
  SubjectBalanceQuery
} from '../services/bookQuery'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'

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

export function registerBookQueryHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('bookQuery:listSubjectBalances', (event, query: SubjectBalanceQuery) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:listSubjectBalances',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: query.ledgerId,
          hasKeyword: Boolean(query.keyword),
          includeUnpostedVouchers: query.includeUnpostedVouchers === true,
          includeZeroBalance: query.includeZeroBalance === true
        }
      },
      async () => {
        const result = await listSubjectBalancesCommand(createCommandContextFromEvent(event), query)
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取科目余额表失败')
      }
    )
  )

  ipcMain.handle('bookQuery:getDetailLedger', (event, query: DetailLedgerQuery) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:getDetailLedger',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: query.ledgerId,
          subjectCode: query.subjectCode,
          includeUnpostedVouchers: query.includeUnpostedVouchers === true
        }
      },
      async () => {
        const result = await getDetailLedgerCommand(createCommandContextFromEvent(event), query)
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取明细账失败')
      }
    )
  )

  ipcMain.handle('bookQuery:getJournal', (event, query: JournalQuery) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:getJournal',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: query.ledgerId,
          hasSubjectCodeStart: Boolean(query.subjectCodeStart),
          hasSubjectCodeEnd: Boolean(query.subjectCodeEnd),
          includeUnpostedVouchers: query.includeUnpostedVouchers === true
        }
      },
      async () => {
        const result = await getJournalCommand(createCommandContextFromEvent(event), query)
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取序时账失败')
      }
    )
  )

  ipcMain.handle('bookQuery:getAuxiliaryBalances', (event, query: AuxiliaryBalanceQuery) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:getAuxiliaryBalances',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: query.ledgerId,
          hasSubjectCodeStart: Boolean(query.subjectCodeStart),
          hasSubjectCodeEnd: Boolean(query.subjectCodeEnd),
          includeUnpostedVouchers: query.includeUnpostedVouchers === true
        }
      },
      async () => {
        const result = await getAuxiliaryBalancesCommand(
          createCommandContextFromEvent(event),
          query
        )
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取辅助余额表失败')
      }
    )
  )

  ipcMain.handle('bookQuery:getAuxiliaryDetail', (event, query: AuxiliaryDetailQuery) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:getAuxiliaryDetail',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: query.ledgerId,
          subjectCode: query.subjectCode,
          auxiliaryItemId: query.auxiliaryItemId,
          includeUnpostedVouchers: query.includeUnpostedVouchers === true
        }
      },
      async () => {
        const result = await getAuxiliaryDetailCommand(createCommandContextFromEvent(event), query)
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取辅助明细账失败')
      }
    )
  )

  ipcMain.handle('bookQuery:export', async (event, payload: BookQueryExportPayload) =>
    withIpcTelemetry(
      {
        channel: 'bookQuery:export',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: payload.ledgerId,
          bookType: payload.bookType,
          format: payload.format,
          columnCount: Array.isArray(payload.columns) ? payload.columns.length : 0,
          rowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
          hasFilePath: Boolean(payload.filePath)
        }
      },
      async () => {
        try {
          if (!payload.ledgerId) {
            return {
              success: false,
              error: '请选择账套',
              errorCode: 'VALIDATION_ERROR',
              errorDetails: null
            }
          }
          if (typeof payload.title !== 'string' || !payload.title.trim()) {
            return {
              success: false,
              error: '导出标题不能为空',
              errorCode: 'VALIDATION_ERROR',
              errorDetails: null
            }
          }
          if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
            return {
              success: false,
              error: '导出列不能为空',
              errorCode: 'VALIDATION_ERROR',
              errorDetails: null
            }
          }

          const preferredDir = getPreferredBookQueryExportDir(db, app.getPath('documents'))
          const defaultPath = buildBookQueryExportDefaultPath(preferredDir, payload)
          const browserWindow = BrowserWindow.fromWebContents(event.sender)
          const saveResult = payload.filePath
            ? { canceled: false, filePath: payload.filePath }
            : browserWindow
              ? await dialog.showSaveDialog(browserWindow, {
                  defaultPath,
                  filters: getBookQueryExportFilters(payload.format)
                })
              : await dialog.showSaveDialog({
                  defaultPath,
                  filters: getBookQueryExportFilters(payload.format)
                })

          if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, cancelled: true }
          }

          const result = await exportBookQueryCommand(createCommandContextFromEvent(event), {
            ...payload,
            filePath: saveResult.filePath
          })
          if (!isCommandSuccess(result)) {
            return toLegacyFailure(result.error, '导出账簿失败')
          }
          const exportPath = result.data.filePath
          rememberBookQueryExportDir(db, exportPath)

          return {
            success: true,
            filePath: exportPath
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '导出账簿失败',
            errorCode: 'INTERNAL_ERROR',
            errorDetails: null
          }
        }
      }
    )
  )
}

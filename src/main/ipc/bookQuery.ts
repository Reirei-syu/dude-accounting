import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildBookQueryExportDefaultPath,
  exportBookQueryToFile,
  getBookQueryExportFilters,
  getPreferredBookQueryExportDir,
  normalizeBookQueryExportPayload,
  rememberBookQueryExportDir,
  type BookQueryExportPayload
} from '../services/bookQueryExport'
import {
  getAuxiliaryBalances,
  getAuxiliaryDetail,
  getDetailLedger,
  getJournal,
  listSubjectBalances,
  type AuxiliaryBalanceQuery,
  type AuxiliaryDetailQuery,
  type DetailLedgerQuery,
  type JournalQuery,
  type SubjectBalanceQuery
} from '../services/bookQuery'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { requireAuth, requireLedgerAccess } from './session'

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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, query.ledgerId)
        return listSubjectBalances(db, query)
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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, query.ledgerId)
        return getDetailLedger(db, query)
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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, query.ledgerId)
        return getJournal(db, query)
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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, query.ledgerId)
        return getAuxiliaryBalances(db, query)
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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, query.ledgerId)
        return getAuxiliaryDetail(db, query)
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
          const user = requireAuth(event)

          if (!payload.ledgerId) {
            return { success: false, error: '请选择账套' }
          }
          requireLedgerAccess(event, db, payload.ledgerId)

          if (typeof payload.title !== 'string' || !payload.title.trim()) {
            return { success: false, error: '导出标题不能为空' }
          }

          if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
            return { success: false, error: '导出列不能为空' }
          }

          const exportPayload = normalizeBookQueryExportPayload(payload)
          const preferredDir = getPreferredBookQueryExportDir(db, app.getPath('documents'))
          const defaultPath = buildBookQueryExportDefaultPath(preferredDir, exportPayload)
          const browserWindow = BrowserWindow.fromWebContents(event.sender)
          const saveResult = exportPayload.filePath
            ? { canceled: false, filePath: exportPayload.filePath }
            : browserWindow
              ? await dialog.showSaveDialog(browserWindow, {
                  defaultPath,
                  filters: getBookQueryExportFilters(exportPayload.format)
                })
              : await dialog.showSaveDialog({
                  defaultPath,
                  filters: getBookQueryExportFilters(exportPayload.format)
                })

          if (saveResult.canceled || !saveResult.filePath) {
            return { success: false, cancelled: true }
          }

          const exportPath = await exportBookQueryToFile(exportPayload, saveResult.filePath)
          rememberBookQueryExportDir(db, exportPath)

          appendOperationLog(db, {
            ledgerId: exportPayload.ledgerId,
            userId: user.id,
            username: user.username,
            module: 'book_query',
            action: 'export',
            targetType: exportPayload.bookType,
            targetId: exportPayload.title,
            details: {
              title: exportPayload.title,
              subtitle: exportPayload.subtitle,
              format: exportPayload.format,
              rowCount: exportPayload.rows.length,
              exportPath
            }
          })

          return {
            success: true,
            filePath: exportPath
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '导出账簿失败'
          }
        }
      }
    )
  )
}

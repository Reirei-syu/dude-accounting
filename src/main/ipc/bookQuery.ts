import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildDefaultBookExportFileName,
  writeBookExportExcel,
  writeBookExportPdf,
  type BookExportColumn,
  type BookExportFormat,
  type BookExportRow
} from '../services/bookExport'
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
import { requireAuth } from './session'

const BOOK_QUERY_EXPORT_LAST_DIR_KEY = 'book_query_export_last_dir'

interface BookQueryExportPayload {
  ledgerId: number
  bookType: string
  title: string
  subtitle?: string
  ledgerName?: string
  subjectLabel?: string
  periodLabel?: string
  format: BookExportFormat
  columns: BookExportColumn[]
  rows: BookExportRow[]
  filePath?: string
}

function getBookQueryExportDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '账簿导出')
}

function getLastBookQueryExportDir(db: ReturnType<typeof getDatabase>): string | null {
  const row = db
    .prepare('SELECT value FROM system_settings WHERE key = ?')
    .get(BOOK_QUERY_EXPORT_LAST_DIR_KEY) as { value: string } | undefined
  return row?.value ?? null
}

function rememberBookQueryExportDir(db: ReturnType<typeof getDatabase>, targetPath: string): void {
  const directoryPath = path.extname(targetPath) ? path.dirname(targetPath) : targetPath
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(BOOK_QUERY_EXPORT_LAST_DIR_KEY, directoryPath)
}

async function exportBookQueryToPath(
  payload: BookQueryExportPayload,
  filePath: string
): Promise<string> {
  return payload.format === 'xlsx'
    ? writeBookExportExcel(filePath, payload)
    : writeBookExportPdf(filePath, payload)
}

export function registerBookQueryHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('bookQuery:listSubjectBalances', (event, query: SubjectBalanceQuery) => {
    requireAuth(event)
    return listSubjectBalances(db, query)
  })

  ipcMain.handle('bookQuery:getDetailLedger', (event, query: DetailLedgerQuery) => {
    requireAuth(event)
    return getDetailLedger(db, query)
  })

  ipcMain.handle('bookQuery:getJournal', (event, query: JournalQuery) => {
    requireAuth(event)
    return getJournal(db, query)
  })

  ipcMain.handle('bookQuery:getAuxiliaryBalances', (event, query: AuxiliaryBalanceQuery) => {
    requireAuth(event)
    return getAuxiliaryBalances(db, query)
  })

  ipcMain.handle('bookQuery:getAuxiliaryDetail', (event, query: AuxiliaryDetailQuery) => {
    requireAuth(event)
    return getAuxiliaryDetail(db, query)
  })

  ipcMain.handle('bookQuery:export', async (event, payload: BookQueryExportPayload) => {
    try {
      const user = requireAuth(event)

      if (!payload.ledgerId) {
        return { success: false, error: '请选择账套' }
      }

      if (!payload.title.trim()) {
        return { success: false, error: '导出标题不能为空' }
      }

      if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
        return { success: false, error: '导出列不能为空' }
      }

      const sanitizedRows = Array.isArray(payload.rows)
        ? payload.rows.map((row, rowIndex) => ({
            key: row.key || `row-${rowIndex + 1}`,
            cells: Array.isArray(row.cells)
              ? row.cells.map((cell) => ({
                  value: cell.value ?? '',
                  isAmount: cell.isAmount === true
                }))
              : []
          }))
        : []

      const exportPayload: BookQueryExportPayload = {
        ...payload,
        title: payload.title.trim(),
        subtitle: payload.subtitle?.trim() ?? '',
        ledgerName: payload.ledgerName?.trim() ?? '',
        columns: payload.columns.map((column, index) => ({
          key: column.key || `col_${index + 1}`,
          label: column.label,
          align: column.align
        })),
        rows: sanitizedRows
      }

      const preferredDir = getLastBookQueryExportDir(db) ?? getBookQueryExportDir()
      const defaultPath = path.join(
        preferredDir,
        buildDefaultBookExportFileName(exportPayload, exportPayload.format)
      )
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const saveResult = exportPayload.filePath
        ? { canceled: false, filePath: exportPayload.filePath }
        : browserWindow
          ? await dialog.showSaveDialog(browserWindow, {
              defaultPath,
              filters: [
                exportPayload.format === 'xlsx'
                  ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
                  : { name: 'PDF 文档', extensions: ['pdf'] }
              ]
            })
          : await dialog.showSaveDialog({
              defaultPath,
              filters: [
                exportPayload.format === 'xlsx'
                  ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
                  : { name: 'PDF 文档', extensions: ['pdf'] }
              ]
            })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true }
      }

      const exportPath = await exportBookQueryToPath(exportPayload, saveResult.filePath)
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
  })
}

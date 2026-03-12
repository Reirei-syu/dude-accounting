import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildDefaultReportExportFileName,
  buildReportSnapshotHtml,
  deleteReportSnapshot,
  generateReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots,
  writeReportSnapshotExcel,
  type ReportExportFormat,
  type GenerateReportSnapshotParams,
  type ReportListFilters
} from '../services/reporting'
import { requireAuth, requireLedgerAccess } from './session'

const REPORT_EXPORT_LAST_DIR_KEY = 'report_export_last_dir'

function getReportExportDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '报表导出')
}

function getLastReportExportDir(db: ReturnType<typeof getDatabase>): string | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(REPORT_EXPORT_LAST_DIR_KEY) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function rememberReportExportDir(db: ReturnType<typeof getDatabase>, targetPath: string): void {
  const directoryPath = path.extname(targetPath) ? path.dirname(targetPath) : targetPath
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(REPORT_EXPORT_LAST_DIR_KEY, directoryPath)
}

async function exportReportSnapshotToPath(
  detail: ReturnType<typeof getReportSnapshotDetail>,
  format: ReportExportFormat,
  filePath: string
): Promise<string> {
  return format === 'xlsx'
    ? writeReportSnapshotExcel(filePath, detail)
    : printReportHtmlToPdf(filePath, buildReportSnapshotHtml(detail))
}

async function printReportHtmlToPdf(filePath: string, html: string): Promise<string> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false
    }
  })

  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdfBuffer = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    })
    await import('node:fs/promises').then((fs) => fs.mkdir(path.dirname(filePath), { recursive: true }))
    await import('node:fs/promises').then((fs) => fs.writeFile(filePath, pdfBuffer))
    return filePath
  } finally {
    window.destroy()
  }
}

export function registerReportingHandlers(): void {
  ipcMain.handle('reporting:list', (event, filters: ReportListFilters) => {
    requireAuth(event)
    requireLedgerAccess(event, getDatabase(), filters.ledgerId)
    return listReportSnapshots(getDatabase(), filters)
  })

  ipcMain.handle('reporting:getDetail', (event, payload: { snapshotId: number; ledgerId?: number }) => {
    requireAuth(event)
    const db = getDatabase()
    const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
    requireLedgerAccess(event, db, detail.ledger_id)
    return detail
  })

  ipcMain.handle(
    'reporting:export',
    async (
      event,
      payload: {
        snapshotId: number
        ledgerId?: number
        format: ReportExportFormat
        filePath?: string
      }
    ) => {
    try {
      const user = requireAuth(event)
      const db = getDatabase()
      const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
      requireLedgerAccess(event, db, detail.ledger_id)
      const preferredDir = getLastReportExportDir(db) ?? getReportExportDir()
      const defaultPath = path.join(
        preferredDir,
        buildDefaultReportExportFileName(detail, payload.format)
      )
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const saveResult = payload.filePath
        ? { canceled: false, filePath: payload.filePath }
        : browserWindow
          ? await dialog.showSaveDialog(browserWindow, {
              defaultPath,
              filters: [
                payload.format === 'xlsx'
                  ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
                  : { name: 'PDF 文档', extensions: ['pdf'] }
              ]
            })
          : await dialog.showSaveDialog({
              defaultPath,
              filters: [
                payload.format === 'xlsx'
                  ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
                  : { name: 'PDF 文档', extensions: ['pdf'] }
              ]
            })

      if (saveResult.canceled || !saveResult.filePath) {
        return {
          success: false,
          cancelled: true
        }
      }

      const exportPath = await exportReportSnapshotToPath(detail, payload.format, saveResult.filePath)
      rememberReportExportDir(db, exportPath)

      appendOperationLog(db, {
        ledgerId: detail.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'reporting',
        action: 'export_snapshot',
        targetType: 'report_snapshot',
        targetId: detail.id,
        details: {
          reportType: detail.report_type,
          period: detail.period,
          reportName: detail.report_name,
          exportPath,
          format: payload.format
        }
      })

      return {
        success: true,
        filePath: exportPath
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导出报表失败'
      }
    }
    }
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
      }
    ) => {
      try {
        const user = requireAuth(event)
        const db = getDatabase()

        if (!Array.isArray(payload.snapshotIds) || payload.snapshotIds.length === 0) {
          return { success: false, error: '请先选择至少一张报表' }
        }

        const details = payload.snapshotIds.map((snapshotId) =>
          getReportSnapshotDetail(db, snapshotId, payload.ledgerId)
        )
        for (const detail of details) {
          requireLedgerAccess(event, db, detail.ledger_id)
        }
        const preferredDir = getLastReportExportDir(db) ?? getReportExportDir()
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
        const filePaths: string[] = []
        for (const detail of details) {
          const filePath = path.join(
            directoryPath,
            buildDefaultReportExportFileName(detail, payload.format)
          )
          filePaths.push(await exportReportSnapshotToPath(detail, payload.format, filePath))
        }
        rememberReportExportDir(db, directoryPath)

        appendOperationLog(db, {
          ledgerId: details[0]?.ledger_id ?? null,
          userId: user.id,
          username: user.username,
          module: 'reporting',
          action: 'export_snapshot_batch',
          targetType: 'report_snapshot_batch',
          targetId: payload.snapshotIds.join(','),
          details: {
            reportCount: details.length,
            format: payload.format,
            directoryPath
          }
        })

        return {
          success: true,
          directoryPath,
          filePaths
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '批量导出报表失败'
        }
      }
    }
  )

  ipcMain.handle('reporting:delete', (event, payload: { snapshotId: number; ledgerId: number }) => {
    try {
      const user = requireAuth(event)
      const db = getDatabase()
      requireLedgerAccess(event, db, payload.ledgerId)
      const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
      const deleted = deleteReportSnapshot(db, payload.snapshotId, payload.ledgerId)

      if (!deleted) {
        return { success: false, error: '报表快照不存在或已删除' }
      }

      appendOperationLog(db, {
        ledgerId: payload.ledgerId,
        userId: user.id,
        username: user.username,
        module: 'reporting',
        action: 'delete_snapshot',
        targetType: 'report_snapshot',
        targetId: payload.snapshotId,
        details: {
          reportType: detail.report_type,
          period: detail.period,
          reportName: detail.report_name
        }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除报表快照失败'
      }
    }
  })

  ipcMain.handle('reporting:generate', (event, payload: GenerateReportSnapshotParams) => {
    try {
      const user = requireAuth(event)
      const db = getDatabase()
      requireLedgerAccess(event, db, payload.ledgerId)
      const snapshot = generateReportSnapshot(db, {
        ...payload,
        generatedBy: user.id
      })

      appendOperationLog(db, {
        ledgerId: snapshot.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'reporting',
        action: 'generate_snapshot',
        targetType: 'report_snapshot',
        targetId: snapshot.id,
        details: {
          reportType: snapshot.report_type,
          period: snapshot.period,
          reportName: snapshot.report_name
        }
      })

      return {
        success: true,
        snapshot
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '生成报表快照失败'
      }
    }
  })
}

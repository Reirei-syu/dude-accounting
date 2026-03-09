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
import { requireAuth } from './session'

function getReportExportDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '报表导出')
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
    return listReportSnapshots(getDatabase(), filters)
  })

  ipcMain.handle('reporting:getDetail', (event, payload: { snapshotId: number; ledgerId?: number }) => {
    requireAuth(event)
    return getReportSnapshotDetail(getDatabase(), payload.snapshotId, payload.ledgerId)
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
      const defaultPath = path.join(
        getReportExportDir(),
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

      const exportPath =
        payload.format === 'xlsx'
          ? await writeReportSnapshotExcel(saveResult.filePath, detail)
          : await printReportHtmlToPdf(saveResult.filePath, buildReportSnapshotHtml(detail))

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

  ipcMain.handle('reporting:delete', (event, payload: { snapshotId: number; ledgerId: number }) => {
    try {
      const user = requireAuth(event)
      const db = getDatabase()
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

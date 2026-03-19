import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildReportExportDefaultPath,
  exportReportSnapshotToFile,
  exportReportSnapshotsBatch,
  getPreferredReportExportDir,
  getReportExportFilters,
  rememberReportExportDir
} from '../services/reportExport'
import {
  deleteReportSnapshot,
  generateReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots,
  type ReportExportFormat,
  type GenerateReportSnapshotParams,
  type ReportListFilters
} from '../services/reporting'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { requireAuth, requireLedgerAccess } from './session'

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
    await import('node:fs/promises').then((fs) =>
      fs.mkdir(path.dirname(filePath), { recursive: true })
    )
    await import('node:fs/promises').then((fs) => fs.writeFile(filePath, pdfBuffer))
    return filePath
  } finally {
    window.destroy()
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
      () => {
        requireAuth(event)
        requireLedgerAccess(event, getDatabase(), filters.ledgerId)
        return listReportSnapshots(getDatabase(), filters)
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
        () => {
          requireAuth(event)
          const db = getDatabase()
          const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
          requireLedgerAccess(event, db, detail.ledger_id)
          return detail
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
            const user = requireAuth(event)
            const db = getDatabase()
            const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
            requireLedgerAccess(event, db, detail.ledger_id)
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

            const exportPath = await exportReportSnapshotToFile(
              detail,
              payload.format,
              saveResult.filePath,
              printReportHtmlToPdf
            )
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
    ) =>
      withIpcTelemetry(
        {
          channel: 'reporting:exportBatch',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId ?? null,
            snapshotCount: payload.snapshotIds.length,
            format: payload.format
          }
        },
        async () => {
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
            const filePaths = await exportReportSnapshotsBatch(
              details,
              payload.format,
              directoryPath,
              (detail, filePath) =>
                exportReportSnapshotToFile(detail, payload.format, filePath, printReportHtmlToPdf)
            )
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
      () => {
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
      () => {
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
      }
    )
  )
}

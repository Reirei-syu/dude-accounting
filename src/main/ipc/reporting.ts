import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  deleteReportSnapshot,
  generateReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots,
  type GenerateReportSnapshotParams,
  type ReportListFilters
} from '../services/reporting'
import { requireAuth } from './session'

export function registerReportingHandlers(): void {
  ipcMain.handle('reporting:list', (event, filters: ReportListFilters) => {
    requireAuth(event)
    return listReportSnapshots(getDatabase(), filters)
  })

  ipcMain.handle('reporting:getDetail', (event, payload: { snapshotId: number; ledgerId?: number }) => {
    requireAuth(event)
    return getReportSnapshotDetail(getDatabase(), payload.snapshotId, payload.ledgerId)
  })

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

import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  executePLCarryForward,
  listPLCarryForwardRules,
  savePLCarryForwardRules,
  previewPLCarryForward
} from '../services/plCarryForward'
import { requireAuth, requireLedgerAccess, requirePermission } from './session'

export function registerPLCarryForwardHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('plCarryForward:listRules', (event, ledgerId: number) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
    return listPLCarryForwardRules(db, ledgerId)
  })

  ipcMain.handle(
    'plCarryForward:saveRules',
    (
      event,
      payload: {
        ledgerId: number
        rules: Array<{
          fromSubjectCode: string
          toSubjectCode: string
        }>
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        requireLedgerAccess(event, db, payload.ledgerId)
        const savedCount = savePLCarryForwardRules(db, payload)
        return { success: true, savedCount }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '保存损益结转规则失败'
        }
      }
    }
  )

  ipcMain.handle(
    'plCarryForward:preview',
    (event, payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) => {
      requireAuth(event)
      requireLedgerAccess(event, db, payload.ledgerId)
      return previewPLCarryForward(db, payload)
    }
  )

  ipcMain.handle(
    'plCarryForward:execute',
    (event, payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) => {
      try {
        const user = requirePermission(event, 'bookkeeping')
        requireLedgerAccess(event, db, payload.ledgerId)
        const result = executePLCarryForward(db, {
          ledgerId: payload.ledgerId,
          period: payload.period,
          operatorId: user.id,
          includeUnpostedVouchers: payload.includeUnpostedVouchers
        })
        return {
          success: true,
          ...result
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '执行期末损益结转失败'
        }
      }
    }
  )
}

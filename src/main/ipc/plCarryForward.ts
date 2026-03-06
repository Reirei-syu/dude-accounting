import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  executePLCarryForward,
  listPLCarryForwardRules,
  previewPLCarryForward
} from '../services/plCarryForward'
import { requireAuth, requirePermission } from './session'

export function registerPLCarryForwardHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('plCarryForward:listRules', (event, ledgerId: number) => {
    requireAuth(event)
    return listPLCarryForwardRules(db, ledgerId)
  })

  ipcMain.handle(
    'plCarryForward:preview',
    (event, payload: { ledgerId: number; period: string }) => {
      requireAuth(event)
      return previewPLCarryForward(db, payload)
    }
  )

  ipcMain.handle(
    'plCarryForward:execute',
    (event, payload: { ledgerId: number; period: string }) => {
      try {
        const user = requirePermission(event, 'bookkeeping')
        const result = executePLCarryForward(db, {
          ledgerId: payload.ledgerId,
          period: payload.period,
          operatorId: user.id
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

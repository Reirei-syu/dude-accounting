import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { requireAuth } from './session'

export function registerCashFlowHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('cashflow:getItems', (event, ledgerId: number) => {
    requireAuth(event)
    return db
      .prepare(
        `SELECT id, code, name, category, direction
                 FROM cash_flow_items
                 WHERE ledger_id = ?
                 ORDER BY code`
      )
      .all(ledgerId)
  })
}

import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createCashFlowMapping,
  deleteCashFlowMapping,
  listCashFlowMappings,
  updateCashFlowMapping
} from '../services/cashFlowMapping'
import { requireAuth, requirePermission } from './session'

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

  ipcMain.handle('cashflow:getMappings', (event, ledgerId: number) => {
    requireAuth(event)
    return listCashFlowMappings(db, ledgerId)
  })

  ipcMain.handle(
    'cashflow:createMapping',
    (
      event,
      data: {
        ledgerId: number
        subjectCode: string
        counterpartSubjectCode: string
        entryDirection: 'inflow' | 'outflow'
        cashFlowItemId: number
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        const id = createCashFlowMapping(db, data)
        return { success: true, id }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'cashflow:updateMapping',
    (
      event,
      data: {
        id: number
        subjectCode: string
        counterpartSubjectCode: string
        entryDirection: 'inflow' | 'outflow'
        cashFlowItemId: number
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        updateCashFlowMapping(db, data)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('cashflow:deleteMapping', (event, id: number) => {
    try {
      requirePermission(event, 'ledger_settings')
      deleteCashFlowMapping(db, id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createCashFlowMapping,
  deleteCashFlowMapping,
  listCashFlowMappings,
  updateCashFlowMapping
} from '../services/cashFlowMapping'
import { requireAuth, requireLedgerAccess, requirePermission } from './session'

export function registerCashFlowHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('cashflow:getItems', (event, ledgerId: number) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
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
    requireLedgerAccess(event, db, ledgerId)
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
        requireLedgerAccess(event, db, data.ledgerId)
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
        const mapping = db.prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?').get(data.id) as
          | { ledger_id: number }
          | undefined
        if (!mapping) {
          return { success: false, error: '现金流量匹配规则不存在' }
        }
        requireLedgerAccess(event, db, mapping.ledger_id)
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
      const mapping = db.prepare('SELECT ledger_id FROM cash_flow_mappings WHERE id = ?').get(id) as
        | { ledger_id: number }
        | undefined
      if (!mapping) {
        return { success: false, error: '现金流量匹配规则不存在' }
      }
      requireLedgerAccess(event, db, mapping.ledger_id)
      deleteCashFlowMapping(db, id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

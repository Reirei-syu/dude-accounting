import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createAuxiliaryItem,
  deleteAuxiliaryItem,
  listAuxiliaryItems,
  updateAuxiliaryItem
} from '../services/accountSetup'
import { requireAuth, requireLedgerAccess, requirePermission } from './session'

export function registerAuxiliaryHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('auxiliary:getAll', (event, ledgerId: number) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
    return listAuxiliaryItems(db, ledgerId)
  })

  ipcMain.handle('auxiliary:getByCategory', (event, ledgerId: number, category: string) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
    return listAuxiliaryItems(db, ledgerId, category)
  })

  ipcMain.handle(
    'auxiliary:create',
    (
      event,
      data: {
        ledgerId: number
        category: string
        code: string
        name: string
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        requireLedgerAccess(event, db, data.ledgerId)
        createAuxiliaryItem(db, data)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'auxiliary:update',
    (
      event,
      data: {
        id: number
        code?: string
        name?: string
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        const item = db.prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?').get(data.id) as
          | { ledger_id: number }
          | undefined
        if (!item) {
          return { success: false, error: '辅助项不存在' }
        }
        requireLedgerAccess(event, db, item.ledger_id)
        updateAuxiliaryItem(db, data)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('auxiliary:delete', (event, id: number) => {
    try {
      requirePermission(event, 'ledger_settings')
      const item = db.prepare('SELECT ledger_id FROM auxiliary_items WHERE id = ?').get(id) as
        | { ledger_id: number }
        | undefined
      if (!item) {
        return { success: false, error: '辅助项不存在' }
      }
      requireLedgerAccess(event, db, item.ledger_id)
      deleteAuxiliaryItem(db, id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

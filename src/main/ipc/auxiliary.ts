import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createAuxiliaryItem,
  deleteAuxiliaryItem,
  listAuxiliaryItems,
  updateAuxiliaryItem
} from '../services/accountSetup'
import { requireAuth, requirePermission } from './session'

export function registerAuxiliaryHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('auxiliary:getAll', (event, ledgerId: number) => {
    requireAuth(event)
    return listAuxiliaryItems(db, ledgerId)
  })

  ipcMain.handle('auxiliary:getByCategory', (event, ledgerId: number, category: string) => {
    requireAuth(event)
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
      deleteAuxiliaryItem(db, id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

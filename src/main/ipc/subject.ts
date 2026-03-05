import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { createSubject, listSubjects, updateSubject } from '../services/accountSetup'
import { requireAuth, requirePermission } from './session'

export function registerSubjectHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('subject:getAll', (event, ledgerId: number) => {
    requireAuth(event)
    return listSubjects(db, ledgerId)
  })

  ipcMain.handle('subject:search', (event, ledgerId: number, keyword: string) => {
    requireAuth(event)
    return db
      .prepare(
        `SELECT * FROM subjects WHERE ledger_id = ?
           AND (code LIKE ? OR name LIKE ?)
           ORDER BY code LIMIT 20`
      )
      .all(ledgerId, `%${keyword}%`, `%${keyword}%`)
  })

  ipcMain.handle(
    'subject:create',
    (
      event,
      data: {
        ledgerId: number
        parentCode: string | null
        code: string
        name: string
        auxiliaryCategories: string[]
        customAuxiliaryItemIds?: number[]
        isCashFlow: boolean
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        createSubject(db, data)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'subject:update',
    (
      event,
      data: {
        subjectId: number
        name?: string
        auxiliaryCategories?: string[]
        customAuxiliaryItemIds?: number[]
        isCashFlow?: boolean
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        updateSubject(db, data)
        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('subject:delete', (event, id: number) => {
    try {
      requirePermission(event, 'ledger_settings')

      const subject = db.prepare('SELECT is_system FROM subjects WHERE id = ?').get(id) as
        | { is_system: number }
        | undefined
      if (!subject) {
        return { success: false, error: '科目不存在' }
      }
      if (subject.is_system === 1) {
        return { success: false, error: '系统科目不可删除' }
      }

      db.prepare('DELETE FROM subjects WHERE id = ?').run(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

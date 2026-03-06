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
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword) {
      return []
    }

    const isNumericKeyword = /^\d+$/.test(normalizedKeyword)
    const codePattern = `${normalizedKeyword}%`
    const namePattern = isNumericKeyword ? `${normalizedKeyword}%` : `%${normalizedKeyword}%`

    return db
      .prepare(
        `SELECT s.*
           FROM subjects s
          WHERE s.ledger_id = ?
            AND (s.code LIKE ? OR s.name LIKE ?)
            AND NOT EXISTS (
              SELECT 1
                FROM subjects child
               WHERE child.ledger_id = s.ledger_id
                 AND child.code <> s.code
                 AND (child.parent_code = s.code OR child.code LIKE s.code || '%')
            )
          ORDER BY s.code
          LIMIT 20`
      )
      .all(ledgerId, codePattern, namePattern)
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

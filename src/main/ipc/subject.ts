import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createSubjectCommand,
  deleteSubjectCommand,
  listSubjectsCommand,
  updateSubjectCommand
} from '../commands/accountCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'
import { requireAuth, requireLedgerAccess } from './session'

export function registerSubjectHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('subject:getAll', async (event, ledgerId: number) => {
    const result = await listSubjectsCommand(createCommandContextFromEvent(event), { ledgerId })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取科目列表失败')
  })

  ipcMain.handle('subject:search', (event, ledgerId: number, keyword: string) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
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
    ) =>
      createSubjectCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
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
    ) =>
      updateSubjectCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
  )

  ipcMain.handle('subject:delete', async (event, id: number) =>
    toLegacySuccess(
      await deleteSubjectCommand(createCommandContextFromEvent(event), { subjectId: id }),
      () => ({})
    )
  )
}

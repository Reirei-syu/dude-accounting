import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createSubjectCommand,
  deleteSubjectCommand,
  listSubjectsCommand,
  searchSubjectsCommand,
  updateSubjectCommand
} from '../commands/accountCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerSubjectHandlers(): void {
  getDatabase()

  ipcMain.handle('subject:getAll', async (event, ledgerId: number) => {
    const result = await listSubjectsCommand(createCommandContextFromEvent(event), { ledgerId })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取科目列表失败')
  })

  ipcMain.handle('subject:search', async (event, ledgerId: number, keyword: string) => {
    const result = await searchSubjectsCommand(createCommandContextFromEvent(event), {
      ledgerId,
      keyword
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '搜索科目失败')
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

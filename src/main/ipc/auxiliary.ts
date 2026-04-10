import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createAuxiliaryItemCommand,
  deleteAuxiliaryItemCommand,
  listAuxiliaryItemsCommand,
  updateAuxiliaryItemCommand
} from '../commands/accountCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerAuxiliaryHandlers(): void {
  getDatabase()

  ipcMain.handle('auxiliary:getAll', async (event, ledgerId: number) => {
    const result = await listAuxiliaryItemsCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取辅助项失败')
  })

  ipcMain.handle('auxiliary:getByCategory', async (event, ledgerId: number, category: string) => {
    const result = await listAuxiliaryItemsCommand(createCommandContextFromEvent(event), {
      ledgerId,
      category
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取辅助项失败')
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
    ) =>
      createAuxiliaryItemCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
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
    ) =>
      updateAuxiliaryItemCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
  )

  ipcMain.handle('auxiliary:delete', async (event, id: number) =>
    toLegacySuccess(
      await deleteAuxiliaryItemCommand(createCommandContextFromEvent(event), { id }),
      () => ({})
    )
  )
}

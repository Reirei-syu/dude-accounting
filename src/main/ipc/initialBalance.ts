import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  listInitialBalancesCommand,
  saveInitialBalancesCommand
} from '../commands/initialBalanceCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'
import type { InitialBalanceEntryInput } from '../services/initialBalance'

export function registerInitialBalanceHandlers(): void {
  getDatabase()

  ipcMain.handle('initialBalance:list', async (event, ledgerId: number, period: string) => {
    const result = await listInitialBalancesCommand(createCommandContextFromEvent(event), {
      ledgerId,
      period
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取期初余额失败')
  })

  ipcMain.handle(
    'initialBalance:save',
    (
      event,
      payload: {
        ledgerId: number
        period: string
        entries: InitialBalanceEntryInput[]
      }
    ) =>
      saveInitialBalancesCommand(createCommandContextFromEvent(event), payload).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
  )
}

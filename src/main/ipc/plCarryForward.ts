import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  executeCarryForwardCommand,
  listCarryForwardRulesCommand,
  previewCarryForwardCommand,
  saveCarryForwardRulesCommand
} from '../commands/periodCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerPLCarryForwardHandlers(): void {
  getDatabase()

  ipcMain.handle('plCarryForward:listRules', async (event, ledgerId: number) => {
    const result = await listCarryForwardRulesCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取损益结转规则失败')
  })

  ipcMain.handle(
    'plCarryForward:saveRules',
    async (
      event,
      payload: {
        ledgerId: number
        rules: Array<{
          fromSubjectCode: string
          toSubjectCode: string
        }>
      }
    ) =>
      toLegacySuccess(
        await saveCarryForwardRulesCommand(createCommandContextFromEvent(event), payload),
        (data) => ({ savedCount: data.savedCount })
      )
  )

  ipcMain.handle(
    'plCarryForward:preview',
    async (event, payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) => {
      const result = await previewCarryForwardCommand(createCommandContextFromEvent(event), payload)
      if (isCommandSuccess(result)) {
        return result.data
      }

      throw new Error(result.error?.message ?? '预览损益结转失败')
    }
  )

  ipcMain.handle(
    'plCarryForward:execute',
    async (event, payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }) =>
      toLegacySuccess(
        await executeCarryForwardCommand(createCommandContextFromEvent(event), payload),
        (data) => ({ ...data })
      )
  )
}

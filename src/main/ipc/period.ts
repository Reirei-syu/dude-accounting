import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  closePeriodCommand,
  getPeriodStatusCommand,
  reopenPeriodCommand
} from '../commands/periodCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerPeriodHandlers(): void {
  getDatabase()

  ipcMain.handle('period:getStatus', (event, ledgerId: number, period: string) => {
    if (!ledgerId || !period) {
      return {
        period,
        is_closed: 0,
        closed_at: null,
        pending_audit_vouchers: [],
        pending_bookkeep_vouchers: []
      }
    }

    return getPeriodStatusCommand(createCommandContextFromEvent(event), {
      ledgerId,
      period
    }).then((result) => {
      if (isCommandSuccess(result)) {
        return result.data
      }
      throw new Error(result.error?.message ?? '获取期间状态失败')
    })
  })

  ipcMain.handle('period:close', (event, payload: { ledgerId: number; period: string }) => {
    return closePeriodCommand(createCommandContextFromEvent(event), payload).then((result) =>
      toLegacySuccess(result, (data) => data)
    )
  })

  ipcMain.handle('period:reopen', (event, payload: { ledgerId: number; period: string }) => {
    return reopenPeriodCommand(createCommandContextFromEvent(event), payload).then((result) =>
      toLegacySuccess(result, () => ({}))
    )
  })
}

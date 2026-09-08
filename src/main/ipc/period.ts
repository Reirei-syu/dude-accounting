import { handleInvoke } from './typedInvoke'
import { getDatabase } from '../database/init'
import {
  closePeriodCommand,
  getPeriodStatusCommand,
  reopenPeriodCommand
} from '../commands/periodCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerPeriodHandlers(): void {
  getDatabase()

  handleInvoke('period:getStatus', (event, ledgerId: number, period: string) => {
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

  handleInvoke('period:close', (event, payload: { ledgerId: number; period: string }) => {
    return closePeriodCommand(createCommandContextFromEvent(event), payload).then((result) =>
      toLegacySuccess(result, (data) => data)
    )
  })

  handleInvoke('period:reopen', (event, payload: { ledgerId: number; period: string }) => {
    return reopenPeriodCommand(createCommandContextFromEvent(event), payload).then((result) =>
      toLegacySuccess(result, () => ({}))
    )
  })
}

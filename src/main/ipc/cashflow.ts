import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createCashFlowMappingCommand,
  deleteCashFlowMappingCommand,
  listCashFlowMappingsCommand,
  updateCashFlowMappingCommand
} from '../commands/accountCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'
import { requireAuth, requireLedgerAccess } from './session'

export function registerCashFlowHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('cashflow:getItems', (event, ledgerId: number) => {
    requireAuth(event)
    requireLedgerAccess(event, db, ledgerId)
    return db
      .prepare(
        `SELECT id, code, name, category, direction
                 FROM cash_flow_items
                 WHERE ledger_id = ?
                 ORDER BY code`
      )
      .all(ledgerId)
  })

  ipcMain.handle('cashflow:getMappings', async (event, ledgerId: number) => {
    const result = await listCashFlowMappingsCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取现金流匹配规则失败')
  })

  ipcMain.handle(
    'cashflow:createMapping',
    (
      event,
      data: {
        ledgerId: number
        subjectCode: string
        counterpartSubjectCode: string
        entryDirection: 'inflow' | 'outflow'
        cashFlowItemId: number
      }
    ) =>
      createCashFlowMappingCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, (commandData) => ({ id: commandData.mappingId }))
      )
  )

  ipcMain.handle(
    'cashflow:updateMapping',
    (
      event,
      data: {
        id: number
        subjectCode: string
        counterpartSubjectCode: string
        entryDirection: 'inflow' | 'outflow'
        cashFlowItemId: number
      }
    ) =>
      updateCashFlowMappingCommand(createCommandContextFromEvent(event), data).then((result) =>
        toLegacySuccess(result, () => ({}))
      )
  )

  ipcMain.handle('cashflow:deleteMapping', async (event, id: number) =>
    toLegacySuccess(
      await deleteCashFlowMappingCommand(createCommandContextFromEvent(event), { id }),
      () => ({})
    )
  )
}

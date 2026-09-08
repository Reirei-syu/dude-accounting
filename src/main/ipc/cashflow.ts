import { handleInvoke } from './typedInvoke'
import { getDatabase } from '../database/init'
import {
  createCashFlowMappingCommand,
  deleteCashFlowMappingCommand,
  listCashFlowItemsCommand,
  listCashFlowMappingsCommand,
  updateCashFlowMappingCommand
} from '../commands/accountCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerCashFlowHandlers(): void {
  getDatabase()

  handleInvoke('cashflow:getItems', async (event, ledgerId: number) => {
    const result = await listCashFlowItemsCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取现金流量项目失败')
  })

  handleInvoke('cashflow:getMappings', async (event, ledgerId: number) => {
    const result = await listCashFlowMappingsCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取现金流匹配规则失败')
  })

  handleInvoke(
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

  handleInvoke(
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

  handleInvoke('cashflow:deleteMapping', async (event, id: number) =>
    toLegacySuccess(
      await deleteCashFlowMappingCommand(createCommandContextFromEvent(event), { id }),
      () => ({})
    )
  )
}

import { app, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  applyLedgerTemplateCommand,
  createLedgerCommand,
  deleteLedgerCommand,
  getLedgerDeletionRiskCommand,
  listLedgersCommand,
  listLedgerPeriodsCommand,
  listLedgerTemplatesCommand,
  updateLedgerCommand
} from '../commands/ledgerCommands'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerLedgerHandlers(): void {
  getDatabase()

  ipcMain.handle('ledger:getAll', (event) =>
    withIpcTelemetry(
      {
        channel: 'ledger:getAll',
        baseDir: app.getPath('userData')
      },
      async () => {
        const result = await listLedgersCommand(createCommandContextFromEvent(event))
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取账套列表失败')
      }
    )
  )

  ipcMain.handle(
    'ledger:create',
    (
      event,
      data: {
        name: string
        standardType: 'enterprise' | 'npo'
        startPeriod: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'ledger:create',
          baseDir: app.getPath('userData'),
          context: {
            standardType: data.standardType,
            startPeriod: data.startPeriod
          }
        },
        async () => {
          return toLegacySuccess(
            await createLedgerCommand(createCommandContextFromEvent(event), data),
            (commandData) => ({ id: commandData.id })
          )
        }
      )
  )

  ipcMain.handle(
    'ledger:update',
    (event, data: { id: number; name?: string; currentPeriod?: string }) =>
      withIpcTelemetry(
        {
          channel: 'ledger:update',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: data.id,
            hasName: data.name !== undefined,
            hasCurrentPeriod: data.currentPeriod !== undefined
          }
        },
        async () => {
          return toLegacySuccess(
            await updateLedgerCommand(createCommandContextFromEvent(event), data),
            () => ({})
          )
        }
      )
  )

  ipcMain.handle('ledger:delete', (event, payload: { ledgerId: number; riskAcknowledged?: boolean }) =>
    withIpcTelemetry(
      {
        channel: 'ledger:delete',
        baseDir: app.getPath('userData'),
        context: { ledgerId: payload.ledgerId, riskAcknowledged: payload.riskAcknowledged === true }
      },
      async () => {
        return toLegacySuccess(
          await deleteLedgerCommand(createCommandContextFromEvent(event), payload),
          () => ({})
        )
      }
    )
  )

  ipcMain.handle('ledger:getDeletionRisk', (event, ledgerId: number) =>
    withIpcTelemetry(
      {
        channel: 'ledger:getDeletionRisk',
        baseDir: app.getPath('userData'),
        context: { ledgerId }
      },
      async () => {
        const result = await getLedgerDeletionRiskCommand(createCommandContextFromEvent(event), {
          ledgerId
        })
        if (isCommandSuccess(result)) {
          return {
            success: true,
            ...result.data
          }
        }

        return {
          success: false,
          error: result.error?.message ?? '获取账套删除风险失败'
        }
      }
    )
  )

  ipcMain.handle('ledger:getPeriods', (event, ledgerId: number) =>
    withIpcTelemetry(
      {
        channel: 'ledger:getPeriods',
        baseDir: app.getPath('userData'),
        context: { ledgerId }
      },
      async () => {
        const result = await listLedgerPeriodsCommand(createCommandContextFromEvent(event), {
          ledgerId
        })
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取账套期间失败')
      }
    )
  )

  ipcMain.handle('ledger:getStandardTemplates', async (event) => {
    const result = await listLedgerTemplatesCommand(createCommandContextFromEvent(event))
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取模板失败')
  })

  ipcMain.handle(
    'ledger:applyStandardTemplate',
    (
      event,
      data: {
        ledgerId: number
        standardType: 'enterprise' | 'npo'
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'ledger:applyStandardTemplate',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: data.ledgerId,
            standardType: data.standardType
          }
        },
        async () => {
          return toLegacySuccess(
            await applyLedgerTemplateCommand(createCommandContextFromEvent(event), data),
            (commandData) => ({
              ledger: commandData.ledger,
              subjectCount: commandData.subjectCount
            })
          )
        }
      )
  )
}

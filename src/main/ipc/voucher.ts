import { app, ipcMain } from 'electron'
import type { VoucherBatchAction } from '../services/voucherBatchLifecycle'
import type { VoucherListStatusFilter } from '../services/voucherCatalog'
import {
  resolveVoucherCashFlowEntries,
  type VoucherEntryInput
} from '../services/voucherLifecycle'
import { withIpcTelemetry } from '../services/runtimeLogger'
import {
  createVoucherCommand,
  getNextVoucherNumberCommand,
  getVoucherEntriesCommand,
  listVouchersCommand,
  swapVoucherPositionsCommand,
  updateVoucherCommand,
  voucherBatchActionCommand
} from '../commands/voucherCommands'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

interface SaveVoucherInput {
  ledgerId: number
  voucherDate: string
  voucherWord?: string
  isCarryForward?: boolean
  entries: VoucherEntryInput[]
}

interface UpdateVoucherInput {
  voucherId: number
  ledgerId: number
  voucherDate: string
  entries: VoucherEntryInput[]
}

interface SwapVoucherPositionsInput {
  voucherIds: number[]
}

export { resolveVoucherCashFlowEntries }

export function registerVoucherHandlers(): void {
  ipcMain.handle('voucher:getNextNumber', (event, ledgerId: number, period: string) =>
    withIpcTelemetry(
      {
        channel: 'voucher:getNextNumber',
        baseDir: app.getPath('userData'),
        context: { ledgerId, period }
      },
      async () => {
        const result = await getNextVoucherNumberCommand(createCommandContextFromEvent(event), {
          ledgerId,
          period
        })
        if (isCommandSuccess(result)) {
          return result.data.voucherNumber
        }

        throw new Error(result.error?.message ?? '获取下一凭证号失败')
      }
    )
  )

  ipcMain.handle('voucher:save', async (event, payload: SaveVoucherInput) =>
    toLegacySuccess(
      await createVoucherCommand(createCommandContextFromEvent(event), payload),
      (data) => ({ ...data })
    )
  )

  ipcMain.handle('voucher:update', async (event, payload: UpdateVoucherInput) =>
    toLegacySuccess(
      await updateVoucherCommand(createCommandContextFromEvent(event), payload),
      (data) => ({ ...data })
    )
  )

  ipcMain.handle(
    'voucher:list',
    (
      event,
      query: {
        ledgerId: number
        voucherId?: number
        period?: string
        dateFrom?: string
        dateTo?: string
        keyword?: string
        status?: VoucherListStatusFilter
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'voucher:list',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: query.ledgerId,
            hasVoucherId: typeof query.voucherId === 'number',
            hasPeriod: Boolean(query.period),
            hasDateFrom: Boolean(query.dateFrom),
            hasDateTo: Boolean(query.dateTo),
            hasKeyword: Boolean(query.keyword),
            status: query.status ?? null
          }
        },
        async () => {
          const result = await listVouchersCommand(createCommandContextFromEvent(event), query)
          if (isCommandSuccess(result)) {
            return result.data
          }

          throw new Error(result.error?.message ?? '获取凭证列表失败')
        }
      )
  )

  ipcMain.handle('voucher:getEntries', (event, voucherId: number) =>
    withIpcTelemetry(
      {
        channel: 'voucher:getEntries',
        baseDir: app.getPath('userData'),
        context: { voucherId }
      },
      async () => {
        const result = await getVoucherEntriesCommand(createCommandContextFromEvent(event), {
          voucherId
        })
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取凭证明细失败')
      }
    )
  )

  ipcMain.handle('voucher:swapPositions', (event, payload: SwapVoucherPositionsInput) =>
    withIpcTelemetry(
      {
        channel: 'voucher:swapPositions',
        baseDir: app.getPath('userData'),
        context: {
          requestedCount: Array.isArray(payload.voucherIds) ? payload.voucherIds.length : 0
        }
      },
      async () =>
        toLegacySuccess(
          await swapVoucherPositionsCommand(createCommandContextFromEvent(event), payload),
          (data) => ({ voucherIds: data.voucherIds })
        )
    )
  )

  ipcMain.handle(
    'voucher:batchAction',
    (
      event,
      payload: {
        action: VoucherBatchAction
        voucherIds: number[]
        reason?: string
        approvalTag?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'voucher:batchAction',
          baseDir: app.getPath('userData'),
          context: {
            action: payload.action,
            requestedCount: Array.isArray(payload.voucherIds) ? payload.voucherIds.length : 0
          }
        },
        async () =>
          toLegacySuccess(
            await voucherBatchActionCommand(createCommandContextFromEvent(event), payload),
            (data) => ({
              processedCount: data.processedCount,
              skippedCount: data.skippedCount,
              requestedCount: data.requestedCount
            })
          )
      )
  )
}

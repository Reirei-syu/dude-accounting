import { app, ipcMain } from 'electron'
import {
  convertElectronicVoucherCommand,
  importElectronicVoucherCommand,
  listElectronicVouchersCommand,
  parseElectronicVoucherCommand,
  verifyElectronicVoucherCommand
} from '../commands/electronicVoucherCommands'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'

export function registerElectronicVoucherHandlers(): void {
  ipcMain.handle(
    'eVoucher:import',
    async (
      event,
      payload: {
        ledgerId: number
        sourcePath: string
        sourceNumber?: string | null
        sourceDate?: string | null
        amountCents?: number | null
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'eVoucher:import',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId,
            hasSourceNumber: Boolean(payload.sourceNumber?.trim()),
            hasSourceDate: Boolean(payload.sourceDate?.trim()),
            hasAmountCents: typeof payload.amountCents === 'number'
          }
        },
        async () => {
          return toLegacySuccess(
            await importElectronicVoucherCommand(createCommandContextFromEvent(event), payload),
            (data) => ({
              fileId: data.fileId,
              recordId: data.recordId,
              voucherType: data.voucherType,
              fingerprint: data.fingerprint
            })
          )
        }
      )
  )

  ipcMain.handle('eVoucher:list', async (event, ledgerId: number) => {
    const result = await listElectronicVouchersCommand(createCommandContextFromEvent(event), {
      ledgerId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取电子凭证列表失败')
  })

  ipcMain.handle(
    'eVoucher:verify',
    async (
      event,
      payload: {
        recordId: number
        verificationStatus?: 'verified' | 'failed'
        verificationMethod?: string
        verificationMessage?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'eVoucher:verify',
          baseDir: app.getPath('userData'),
          context: {
            recordId: payload.recordId,
            requestedStatus: payload.verificationStatus ?? null,
            verificationMethod: payload.verificationMethod ?? 'manual'
          }
        },
        async () => {
          return toLegacySuccess(
            await verifyElectronicVoucherCommand(createCommandContextFromEvent(event), payload),
            (data) => ({
              verificationStatus: data.verificationStatus
            })
          )
        }
      )
  )

  ipcMain.handle(
    'eVoucher:parse',
    async (
      event,
      payload: {
        recordId: number
        sourceNumber?: string | null
        sourceDate?: string | null
        amountCents?: number | null
        counterpartName?: string | null
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'eVoucher:parse',
          baseDir: app.getPath('userData'),
          context: {
            recordId: payload.recordId,
            hasSourceNumber: Boolean(payload.sourceNumber?.trim()),
            hasSourceDate: Boolean(payload.sourceDate?.trim()),
            hasAmountCents: typeof payload.amountCents === 'number',
            hasCounterpartName: Boolean(payload.counterpartName?.trim())
          }
        },
        async () => {
          return toLegacySuccess(
            await parseElectronicVoucherCommand(createCommandContextFromEvent(event), payload),
            (data) => ({
              structuredData: data.structuredData
            })
          )
        }
      )
  )

  ipcMain.handle(
    'eVoucher:convert',
    async (event, payload: { recordId: number; voucherDate?: string; voucherWord?: string }) =>
      withIpcTelemetry(
        {
          channel: 'eVoucher:convert',
          baseDir: app.getPath('userData'),
          context: {
            recordId: payload.recordId,
            voucherDate: payload.voucherDate ?? null,
            voucherWord: payload.voucherWord ?? null
          }
        },
        async () => {
          return toLegacySuccess(
            await convertElectronicVoucherCommand(createCommandContextFromEvent(event), payload),
            (data) => ({
              draftVoucher: data.draftVoucher
            })
          )
        }
      )
  )
}

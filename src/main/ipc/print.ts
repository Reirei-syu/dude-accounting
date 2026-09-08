import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { getDatabase } from '../database/init'
import { preparePrintCommand } from '../commands/printCommands'
import { CommandError } from '../commands/types'
import { authorizePrintWindow } from '../services/printWindowAuthority'
import {
  buildPrintFailureResponse,
  disposePrintJobForActor,
  exportPreparedJobPdfForActor,
  getPrintJobStatusForActor,
  getPrintPdfDefaultPathForActor,
  getPrintPreviewModelForActor,
  openPrintPreviewForActor,
  printPreparedJobForActor,
  resolvePrintCommandPayload,
  updatePrintPreviewSettingsForActor,
  type PrintJobAccess
} from '../services/printJobs'
import { createCommandContextFromEvent, toLegacySuccess } from './commandBridge'
import { handleInvoke as handle } from './typedInvoke'

export {
  buildDefaultPreviewSettings,
  loadPersistedPreviewSettings,
  persistPreviewSettings,
  resolveMeasuredTableRowGroups,
  createPrintDocument,
  resolvePrintCommandPayload
} from '../services/printJobs'
export type {
  PrintPreparePayload,
  PrintCommandPayload,
  PrintJobStatus
} from '../services/printJobs'

function resolvePrintAccess(event: IpcMainInvokeEvent, jobId: string): PrintJobAccess {
  if (authorizePrintWindow(event, jobId)) {
    return () => {
      if (!authorizePrintWindow(event, jobId)) {
        throw new CommandError('FORBIDDEN', '打印窗口授权已失效或任务不匹配', { jobId }, 4)
      }
    }
  }
  return () => createCommandContextFromEvent(event).actor
}

function printFailure(error: unknown): ReturnType<typeof buildPrintFailureResponse> {
  return error instanceof CommandError
    ? buildPrintFailureResponse(error.message, error.code, error.details)
    : buildPrintFailureResponse(
        error instanceof Error ? error.message : '打印任务访问失败',
        'INTERNAL_ERROR'
      )
}

export function registerPrintHandlers(): void {
  const db = getDatabase()
  handle('print:prepare', async (event, payload) => {
    return toLegacySuccess(
      await preparePrintCommand(
        createCommandContextFromEvent(event),
        payload,
        () => createCommandContextFromEvent(event).actor
      )
    )
  })

  handle('print:getJobStatus', (event, jobId) => {
    try {
      const status = getPrintJobStatusForActor(db, resolvePrintAccess(event, jobId), jobId)
      if (!status) return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
      return { success: true, ...status }
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:getPreviewModel', (event, jobId) => {
    try {
      const access = resolvePrintAccess(event, jobId)
      const status = getPrintJobStatusForActor(db, access, jobId)
      if (!status) return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
      const model = getPrintPreviewModelForActor(db, access, jobId)
      if (!model) {
        return buildPrintFailureResponse(status.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId,
          status: status.status
        })
      }
      return { success: true, model }
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:updatePreviewSettings', async (event, payload) => {
    try {
      const access = resolvePrintAccess(event, payload.jobId)
      const status = getPrintJobStatusForActor(db, access, payload.jobId)
      if (!status)
        return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId: payload.jobId })
      const model = await updatePrintPreviewSettingsForActor(db, access, payload)
      if (!model) {
        return buildPrintFailureResponse(status.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId: payload.jobId,
          status: status.status
        })
      }
      return { success: true, model }
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:openPreview', async (event, jobId) => {
    try {
      const access = resolvePrintAccess(event, jobId)
      const status = getPrintJobStatusForActor(db, access, jobId)
      if (!status) return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
      if (!(await openPrintPreviewForActor(db, access, jobId))) {
        return buildPrintFailureResponse(status.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId,
          status: status.status
        })
      }
      return { success: true }
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:print', async (event, payload) => {
    const command = resolvePrintCommandPayload(payload)
    try {
      const access = resolvePrintAccess(event, command.jobId)
      const status = getPrintJobStatusForActor(db, access, command.jobId)
      if (!status)
        return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId: command.jobId })
      if (status.status !== 'ready') {
        return buildPrintFailureResponse(status.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId: command.jobId,
          status: status.status
        })
      }
      return (
        (await printPreparedJobForActor(db, access, payload)) ??
        buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId: command.jobId })
      )
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:exportPdf', async (event, payload) => {
    const command = resolvePrintCommandPayload(payload)
    try {
      const access = resolvePrintAccess(event, command.jobId)
      const status = getPrintJobStatusForActor(db, access, command.jobId)
      if (!status)
        return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId: command.jobId })
      if (status.status !== 'ready') {
        return buildPrintFailureResponse(status.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId: command.jobId,
          status: status.status
        })
      }
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const options = {
        defaultPath: getPrintPdfDefaultPathForActor(db, access, command.jobId),
        filters: [{ name: 'PDF 鏂囨。', extensions: ['pdf'] }]
      }
      const saveResult = command.outputPath
        ? { canceled: false, filePath: command.outputPath }
        : browserWindow
          ? await dialog.showSaveDialog(browserWindow, options)
          : await dialog.showSaveDialog(options)
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }
      const result = await exportPreparedJobPdfForActor(db, access, {
        ...command,
        outputPath: saveResult.filePath
      })
      return result
        ? { success: true, ...result }
        : buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId: command.jobId })
    } catch (error) {
      return printFailure(error)
    }
  })

  handle('print:dispose', (event, jobId) => {
    try {
      disposePrintJobForActor(db, resolvePrintAccess(event, jobId), jobId)
    } catch {
      // 保留旧接口幂等清理语义；授权失败不删除任务。
    }
    return { success: true }
  })
}

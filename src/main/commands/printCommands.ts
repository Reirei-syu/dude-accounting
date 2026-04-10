import {
  disposePrintJobForActor,
  exportPreparedJobPdfForActor,
  getPrintJobStatusForActor,
  getPrintPreviewModelForActor,
  openPrintPreviewForActor,
  preparePrintJobForActor,
  printPreparedJobForActor,
  type PrintCommandPayload,
  type PrintPreparePayload
} from '../ipc/print'
import { requireCommandActor } from './authz'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import type { PrintPreviewSettings } from '../services/print'
import { updatePrintPreviewSettingsForActor } from '../ipc/print'

export async function preparePrintCommand(
  context: CommandContext,
  payload: PrintPreparePayload
): Promise<CommandResult<{ jobId: string }>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return preparePrintJobForActor(context.db, context.actor, payload)
  })
}

export async function getPrintJobStatusCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<NonNullable<ReturnType<typeof getPrintJobStatusForActor>>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    const result = getPrintJobStatusForActor(context.db, context.actor, payload.jobId)
    if (!result) {
      throw new Error('打印任务不存在')
    }
    return result
  })
}

export async function getPrintPreviewModelCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<NonNullable<ReturnType<typeof getPrintPreviewModelForActor>>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    const result = getPrintPreviewModelForActor(context.db, context.actor, payload.jobId)
    if (!result) {
      throw new Error('打印任务不存在或尚未完成')
    }
    return result
  })
}

export async function updatePrintPreviewSettingsCommand(
  context: CommandContext,
  payload: { jobId: string; settings: Partial<PrintPreviewSettings> }
): Promise<CommandResult<NonNullable<Awaited<ReturnType<typeof updatePrintPreviewSettingsForActor>>>>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    const result = await updatePrintPreviewSettingsForActor(context.db, context.actor, payload)
    if (!result) {
      throw new Error('打印任务不存在或尚未完成')
    }
    return result
  })
}

export async function openPrintPreviewCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<{ jobId: string; desktopActionTriggered: true }>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    const opened = await openPrintPreviewForActor(context.db, context.actor, payload.jobId, {
      keepAlive: true
    })
    if (!opened) {
      throw new Error('打印任务不存在或尚未完成')
    }
    return {
      jobId: payload.jobId,
      desktopActionTriggered: true as const
    }
  })
}

export async function printPreparedJobCommand(
  context: CommandContext,
  payload: PrintCommandPayload
): Promise<CommandResult<{ success: boolean; error?: string }>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    const result = await printPreparedJobForActor(context.db, context.actor, payload)
    if (!result) {
      throw new Error('打印任务不存在')
    }
    return result
  })
}

export async function exportPreparedJobPdfCommand(
  context: CommandContext,
  payload: PrintCommandPayload
): Promise<CommandResult<{ filePath: string }>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    const outputPath =
      typeof payload === 'string'
        ? undefined
        : payload.outputPath
    const result = await exportPreparedJobPdfForActor(
      context.db,
      context.actor,
      payload,
      outputPath
    )
    if (!result) {
      throw new Error('打印任务不存在')
    }
    return result
  })
}

export async function disposePrintJobCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<{ jobId: string }>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    disposePrintJobForActor(context.db, context.actor, payload.jobId)
    return { jobId: payload.jobId }
  })
}

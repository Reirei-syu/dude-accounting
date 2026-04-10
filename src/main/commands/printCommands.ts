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
import { CommandError } from './types'
import type { PrintPreviewSettings } from '../services/print'
import { updatePrintPreviewSettingsForActor } from '../ipc/print'

type PrintJobStatusResult = NonNullable<ReturnType<typeof getPrintJobStatusForActor>>

function getPrintJobId(payload: string | { jobId: string }): string {
  return typeof payload === 'string' ? payload : payload.jobId
}

function requirePrintJobStatus(context: CommandContext, jobId: string): PrintJobStatusResult {
  requireCommandActor(context.actor)
  const result = getPrintJobStatusForActor(context.db, context.actor, jobId)
  if (!result) {
    throw new CommandError('NOT_FOUND', '打印任务不存在', { jobId }, 5)
  }
  return result
}

function requirePrintJobReady(jobId: string, status: PrintJobStatusResult): void {
  if (status.status !== 'ready') {
    throw new CommandError(
      'CONFLICT',
      status.error ?? '打印任务尚未完成',
      {
        jobId,
        status: status.status
      },
      6
    )
  }
}

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
  return withCommandResult(context, () => requirePrintJobStatus(context, payload.jobId))
}

export async function getPrintPreviewModelCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<NonNullable<ReturnType<typeof getPrintPreviewModelForActor>>>> {
  return withCommandResult(context, () => {
    const status = requirePrintJobStatus(context, payload.jobId)
    requirePrintJobReady(payload.jobId, status)

    const result = getPrintPreviewModelForActor(context.db, context.actor, payload.jobId)
    if (!result) {
      throw new CommandError('CONFLICT', '打印任务预览模型不可用', { jobId: payload.jobId }, 6)
    }
    return result
  })
}

export async function updatePrintPreviewSettingsCommand(
  context: CommandContext,
  payload: { jobId: string; settings: Partial<PrintPreviewSettings> }
): Promise<
  CommandResult<NonNullable<Awaited<ReturnType<typeof updatePrintPreviewSettingsForActor>>>>
> {
  return withCommandResult(context, async () => {
    const status = requirePrintJobStatus(context, payload.jobId)
    requirePrintJobReady(payload.jobId, status)

    const result = await updatePrintPreviewSettingsForActor(context.db, context.actor, payload)
    if (!result) {
      throw new CommandError('CONFLICT', '打印任务预览设置更新失败', { jobId: payload.jobId }, 6)
    }
    return result
  })
}

export async function openPrintPreviewCommand(
  context: CommandContext,
  payload: { jobId: string }
): Promise<CommandResult<{ jobId: string; desktopActionTriggered: true }>> {
  return withCommandResult(context, async () => {
    const status = requirePrintJobStatus(context, payload.jobId)
    requirePrintJobReady(payload.jobId, status)

    const opened = await openPrintPreviewForActor(context.db, context.actor, payload.jobId, {
      keepAlive: true
    })
    if (!opened) {
      throw new CommandError('CONFLICT', '打印任务预览窗口打开失败', { jobId: payload.jobId }, 6)
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
    const jobId = getPrintJobId(payload)
    const status = requirePrintJobStatus(context, jobId)
    requirePrintJobReady(jobId, status)

    const result = await printPreparedJobForActor(context.db, context.actor, payload)
    if (!result) {
      throw new CommandError('NOT_FOUND', '打印任务不存在', { jobId }, 5)
    }
    if (!result.success) {
      throw new CommandError('CONFLICT', result.error ?? '系统打印失败', { jobId }, 6)
    }
    return result
  })
}

export async function exportPreparedJobPdfCommand(
  context: CommandContext,
  payload: PrintCommandPayload
): Promise<CommandResult<{ filePath: string }>> {
  return withCommandResult(context, async () => {
    const jobId = getPrintJobId(payload)
    const status = requirePrintJobStatus(context, jobId)
    requirePrintJobReady(jobId, status)

    const outputPath = typeof payload === 'string' ? undefined : payload.outputPath
    const result = await exportPreparedJobPdfForActor(
      context.db,
      context.actor,
      payload,
      outputPath
    )
    if (!result) {
      throw new CommandError('NOT_FOUND', '打印任务不存在', { jobId }, 5)
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

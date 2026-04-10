import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandError } from './types'

const printCommandMocks = vi.hoisted(() => ({
  getPrintJobStatusForActor: vi.fn(),
  getPrintPreviewModelForActor: vi.fn(),
  updatePrintPreviewSettingsForActor: vi.fn(),
  openPrintPreviewForActor: vi.fn(),
  printPreparedJobForActor: vi.fn(),
  exportPreparedJobPdfForActor: vi.fn(),
  preparePrintJobForActor: vi.fn(),
  disposePrintJobForActor: vi.fn(),
  requireCommandActor: vi.fn((actor) => actor)
}))

vi.mock('../ipc/print', async () => {
  const actual = await vi.importActual('../ipc/print')
  return {
    ...(actual as object),
    getPrintJobStatusForActor: printCommandMocks.getPrintJobStatusForActor,
    getPrintPreviewModelForActor: printCommandMocks.getPrintPreviewModelForActor,
    updatePrintPreviewSettingsForActor: printCommandMocks.updatePrintPreviewSettingsForActor,
    openPrintPreviewForActor: printCommandMocks.openPrintPreviewForActor,
    printPreparedJobForActor: printCommandMocks.printPreparedJobForActor,
    exportPreparedJobPdfForActor: printCommandMocks.exportPreparedJobPdfForActor,
    preparePrintJobForActor: printCommandMocks.preparePrintJobForActor,
    disposePrintJobForActor: printCommandMocks.disposePrintJobForActor
  }
})

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandActor: printCommandMocks.requireCommandActor
  }
})

import {
  exportPreparedJobPdfCommand,
  getPrintJobStatusCommand,
  getPrintPreviewModelCommand,
  printPreparedJobCommand
} from './printCommands'

describe('printCommands', () => {
  const context = {
    db: {
      prepare: vi.fn()
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli' as const
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-10T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    printCommandMocks.getPrintJobStatusForActor.mockReturnValue({
      status: 'ready',
      title: '打印任务',
      error: null,
      pageCount: 1,
      layoutVersion: 1,
      layoutError: null
    })
    printCommandMocks.getPrintPreviewModelForActor.mockReturnValue({
      title: '打印任务',
      pageCount: 1,
      layoutVersion: 1
    })
    printCommandMocks.printPreparedJobForActor.mockResolvedValue({ success: true })
    printCommandMocks.exportPreparedJobPdfForActor.mockResolvedValue({
      filePath: 'D:/tmp/output.pdf'
    })
  })

  it('returns NOT_FOUND when querying a missing print job status', async () => {
    printCommandMocks.getPrintJobStatusForActor.mockReturnValue(null)

    const result = await getPrintJobStatusCommand(context as never, { jobId: 'missing-job' })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'NOT_FOUND',
      message: '打印任务不存在',
      details: { jobId: 'missing-job' }
    })
  })

  it('returns CONFLICT when requesting preview model before the print job is ready', async () => {
    printCommandMocks.getPrintJobStatusForActor.mockReturnValue({
      status: 'preparing',
      title: '打印任务',
      error: null,
      pageCount: 0,
      layoutVersion: 0,
      layoutError: null
    })

    const result = await getPrintPreviewModelCommand(context as never, { jobId: 'job-1' })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'CONFLICT',
      message: '打印任务尚未完成',
      details: {
        jobId: 'job-1',
        status: 'preparing'
      }
    })
    expect(printCommandMocks.getPrintPreviewModelForActor).not.toHaveBeenCalled()
  })

  it('returns CONFLICT when system printing reports a runtime failure', async () => {
    printCommandMocks.printPreparedJobForActor.mockResolvedValue({
      success: false,
      error: 'printer offline'
    })

    const result = await printPreparedJobCommand(context as never, { jobId: 'job-2' })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'CONFLICT',
      message: 'printer offline',
      details: { jobId: 'job-2' }
    })
  })

  it('returns NOT_FOUND when exporting pdf for a missing job', async () => {
    printCommandMocks.getPrintJobStatusForActor.mockReturnValue(null)

    const result = await exportPreparedJobPdfCommand(context as never, {
      jobId: 'missing-job',
      outputPath: 'D:/tmp/output.pdf'
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'NOT_FOUND',
      message: '打印任务不存在',
      details: { jobId: 'missing-job' }
    })
    expect(printCommandMocks.exportPreparedJobPdfForActor).not.toHaveBeenCalled()
  })

  it('returns FORBIDDEN when lower print job lookup rejects access', async () => {
    printCommandMocks.getPrintJobStatusForActor.mockImplementation(() => {
      throw new CommandError('FORBIDDEN', '无权访问该打印任务', { jobId: 'job-3' }, 4)
    })

    const result = await getPrintPreviewModelCommand(context as never, { jobId: 'job-3' })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'FORBIDDEN',
      message: '无权访问该打印任务',
      details: { jobId: 'job-3' }
    })
  })
})

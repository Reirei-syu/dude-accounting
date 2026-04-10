import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const printHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const userDataDir = 'C:/Temp/dude-print-handler-test'

  class BrowserWindowMock {
    static fromWebContents = vi.fn(() => null)
    static getAllWindows = vi.fn(() => [])
  }

  return {
    handlers,
    userDataDir,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : userDataDir)),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    showSaveDialog: vi.fn(),
    browserWindowMock: BrowserWindowMock,
    getDatabase: vi.fn(() => ({ prepare: vi.fn() })),
    requireAuth: vi.fn(() => ({ id: 7, isAdmin: false })),
    requireLedgerAccess: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: printHandlerMocks.appGetPath },
  dialog: { showSaveDialog: printHandlerMocks.showSaveDialog },
  BrowserWindow: printHandlerMocks.browserWindowMock,
  ipcMain: { handle: printHandlerMocks.ipcHandle }
}))

vi.mock('../database/init', () => ({
  getDatabase: printHandlerMocks.getDatabase
}))

vi.mock('./session', () => ({
  requireAuth: printHandlerMocks.requireAuth,
  requireLedgerAccess: printHandlerMocks.requireLedgerAccess
}))

import { registerPrintHandlers } from './print'

function writePrintJob(jobId: string, partial: Record<string, unknown>): void {
  const jobDir = path.join(printHandlerMocks.userDataDir, 'print-jobs')
  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(
    path.join(jobDir, `${jobId}.json`),
    JSON.stringify({
      id: jobId,
      type: 'book',
      bookType: 'detail_ledger',
      preferenceKey: 'book_print_settings_detail_ledger',
      title: '测试打印任务',
      ledgerId: 1,
      createdBy: 7,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      status: 'preparing',
      orientation: 'portrait',
      settings: {
        orientation: 'portrait',
        scalePercent: 100,
        marginPreset: 'default',
        densityPreset: 'default'
      },
      sourceDocument: null,
      layoutResult: null,
      layoutVersion: 0,
      error: null,
      previewWebContentsId: null,
      ...partial
    }),
    'utf8'
  )
}

describe('print IPC handlers', () => {
  beforeEach(() => {
    fs.rmSync(printHandlerMocks.userDataDir, { recursive: true, force: true })
    printHandlerMocks.handlers.clear()
    vi.clearAllMocks()
    registerPrintHandlers()
  })

  afterEach(() => {
    fs.rmSync(printHandlerMocks.userDataDir, { recursive: true, force: true })
  })

  it('returns a conflict payload for print:print when the job is not ready', async () => {
    writePrintJob('job-preparing', {
      status: 'preparing',
      sourceDocument: null,
      layoutResult: null,
      error: null
    })
    const handler = printHandlerMocks.handlers.get('print:print')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, { jobId: 'job-preparing' })

    expect(result).toEqual({
      success: false,
      error: '打印任务尚未完成',
      errorCode: 'CONFLICT',
      errorDetails: {
        jobId: 'job-preparing',
        status: 'preparing'
      }
    })
  })

  it('returns a conflict payload and skips the save dialog for print:exportPdf when the job is not ready', async () => {
    writePrintJob('job-failed', {
      status: 'failed',
      sourceDocument: null,
      layoutResult: null,
      error: '生成打印任务失败'
    })
    const handler = printHandlerMocks.handlers.get('print:exportPdf')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, { jobId: 'job-failed' })

    expect(result).toEqual({
      success: false,
      error: '生成打印任务失败',
      errorCode: 'CONFLICT',
      errorDetails: {
        jobId: 'job-failed',
        status: 'failed'
      }
    })
    expect(printHandlerMocks.showSaveDialog).not.toHaveBeenCalled()
  })

  it('returns a forbidden payload for print:getPreviewModel when the job belongs to another user', async () => {
    writePrintJob('job-foreign', {
      createdBy: 8,
      status: 'ready',
      sourceDocument: {
        title: '测试打印任务',
        orientation: 'portrait',
        pageSize: 'A4',
        segments: []
      },
      layoutResult: {
        title: '测试打印任务',
        orientation: 'portrait',
        settings: {
          orientation: 'portrait',
          scalePercent: 100,
          marginPreset: 'default',
          densityPreset: 'default'
        },
        pageCount: 1,
        pages: [],
        diagnostics: {
          engine: 'page-model',
          overflowDetected: false,
          oversizeRowKeys: [],
          pageRowCounts: []
        }
      },
      layoutVersion: 1
    })
    const handler = printHandlerMocks.handlers.get('print:getPreviewModel')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, 'job-foreign')

    expect(result).toEqual({
      success: false,
      error: '无权访问该打印任务',
      errorCode: 'FORBIDDEN',
      errorDetails: { jobId: 'job-foreign' }
    })
  })

  it('returns a forbidden payload for print:openPreview when the job belongs to another user', async () => {
    writePrintJob('job-foreign-preview', {
      createdBy: 8,
      status: 'ready',
      sourceDocument: {
        title: '测试打印任务',
        orientation: 'portrait',
        pageSize: 'A4',
        segments: []
      },
      layoutResult: {
        title: '测试打印任务',
        orientation: 'portrait',
        settings: {
          orientation: 'portrait',
          scalePercent: 100,
          marginPreset: 'default',
          densityPreset: 'default'
        },
        pageCount: 1,
        pages: [],
        diagnostics: {
          engine: 'page-model',
          overflowDetected: false,
          oversizeRowKeys: [],
          pageRowCounts: []
        }
      },
      layoutVersion: 1
    })
    const handler = printHandlerMocks.handlers.get('print:openPreview')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, 'job-foreign-preview')

    expect(result).toEqual({
      success: false,
      error: '无权访问该打印任务',
      errorCode: 'FORBIDDEN',
      errorDetails: { jobId: 'job-foreign-preview' }
    })
  })
})

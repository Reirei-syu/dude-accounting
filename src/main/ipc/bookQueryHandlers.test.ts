import { beforeEach, describe, expect, it, vi } from 'vitest'

const bookQueryMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : 'D:/UserData')),
    showSaveDialog: vi.fn(),
    fromWebContents: vi.fn(() => ({ id: 1 })),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    buildBookQueryExportDefaultPath: vi.fn(),
    getBookQueryExportFilters: vi.fn(),
    getPreferredBookQueryExportDir: vi.fn(),
    rememberBookQueryExportDir: vi.fn(),
    withIpcTelemetry: vi.fn(
      async (_options: unknown, operation: () => unknown) => await operation()
    ),
    listSubjectBalancesCommand: vi.fn(),
    getDetailLedgerCommand: vi.fn(),
    getJournalCommand: vi.fn(),
    getAuxiliaryBalancesCommand: vi.fn(),
    getAuxiliaryDetailCommand: vi.fn(),
    exportBookQueryCommand: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: bookQueryMocks.appGetPath },
  dialog: {
    showSaveDialog: bookQueryMocks.showSaveDialog
  },
  BrowserWindow: {
    fromWebContents: bookQueryMocks.fromWebContents
  },
  ipcMain: {
    handle: bookQueryMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: bookQueryMocks.getDatabase
}))

vi.mock('../services/bookQueryExport', () => ({
  buildBookQueryExportDefaultPath: bookQueryMocks.buildBookQueryExportDefaultPath,
  getBookQueryExportFilters: bookQueryMocks.getBookQueryExportFilters,
  getPreferredBookQueryExportDir: bookQueryMocks.getPreferredBookQueryExportDir,
  rememberBookQueryExportDir: bookQueryMocks.rememberBookQueryExportDir
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: bookQueryMocks.withIpcTelemetry
}))

vi.mock('../commands/reportingCommands', () => ({
  listSubjectBalancesCommand: bookQueryMocks.listSubjectBalancesCommand,
  getDetailLedgerCommand: bookQueryMocks.getDetailLedgerCommand,
  getJournalCommand: bookQueryMocks.getJournalCommand,
  getAuxiliaryBalancesCommand: bookQueryMocks.getAuxiliaryBalancesCommand,
  getAuxiliaryDetailCommand: bookQueryMocks.getAuxiliaryDetailCommand,
  exportBookQueryCommand: bookQueryMocks.exportBookQueryCommand
}))

import { registerBookQueryHandlers } from './bookQuery'

describe('bookQuery IPC handlers', () => {
  beforeEach(() => {
    bookQueryMocks.handlers.clear()
    vi.clearAllMocks()
    bookQueryMocks.getPreferredBookQueryExportDir.mockReturnValue('D:/exports')
    bookQueryMocks.buildBookQueryExportDefaultPath.mockReturnValue('D:/exports/default-book.pdf')
    bookQueryMocks.getBookQueryExportFilters.mockReturnValue([
      { name: 'PDF 文档', extensions: ['pdf'] }
    ])
    bookQueryMocks.exportBookQueryCommand.mockResolvedValue({
      status: 'success',
      data: { filePath: 'D:/exports/final-book.pdf' },
      error: null
    })

    registerBookQueryHandlers()
  })

  it('uses the computed default file path when exporting a book query', async () => {
    bookQueryMocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'D:/exports/chosen-book.pdf'
    })
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '2025年12月-2026年1月',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(bookQueryMocks.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(bookQueryMocks.showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: 'D:/exports/default-book.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    })
    expect(bookQueryMocks.exportBookQueryCommand).toHaveBeenCalledWith(expect.anything(), {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '2025年12月-2026年1月',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }],
      filePath: 'D:/exports/chosen-book.pdf'
    })
    expect(result).toEqual({
      success: true,
      filePath: 'D:/exports/final-book.pdf'
    })
  })

  it('returns a cancelled result when the book export dialog is dismissed', async () => {
    bookQueryMocks.showSaveDialog.mockResolvedValue({
      canceled: true,
      filePath: undefined
    })
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '2025年12月-2026年1月',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(result).toEqual({
      success: false,
      cancelled: true
    })
    expect(bookQueryMocks.exportBookQueryCommand).not.toHaveBeenCalled()
  })

  it('returns a validation error when the export title is blank', async () => {
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '   ',
      subtitle: '',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(result).toEqual({
      success: false,
      error: '导出标题不能为空',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.exportBookQueryCommand).not.toHaveBeenCalled()
  })

  it('returns a validation error when the export columns are empty', async () => {
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(result).toEqual({
      success: false,
      error: '导出列不能为空',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.exportBookQueryCommand).not.toHaveBeenCalled()
  })

  it('returns a validation error when the export columns payload is malformed', async () => {
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: undefined,
      rows: undefined
    })

    expect(result).toEqual({
      success: false,
      error: '导出列不能为空',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.exportBookQueryCommand).not.toHaveBeenCalled()
  })

  it('returns a validation error when the export title payload is malformed', async () => {
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: undefined,
      subtitle: '',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(result).toEqual({
      success: false,
      error: '导出标题不能为空',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.exportBookQueryCommand).not.toHaveBeenCalled()
  })

  it('returns a structured error when the export command fails', async () => {
    bookQueryMocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'D:/exports/chosen-book.pdf'
    })
    bookQueryMocks.exportBookQueryCommand.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: {
        code: 'FORBIDDEN',
        message: '当前用户无权导出该账簿',
        details: { ledgerId: 1 }
      }
    })
    const event = { sender: { id: 1 } }
    const handler = bookQueryMocks.handlers.get('bookQuery:export')

    const result = await handler?.(event, {
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '明细账',
      subtitle: '',
      ledgerName: '测试账套',
      format: 'pdf',
      columns: [{ key: 'date', label: '日期', align: 'left' }],
      rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
    })

    expect(result).toEqual({
      success: false,
      error: '当前用户无权导出该账簿',
      errorCode: 'FORBIDDEN',
      errorDetails: { ledgerId: 1 }
    })
  })
})

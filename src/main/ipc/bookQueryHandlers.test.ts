import { beforeEach, describe, expect, it, vi } from 'vitest'

const bookQueryMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) =>
      name === 'documents' ? 'D:/Documents' : 'D:/UserData'
    ),
    showSaveDialog: vi.fn(),
    fromWebContents: vi.fn(() => ({ id: 1 })),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(),
    appendOperationLog: vi.fn(),
    buildBookQueryExportDefaultPath: vi.fn(),
    exportBookQueryToFile: vi.fn(),
    getBookQueryExportFilters: vi.fn(),
    getPreferredBookQueryExportDir: vi.fn(),
    normalizeBookQueryExportPayload: vi.fn(),
    rememberBookQueryExportDir: vi.fn(),
    withIpcTelemetry: vi.fn(async (_options: unknown, operation: () => unknown) => await operation()),
    requireAuth: vi.fn(),
    requireLedgerAccess: vi.fn(),
    listSubjectBalances: vi.fn(),
    getDetailLedger: vi.fn(),
    getJournal: vi.fn(),
    getAuxiliaryBalances: vi.fn(),
    getAuxiliaryDetail: vi.fn()
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

vi.mock('../services/auditLog', () => ({
  appendOperationLog: bookQueryMocks.appendOperationLog
}))

vi.mock('../services/bookQueryExport', () => ({
  buildBookQueryExportDefaultPath: bookQueryMocks.buildBookQueryExportDefaultPath,
  exportBookQueryToFile: bookQueryMocks.exportBookQueryToFile,
  getBookQueryExportFilters: bookQueryMocks.getBookQueryExportFilters,
  getPreferredBookQueryExportDir: bookQueryMocks.getPreferredBookQueryExportDir,
  normalizeBookQueryExportPayload: bookQueryMocks.normalizeBookQueryExportPayload,
  rememberBookQueryExportDir: bookQueryMocks.rememberBookQueryExportDir
}))

vi.mock('../services/bookQuery', () => ({
  listSubjectBalances: bookQueryMocks.listSubjectBalances,
  getDetailLedger: bookQueryMocks.getDetailLedger,
  getJournal: bookQueryMocks.getJournal,
  getAuxiliaryBalances: bookQueryMocks.getAuxiliaryBalances,
  getAuxiliaryDetail: bookQueryMocks.getAuxiliaryDetail
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: bookQueryMocks.withIpcTelemetry
}))

vi.mock('./session', () => ({
  requireAuth: bookQueryMocks.requireAuth,
  requireLedgerAccess: bookQueryMocks.requireLedgerAccess
}))

import { registerBookQueryHandlers } from './bookQuery'

describe('bookQuery IPC handlers', () => {
  const db = { tag: 'db' }
  const user = { id: 7, username: 'tester' }
  const normalizedPayload = {
    ledgerId: 1,
    bookType: 'detail_ledger',
    title: '明细账',
    subtitle: '2025年12月-2026年1月',
    ledgerName: '测试账套',
    subjectLabel: '科目：库存现金',
    periodLabel: '期间：2025-12-01 至 2026-01-31',
    format: 'pdf',
    columns: [{ key: 'col_1', label: '日期', align: 'left' }],
    rows: [{ key: 'row-1', cells: [{ value: '2025-12-01' }] }]
  }

  beforeEach(() => {
    bookQueryMocks.handlers.clear()
    vi.clearAllMocks()
    bookQueryMocks.getDatabase.mockReturnValue(db)
    bookQueryMocks.requireAuth.mockReturnValue(user)
    bookQueryMocks.requireLedgerAccess.mockImplementation(() => user)
    bookQueryMocks.normalizeBookQueryExportPayload.mockReturnValue(normalizedPayload)
    bookQueryMocks.getPreferredBookQueryExportDir.mockReturnValue('D:/exports')
    bookQueryMocks.buildBookQueryExportDefaultPath.mockReturnValue('D:/exports/default-book.pdf')
    bookQueryMocks.getBookQueryExportFilters.mockReturnValue([
      { name: 'PDF 文档', extensions: ['pdf'] }
    ])
    bookQueryMocks.exportBookQueryToFile.mockResolvedValue('D:/exports/final-book.pdf')

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
    expect(bookQueryMocks.exportBookQueryToFile).not.toHaveBeenCalled()
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
      error: '导出标题不能为空'
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.normalizeBookQueryExportPayload).not.toHaveBeenCalled()
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
      error: '导出列不能为空'
    })
    expect(bookQueryMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(bookQueryMocks.normalizeBookQueryExportPayload).not.toHaveBeenCalled()
  })
})

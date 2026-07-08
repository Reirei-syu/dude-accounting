import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportingMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : 'D:/UserData')),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    fromWebContents: vi.fn(() => ({ id: 1 })),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    buildReportExportDefaultPath: vi.fn(),
    getPreferredReportExportBatchDir: vi.fn(),
    getPreferredReportExportDir: vi.fn(),
    getReportExportFilters: vi.fn(),
    rememberReportExportBatchDir: vi.fn(),
    rememberReportExportDir: vi.fn(),
    buildNpoTaxTemplateFileName: vi.fn(),
    buildUniqueTaxTemplateOutputPath: vi.fn(),
    getPreferredTaxTemplateOutputDir: vi.fn(),
    rememberTaxTemplateOutputDirectory: vi.fn(),
    rememberTaxTemplateOutputFile: vi.fn(),
    resolveNpoTaxTemplatePeriod: vi.fn(),
    withIpcTelemetry: vi.fn(
      async (_options: unknown, operation: () => unknown) => await operation()
    ),
    getSessionByEvent: vi.fn(() => ({
      id: 7,
      username: 'tester',
      realName: '测试用户',
      permissions: {},
      isAdmin: true,
      ledgerIds: []
    })),
    listReportsCommand: vi.fn(),
    getReportDetailCommand: vi.fn(),
    exportReportCommand: vi.fn(),
    exportReportsBatchCommand: vi.fn(),
    exportTaxTemplateCommand: vi.fn(),
    generateReportCommand: vi.fn(),
    deleteReportCommand: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: reportingMocks.appGetPath },
  dialog: {
    showSaveDialog: reportingMocks.showSaveDialog,
    showOpenDialog: reportingMocks.showOpenDialog
  },
  BrowserWindow: {
    fromWebContents: reportingMocks.fromWebContents
  },
  ipcMain: {
    handle: reportingMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: reportingMocks.getDatabase
}))

vi.mock('../services/reportExport', () => ({
  buildReportExportDefaultPath: reportingMocks.buildReportExportDefaultPath,
  getPreferredReportExportBatchDir: reportingMocks.getPreferredReportExportBatchDir,
  getPreferredReportExportDir: reportingMocks.getPreferredReportExportDir,
  getReportExportFilters: reportingMocks.getReportExportFilters,
  rememberReportExportBatchDir: reportingMocks.rememberReportExportBatchDir,
  rememberReportExportDir: reportingMocks.rememberReportExportDir
}))

vi.mock('../services/npoTaxTemplateExport', () => ({
  buildNpoTaxTemplateFileName: reportingMocks.buildNpoTaxTemplateFileName,
  buildUniqueTaxTemplateOutputPath: reportingMocks.buildUniqueTaxTemplateOutputPath,
  getPreferredTaxTemplateOutputDir: reportingMocks.getPreferredTaxTemplateOutputDir,
  rememberTaxTemplateOutputDirectory: reportingMocks.rememberTaxTemplateOutputDirectory,
  rememberTaxTemplateOutputFile: reportingMocks.rememberTaxTemplateOutputFile,
  resolveNpoTaxTemplatePeriod: reportingMocks.resolveNpoTaxTemplatePeriod
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: reportingMocks.withIpcTelemetry
}))

vi.mock('./session', () => ({
  getSessionByEvent: reportingMocks.getSessionByEvent
}))

vi.mock('../commands/reportingCommands', () => ({
  listReportsCommand: reportingMocks.listReportsCommand,
  getReportDetailCommand: reportingMocks.getReportDetailCommand,
  exportReportCommand: reportingMocks.exportReportCommand,
  exportReportsBatchCommand: reportingMocks.exportReportsBatchCommand,
  exportTaxTemplateCommand: reportingMocks.exportTaxTemplateCommand,
  generateReportCommand: reportingMocks.generateReportCommand,
  deleteReportCommand: reportingMocks.deleteReportCommand
}))

import { registerReportingHandlers } from './reporting'

describe('reporting IPC handlers', () => {
  const detail = {
    id: 11,
    ledger_id: 1,
    report_type: 'income_statement',
    report_name: '2025.12-2026.03 利润表（含未记账凭证）',
    period: '2025.12-2026.03',
    start_period: '2025-12',
    end_period: '2026-03',
    as_of_date: null,
    include_unposted_vouchers: 1,
    generated_by: 9,
    generated_at: '2026-03-19T12:00:00.000Z',
    ledger_name: '演示账套',
    standard_type: 'enterprise',
    content: {
      title: '利润表',
      reportType: 'income_statement',
      period: '2025.12-2026.03',
      ledgerName: '演示账套',
      standardType: 'enterprise',
      generatedAt: '2026-03-19T12:00:00.000Z',
      scope: {
        mode: 'range',
        startPeriod: '2025-12',
        endPeriod: '2026-03',
        periodLabel: '2025.12-2026.03',
        startDate: '2025-12-01',
        endDate: '2026-03-31',
        asOfDate: null,
        includeUnpostedVouchers: true
      },
      sections: [],
      totals: []
    }
  }

  beforeEach(() => {
    reportingMocks.handlers.clear()
    vi.clearAllMocks()
    const fakeDb = {
      tag: 'db',
      prepare: vi.fn(() => ({
        get: vi.fn(() => ({ name: '演示民非' }))
      }))
    }
    reportingMocks.getDatabase.mockReturnValue(fakeDb)
    reportingMocks.getPreferredReportExportDir.mockReturnValue('D:/exports')
    reportingMocks.getPreferredReportExportBatchDir.mockReturnValue('D:/batch-exports')
    reportingMocks.getPreferredTaxTemplateOutputDir.mockReturnValue('D:/tax-exports')
    reportingMocks.resolveNpoTaxTemplatePeriod.mockReturnValue({
      declarationType: 'monthly',
      year: 2026,
      month: 7,
      startPeriod: '2026-07',
      endPeriod: '2026-07',
      startDate: '2026-07-01',
      endDate: '2026-07-31'
    })
    reportingMocks.buildNpoTaxTemplateFileName.mockReturnValue(
      '演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx'
    )
    reportingMocks.buildUniqueTaxTemplateOutputPath.mockReturnValue(
      'D:/tax-exports/演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx'
    )
    reportingMocks.buildReportExportDefaultPath.mockReturnValue('D:/exports/default-report.pdf')
    reportingMocks.getReportExportFilters.mockReturnValue([
      { name: 'PDF 文档', extensions: ['pdf'] }
    ])
    reportingMocks.getReportDetailCommand.mockResolvedValue({
      status: 'success',
      data: detail,
      error: null
    })
    reportingMocks.exportReportCommand.mockResolvedValue({
      status: 'success',
      data: { filePath: 'D:/exports/final-report.pdf' },
      error: null
    })
    reportingMocks.exportReportsBatchCommand.mockResolvedValue({
      status: 'success',
      data: {
        directoryPath: 'D:/exports',
        filePaths: ['D:/exports/one.pdf', 'D:/exports/two.pdf']
      },
      error: null
    })
    reportingMocks.exportTaxTemplateCommand.mockResolvedValue({
      status: 'success',
      data: {
        filePath: 'D:/tax-exports/演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx',
        ledgerId: 1,
        declarationType: 'monthly',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        templateVersion: 'npo-tax-template-v1'
      },
      error: null
    })
    registerReportingHandlers()
  })

  it('uses the computed default file path when exporting a single report', async () => {
    reportingMocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'D:/exports/chosen-report.pdf'
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:export')

    const result = await handler?.(event, {
      snapshotId: 11,
      ledgerId: 1,
      format: 'pdf'
    })

    expect(reportingMocks.showSaveDialog).toHaveBeenCalledTimes(1)
    expect(reportingMocks.showSaveDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: 'D:/exports/default-report.pdf',
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    })
    expect(reportingMocks.exportReportCommand).toHaveBeenCalledWith(expect.anything(), {
      snapshotId: 11,
      ledgerId: 1,
      format: 'pdf',
      filePath: 'D:/exports/chosen-report.pdf'
    })
    expect(result).toEqual({
      success: true,
      filePath: 'D:/exports/final-report.pdf'
    })
  })

  it('returns a cancelled result when the single export dialog is dismissed', async () => {
    reportingMocks.showSaveDialog.mockResolvedValue({
      canceled: true,
      filePath: undefined
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:export')

    const result = await handler?.(event, {
      snapshotId: 11,
      ledgerId: 1,
      format: 'pdf'
    })

    expect(result).toEqual({
      success: false,
      cancelled: true
    })
    expect(reportingMocks.exportReportCommand).not.toHaveBeenCalled()
  })

  it('returns a structured error and skips the save dialog when report detail lookup fails', async () => {
    reportingMocks.getReportDetailCommand.mockResolvedValueOnce({
      status: 'error',
      data: null,
      error: {
        code: 'NOT_FOUND',
        message: '报表快照不存在',
        details: { snapshotId: 11 }
      }
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:export')

    const result = await handler?.(event, {
      snapshotId: 11,
      ledgerId: 1,
      format: 'pdf'
    })

    expect(result).toEqual({
      success: false,
      error: '报表快照不存在',
      errorCode: 'NOT_FOUND',
      errorDetails: { snapshotId: 11 }
    })
    expect(reportingMocks.showSaveDialog).not.toHaveBeenCalled()
    expect(reportingMocks.exportReportCommand).not.toHaveBeenCalled()
  })

  it('returns a validation error for empty batch export payloads', async () => {
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportBatch')

    const result = await handler?.(event, {
      snapshotIds: [],
      ledgerId: 1,
      format: 'pdf'
    })

    expect(result).toEqual({
      success: false,
      error: '请先选择至少一张报表',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(reportingMocks.showOpenDialog).not.toHaveBeenCalled()
  })

  it('returns a validation error for malformed batch export payloads', async () => {
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportBatch')

    const result = await handler?.(event, {
      snapshotIds: undefined,
      ledgerId: 1,
      format: 'pdf'
    })

    expect(result).toEqual({
      success: false,
      error: '请先选择至少一张报表',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
    expect(reportingMocks.showOpenDialog).not.toHaveBeenCalled()
  })

  it('returns a structured error and skips the directory dialog when a batch member detail lookup fails', async () => {
    reportingMocks.getReportDetailCommand
      .mockResolvedValueOnce({
        status: 'success',
        data: detail,
        error: null
      })
      .mockResolvedValueOnce({
        status: 'error',
        data: null,
        error: {
          code: 'NOT_FOUND',
          message: '报表快照不存在',
          details: { snapshotId: 12 }
        }
      })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportBatch')

    const result = await handler?.(event, {
      snapshotIds: [11, 12],
      ledgerId: 1,
      format: 'pdf'
    })

    expect(result).toEqual({
      success: false,
      error: '报表快照不存在',
      errorCode: 'NOT_FOUND',
      errorDetails: { snapshotId: 12 }
    })
    expect(reportingMocks.showOpenDialog).not.toHaveBeenCalled()
    expect(reportingMocks.exportReportsBatchCommand).not.toHaveBeenCalled()
  })

  it('returns a cancelled result when the batch export directory dialog is dismissed', async () => {
    reportingMocks.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: []
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportBatch')

    const result = await handler?.(event, {
      snapshotIds: [11, 12],
      ledgerId: 1,
      format: 'pdf'
    })

    expect(reportingMocks.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(reportingMocks.showOpenDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: 'D:/batch-exports',
      properties: ['openDirectory', 'createDirectory']
    })
    expect(result).toEqual({
      success: false,
      cancelled: true
    })
    expect(reportingMocks.exportReportsBatchCommand).not.toHaveBeenCalled()
  })

  it('passes renderOptions through batch export payloads', async () => {
    reportingMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/exports']
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportBatch')

    const result = await handler?.(event, {
      snapshotIds: [11, 12],
      ledgerId: 1,
      format: 'pdf',
      renderOptions: {
        showCashflowPreviousAmount: false
      }
    })

    expect(reportingMocks.exportReportsBatchCommand).toHaveBeenCalledWith(expect.anything(), {
      snapshotIds: [11, 12],
      ledgerId: 1,
      format: 'pdf',
      directoryPath: 'D:/exports',
      renderOptions: {
        showCashflowPreviousAmount: false
      }
    })
    expect(result).toEqual({
      success: true,
      directoryPath: 'D:/exports',
      filePaths: ['D:/exports/one.pdf', 'D:/exports/two.pdf']
    })
    expect(reportingMocks.rememberReportExportBatchDir).toHaveBeenCalledWith(
      expect.anything(),
      'D:/exports'
    )
  })

  it('remembers the selected tax template output directory for the current user', async () => {
    reportingMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/tax-exports']
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:chooseTaxTemplateOutputDirectory')

    const result = await handler?.(event)

    expect(reportingMocks.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(reportingMocks.showOpenDialog.mock.calls[0]?.[1]).toMatchObject({
      defaultPath: 'D:/tax-exports',
      properties: ['openDirectory', 'createDirectory']
    })
    expect(reportingMocks.rememberTaxTemplateOutputDirectory).toHaveBeenCalledWith(
      expect.anything(),
      7,
      'D:/tax-exports'
    )
    expect(result).toEqual({
      success: true,
      directoryPath: 'D:/tax-exports'
    })
  })

  it('builds a unique tax template path and delegates export through the reporting command', async () => {
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportTaxTemplate')

    const result = await handler?.(event, {
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026,
      month: 7
    })

    expect(reportingMocks.resolveNpoTaxTemplatePeriod).toHaveBeenCalledWith({
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026,
      month: 7
    })
    expect(reportingMocks.buildUniqueTaxTemplateOutputPath).toHaveBeenCalledWith(
      'D:/tax-exports',
      '演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx'
    )
    expect(reportingMocks.exportTaxTemplateCommand).toHaveBeenCalledWith(expect.anything(), {
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026,
      month: 7,
      outputPath: 'D:/tax-exports/演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx'
    })
    expect(reportingMocks.rememberTaxTemplateOutputFile).toHaveBeenCalledWith(
      expect.anything(),
      7,
      'D:/tax-exports/演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx'
    )
    expect(result).toEqual({
      success: true,
      filePath: 'D:/tax-exports/演示民非_税务模板_月报_2026-07-01_2026-07-31.xlsx',
      ledgerId: 1,
      declarationType: 'monthly',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      templateVersion: 'npo-tax-template-v1'
    })
  })

  it('returns validation errors when tax template period input is invalid before export', async () => {
    reportingMocks.resolveNpoTaxTemplatePeriod.mockImplementationOnce(() => {
      throw new Error('月报需要指定 1-12 的月份')
    })
    const event = { sender: { id: 1 } }
    const handler = reportingMocks.handlers.get('reporting:exportTaxTemplate')

    const result = await handler?.(event, {
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026
    })

    expect(reportingMocks.exportTaxTemplateCommand).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      error: '月报需要指定 1-12 的月份',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: null
    })
  })
})

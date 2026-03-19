import { beforeEach, describe, expect, it, vi } from 'vitest'

const reportingMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) =>
      name === 'documents' ? 'D:/Documents' : 'D:/UserData'
    ),
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
    fromWebContents: vi.fn(() => ({ id: 1 })),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(),
    appendOperationLog: vi.fn(),
    buildReportExportDefaultPath: vi.fn(),
    exportReportSnapshotToFile: vi.fn(),
    exportReportSnapshotsBatch: vi.fn(),
    getPreferredReportExportDir: vi.fn(),
    getReportExportFilters: vi.fn(),
    rememberReportExportDir: vi.fn(),
    getReportSnapshotDetail: vi.fn(),
    withIpcTelemetry: vi.fn(async (_options: unknown, operation: () => unknown) => await operation()),
    requireAuth: vi.fn(),
    requireLedgerAccess: vi.fn()
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

vi.mock('../services/auditLog', () => ({
  appendOperationLog: reportingMocks.appendOperationLog
}))

vi.mock('../services/reportExport', () => ({
  buildReportExportDefaultPath: reportingMocks.buildReportExportDefaultPath,
  exportReportSnapshotToFile: reportingMocks.exportReportSnapshotToFile,
  exportReportSnapshotsBatch: reportingMocks.exportReportSnapshotsBatch,
  getPreferredReportExportDir: reportingMocks.getPreferredReportExportDir,
  getReportExportFilters: reportingMocks.getReportExportFilters,
  rememberReportExportDir: reportingMocks.rememberReportExportDir
}))

vi.mock('../services/reporting', () => ({
  getReportSnapshotDetail: reportingMocks.getReportSnapshotDetail
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: reportingMocks.withIpcTelemetry
}))

vi.mock('./session', () => ({
  requireAuth: reportingMocks.requireAuth,
  requireLedgerAccess: reportingMocks.requireLedgerAccess
}))

import { registerReportingHandlers } from './reporting'

describe('reporting IPC handlers', () => {
  const db = { tag: 'db' }
  const user = { id: 9, username: 'tester' }
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
    reportingMocks.getDatabase.mockReturnValue(db)
    reportingMocks.requireAuth.mockReturnValue(user)
    reportingMocks.requireLedgerAccess.mockImplementation(() => user)
    reportingMocks.getReportSnapshotDetail.mockReturnValue(detail)
    reportingMocks.getPreferredReportExportDir.mockReturnValue('D:/exports')
    reportingMocks.buildReportExportDefaultPath.mockReturnValue('D:/exports/default-report.pdf')
    reportingMocks.getReportExportFilters.mockReturnValue([
      { name: 'PDF 文档', extensions: ['pdf'] }
    ])
    reportingMocks.exportReportSnapshotToFile.mockResolvedValue('D:/exports/final-report.pdf')
    reportingMocks.exportReportSnapshotsBatch.mockResolvedValue([
      'D:/exports/one.pdf',
      'D:/exports/two.pdf'
    ])

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
    expect(reportingMocks.exportReportSnapshotToFile).not.toHaveBeenCalled()
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
      error: '请先选择至少一张报表'
    })
    expect(reportingMocks.showOpenDialog).not.toHaveBeenCalled()
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
      defaultPath: 'D:/exports',
      properties: ['openDirectory', 'createDirectory']
    })
    expect(result).toEqual({
      success: false,
      cancelled: true
    })
    expect(reportingMocks.exportReportSnapshotsBatch).not.toHaveBeenCalled()
  })
})

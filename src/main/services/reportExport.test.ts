import { describe, expect, it, vi } from 'vitest'
import {
  buildReportExportDefaultPath,
  exportReportSnapshotToFile,
  exportReportSnapshotsBatch,
  getDefaultReportExportRootDir,
  getPreferredReportExportDir,
  getReportExportFilters,
  rememberReportExportDir
} from './reportExport'
import type { ReportSnapshotDetail } from './reporting'

class FakePathPreferenceDb {
  values = new Map<string, string>()

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key) => {
          const value = this.values.get(String(key))
          return value ? { value } : undefined
        },
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized ===
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ) {
      return {
        get: () => undefined,
        run: (key, value) => {
          this.values.set(String(key), String(value))
          return { changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakePathPreferenceDb: ${normalized}`)
  }
}

function createDetail(reportName: string): ReportSnapshotDetail {
  return {
    id: 1,
    ledger_id: 1,
    report_type: 'balance_sheet',
    report_name: reportName,
    period: '2026.03',
    start_period: '2026-03',
    end_period: '2026-03',
    as_of_date: '2026-03-31',
    include_unposted_vouchers: 0,
    generated_by: 1,
    generated_at: '2026-03-19T12:00:00.000Z',
    ledger_name: '演示账套',
    standard_type: 'enterprise',
    content: {
      title: '资产负债表',
      reportType: 'balance_sheet',
      period: '2026.03',
      ledgerName: '演示账套',
      standardType: 'enterprise',
      generatedAt: '2026-03-19T12:00:00.000Z',
      scope: {
        mode: 'month',
        startPeriod: '2026-03',
        endPeriod: '2026-03',
        periodLabel: '2026.03',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        asOfDate: '2026-03-31',
        includeUnpostedVouchers: false
      },
      sections: [],
      totals: []
    }
  }
}

describe('reportExport service', () => {
  it('resolves report export preference with default fallback', () => {
    const db = new FakePathPreferenceDb()
    const documentsPath = 'D:/Users/Test/Documents'

    expect(getPreferredReportExportDir(db as never, documentsPath)).toBe(
      getDefaultReportExportRootDir(documentsPath)
    )

    rememberReportExportDir(db as never, 'D:/exports/report.pdf')

    expect(getPreferredReportExportDir(db as never, documentsPath)).toBe('D:/exports')
  })

  it('builds default path and filters for report export', () => {
    const detail = createDetail('2026.03 资产负债表')

    expect(buildReportExportDefaultPath('D:/exports', detail as never, 'xlsx')).toBe(
      'D:\\exports\\2026.03 资产负债表.xlsx'
    )
    expect(getReportExportFilters('xlsx')).toEqual([{ name: 'Excel 工作簿', extensions: ['xlsx'] }])
    expect(getReportExportFilters('pdf')).toEqual([{ name: 'PDF 文档', extensions: ['pdf'] }])
  })

  it('uses the provided pdf exporter for pdf output', async () => {
    const detail = createDetail('2026.03 资产负债表')
    const exportPdf = vi.fn(async (filePath: string) => filePath)

    const exportedPath = await exportReportSnapshotToFile(
      detail as never,
      'pdf',
      'D:/exports/report.pdf',
      exportPdf
    )

    expect(exportedPath).toBe('D:/exports/report.pdf')
    expect(exportPdf).toHaveBeenCalledTimes(1)
    expect(exportPdf.mock.calls[0]?.[0]).toBe('D:/exports/report.pdf')
  })

  it('builds batch export paths in a single place', async () => {
    const first = createDetail('2026.03 资产负债表')
    const second = createDetail('2026.03 利润表')
    const exportSingle = vi.fn(async (_detail, filePath: string) => filePath)

    const filePaths = await exportReportSnapshotsBatch(
      [first as never, second as never],
      'pdf',
      'D:/exports',
      exportSingle
    )

    expect(filePaths).toEqual([
      'D:\\exports\\2026.03 资产负债表.pdf',
      'D:\\exports\\2026.03 利润表.pdf'
    ])
    expect(exportSingle).toHaveBeenCalledTimes(2)
  })
})

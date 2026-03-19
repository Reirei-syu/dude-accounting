import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function createCrossYearIncomeDetail(): ReportSnapshotDetail {
  return {
    ...createDetail('2025.12-2026.03 利润表（含未记账凭证）'),
    report_type: 'income_statement',
    report_name: '2025.12-2026.03 利润表（含未记账凭证）',
    period: '2025.12-2026.03',
    start_period: '2025-12',
    end_period: '2026-03',
    as_of_date: null,
    include_unposted_vouchers: 1,
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
      tables: [
        {
          key: 'enterprise-income-statement',
          columns: [
            { key: 'item', label: '项目' },
            { key: 'current', label: '本期金额' },
            { key: 'previous', label: '上期金额' }
          ],
          rows: [
            {
              key: 'operating-revenue',
              cells: [
                { value: '一、营业收入' },
                { value: 57_000, isAmount: true },
                { value: 1_000, isAmount: true }
              ]
            }
          ]
        }
      ],
      sections: [],
      totals: []
    }
  }
}

describe('reportExport service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

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

  it('keeps cross-year report title area and period text stable across export formats', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-export-'))
    const detail = createCrossYearIncomeDetail()
    const exportPdf = vi.fn(async (filePath: string, html: string) => {
      expect(html).toContain('<h1>利润表</h1>')
      expect(html).toContain('会计期间：2025年12月-2026年3月')
      return filePath
    })
    const pdfPath = path.join(tempDir, 'income.pdf')

    await exportReportSnapshotToFile(detail as never, 'pdf', pdfPath, exportPdf)

    expect(exportPdf).toHaveBeenCalledTimes(1)

    const xlsxPath = path.join(tempDir, 'income.xlsx')
    await exportReportSnapshotToFile(detail as never, 'xlsx', xlsxPath, exportPdf)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet?.getCell(1, 1).value).toBe('利润表')
    expect(worksheet?.getCell(3, 1).value).toBe('会计期间：2025年12月-2026年3月')
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

  it('keeps cross-year batch export names readable and distinct', async () => {
    const first = createCrossYearIncomeDetail()
    const second = {
      ...createCrossYearIncomeDetail(),
      report_type: 'cashflow_statement' as const,
      report_name: '2025.12-2026.03 现金流量表（含未记账凭证）'
    }
    const exportSingle = vi.fn(async (_detail, filePath: string) => filePath)

    const filePaths = await exportReportSnapshotsBatch(
      [first as never, second as never],
      'pdf',
      'D:/exports',
      exportSingle
    )

    expect(filePaths).toEqual([
      'D:\\exports\\2025.12-2026.03 利润表（含未记账凭证）.pdf',
      'D:\\exports\\2025.12-2026.03 现金流量表（含未记账凭证）.pdf'
    ])
  })
})

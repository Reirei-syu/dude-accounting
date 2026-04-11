import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDefaultReportExportFileName,
  buildReportSnapshotHtml,
  writeReportSnapshotExcel,
  writeReportSnapshotHtml,
  writeReportSnapshotPdf
} from './reportSnapshotOutput'
import type { ReportSnapshotDetail } from './reporting'

function createCrossYearDetail(): ReportSnapshotDetail {
  return {
    id: 1,
    ledger_id: 1,
    report_type: 'income_statement',
    report_name: '2025.12-2026.03 利润表（含未记账凭证）',
    period: '2025.12-2026.03',
    start_period: '2025-12',
    end_period: '2026-03',
    as_of_date: null,
    include_unposted_vouchers: 1,
    generated_by: 1,
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

function createSameYearRangeDetail(): ReportSnapshotDetail {
  return {
    ...createCrossYearDetail(),
    content: {
      ...createCrossYearDetail().content,
      scope: {
        mode: 'range',
        startPeriod: '2026-01',
        endPeriod: '2026-03',
        periodLabel: '2026.01-2026.03',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        asOfDate: null,
        includeUnpostedVouchers: true
      }
    }
  }
}

function createMonthDetail(): ReportSnapshotDetail {
  return {
    ...createCrossYearDetail(),
    report_type: 'balance_sheet',
    report_name: '2026.03 资产负债表',
    period: '2026.03',
    start_period: '2026-03',
    end_period: '2026-03',
    as_of_date: '2026-03-31',
    include_unposted_vouchers: 0,
    content: {
      ...createCrossYearDetail().content,
      title: '资产负债表',
      reportType: 'balance_sheet',
      period: '2026.03',
      scope: {
        mode: 'month',
        startPeriod: '2026-03',
        endPeriod: '2026-03',
        periodLabel: '2026.03',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        asOfDate: '2026-03-31',
        includeUnpostedVouchers: false
      }
    }
  }
}

describe('reportSnapshotOutput service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('formats month, same-year range and cross-year range labels in html output', () => {
    const monthHtml = buildReportSnapshotHtml(createMonthDetail())
    const sameYearHtml = buildReportSnapshotHtml(createSameYearRangeDetail())
    const crossYearHtml = buildReportSnapshotHtml(createCrossYearDetail())

    expect(monthHtml).toContain('会计期间：2026年3月31日')
    expect(sameYearHtml).toContain('会计期间：2026年1-3月')
    expect(crossYearHtml).toContain('会计期间：2025年12月-2026年3月')
    expect(crossYearHtml).not.toContain('取数范围')
    expect(crossYearHtml).not.toContain('口径')
    expect(crossYearHtml).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto')
    expect(crossYearHtml).toContain('white-space: nowrap')
    expect(crossYearHtml).toContain('570.00')
  })

  it('sanitizes cross-year export file names', () => {
    const detail = {
      ...createCrossYearDetail(),
      report_name: '2025.12-2026.03 利润表:含未记账凭证'
    }

    expect(buildDefaultReportExportFileName(detail, 'pdf')).toBe(
      '2025.12-2026.03 利润表_含未记账凭证.pdf'
    )
  })

  it('writes cross-year excel and html exports with stable title metadata', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-output-'))
    const detail = createCrossYearDetail()
    const xlsxPath = path.join(tempDir, 'report.xlsx')
    const htmlPath = writeReportSnapshotHtml(tempDir, detail, new Date(2026, 2, 19, 12, 34, 56))

    await writeReportSnapshotExcel(xlsxPath, detail)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet?.getCell(1, 1).value).toBe('利润表')
    expect(worksheet?.getCell(3, 1).value).toBe('会计期间：2025年12月-2026年3月')
    expect(path.basename(htmlPath)).toBe(
      '2025.12-2026.03 利润表（含未记账凭证）-20260319-123456.html'
    )
    expect(fs.readFileSync(htmlPath, 'utf8')).toContain('会计期间：2025年12月-2026年3月')
  })

  it('adds subtotal and total row styles in html and excel exports', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-output-'))
    const detail: ReportSnapshotDetail = {
      ...createCrossYearDetail(),
      content: {
        ...createCrossYearDetail().content,
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
                key: 'liability-total',
                cells: [
                  { value: '负债合计' },
                  { value: 57000, isAmount: true },
                  { value: 1000, isAmount: true }
                ]
              },
              {
                key: 'all-total',
                cells: [
                  { value: '资产总计' },
                  { value: 67000, isAmount: true },
                  { value: 2000, isAmount: true }
                ]
              }
            ]
          }
        ]
      }
    }
    const html = buildReportSnapshotHtml(detail)
    const xlsxPath = path.join(tempDir, 'report-highlight.xlsx')

    await writeReportSnapshotExcel(xlsxPath, detail)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(html).toContain('class="report-row-subtotal"')
    expect(html).toContain('class="report-row-total"')
    expect((worksheet?.getCell(5, 1).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb).toBe('FFECFDF5')
    expect((worksheet?.getCell(6, 1).fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb).toBe('FFEFF6FF')
  })
  it('falls back for blank report names and blank titles in export artifacts', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-output-'))
    const detail = {
      ...createCrossYearDetail(),
      report_name: '   ',
      content: {
        ...createCrossYearDetail().content,
        title: '   '
      }
    }
    const xlsxPath = path.join(tempDir, 'blank.xlsx')

    await writeReportSnapshotExcel(xlsxPath, detail)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(buildDefaultReportExportFileName(detail, 'pdf')).toBe('报表导出.pdf')
    expect(worksheet?.name).toBe('报表导出')
    expect(worksheet?.getCell(1, 1).value).toBe('报表导出')
    expect(buildReportSnapshotHtml(detail)).toContain('<h1>报表导出</h1>')
  })

  it('sanitizes long worksheet names and fills blank column labels', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-output-'))
    const detail = {
      ...createCrossYearDetail(),
      content: {
        ...createCrossYearDetail().content,
        title: `${'超长利润表标题'.repeat(8)}[]:*?/\\`,
        tables: [
          {
            key: 'enterprise-income-statement',
            columns: [
              { key: 'item', label: '项目' },
              { key: 'current', label: '   ' },
              { key: 'previous', label: '' }
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
        ]
      }
    }
    const xlsxPath = path.join(tempDir, 'long.xlsx')

    await writeReportSnapshotExcel(xlsxPath, detail)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet?.name.length).toBeLessThanOrEqual(31)
    expect(worksheet?.name).not.toMatch(/[[\]:*?/\\]/)
    expect(worksheet?.getCell(4, 1).value).toBe('项目')
    expect(worksheet?.getCell(4, 2).value).toBe('列2')
    expect(worksheet?.getCell(4, 3).value).toBe('列3')
  })

  it('hides cashflow previous columns across html, excel and pdf exports when requested', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-output-'))
    const detail: ReportSnapshotDetail = {
      ...createCrossYearDetail(),
      report_type: 'cashflow_statement',
      report_name: '现金流量表',
      content: {
        ...createCrossYearDetail().content,
        title: '现金流量表',
        reportType: 'cashflow_statement',
        tables: [
          {
            key: 'cashflow',
            columns: [
              { key: 'item', label: '项目' },
              { key: 'current', label: '本年金额' },
              { key: 'previous', label: '上年金额' }
            ],
            rows: [
              {
                key: 'operating-net',
                cells: [
                  { value: '业务活动产生的现金流量净额' },
                  { value: 13_000, isAmount: true },
                  { value: 4_500, isAmount: true }
                ]
              }
            ]
          }
        ]
      }
    }
    const xlsxPath = path.join(tempDir, 'cashflow.xlsx')
    const pdfPath = path.join(tempDir, 'cashflow.pdf')

    const html = buildReportSnapshotHtml(detail, { showCashflowPreviousAmount: false })
    await writeReportSnapshotExcel(xlsxPath, detail, { showCashflowPreviousAmount: false })
    await writeReportSnapshotPdf(pdfPath, detail, { showCashflowPreviousAmount: false })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(xlsxPath)
    const worksheet = workbook.worksheets[0]

    expect(html).toContain('本年金额')
    expect(html).not.toContain('上年金额')
    expect(worksheet?.getCell(4, 1).value).toBe('项目')
    expect(worksheet?.getCell(4, 2).value).toBe('本年金额')
    expect(worksheet?.getCell(4, 3).value).not.toBe('上年金额')
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0)
  })
})

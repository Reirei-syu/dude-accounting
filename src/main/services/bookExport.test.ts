import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildDefaultBookExportFileName,
  writeBookExportExcel,
  writeBookExportPdf,
  type BookExportPayload
} from './bookExport'

describe('bookExport service', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = null
  })

  function createPayload(): BookExportPayload {
    return {
      ledgerId: 1,
      bookType: 'subject_balance',
      title: '科目余额表',
      subtitle: '2026-01-01至2026-03-11',
      ledgerName: '测试账套',
      periodLabel: '2026-01-01 至 2026-03-11',
      columns: [
        { key: 'subject_code', label: '科目编码', align: 'left' },
        { key: 'subject_name', label: '科目名称', align: 'left' },
        { key: 'ending_balance', label: '期末余额', align: 'right' }
      ],
      rows: [
        {
          key: '1001',
          cells: [{ value: '1001' }, { value: '库存现金' }, { value: 1200.5, isAmount: true }]
        },
        {
          key: '2202',
          cells: [{ value: '2202' }, { value: '应付账款' }, { value: 980.25, isAmount: true }]
        }
      ]
    }
  }

  it('builds default book export file names', () => {
    expect(buildDefaultBookExportFileName(createPayload(), 'xlsx')).toBe(
      '科目余额表-2026-01-01至2026-03-11.xlsx'
    )
  })

  it('falls back to subject and cross-year period labels when subtitle is absent', () => {
    const payload = {
      ...createPayload(),
      title: '序时账',
      subtitle: undefined,
      subjectLabel: '科目：库存现金',
      periodLabel: '期间：2025-12-01 至 2026-01-31'
    }

    expect(buildDefaultBookExportFileName(payload, 'xlsx')).toBe(
      '序时账-科目：库存现金-期间：2025-12-01 至 2026-01-31.xlsx'
    )
  })

  it('writes excel and pdf exports for save-as flow', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = createPayload()
    const excelPath = path.join(tempDir, '科目余额表.xlsx')
    const pdfPath = path.join(tempDir, '科目余额表.pdf')

    await writeBookExportExcel(excelPath, payload)
    await writeBookExportPdf(pdfPath, payload)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(excelPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet.getCell(1, 1).value).toBe('科目余额表')
    expect(worksheet.getCell(2, 1).value).toBe('测试账套')
    expect(worksheet.getCell(3, 1).value).toBe('2026-01-01 至 2026-03-11')
    expect(worksheet.getCell(3, 1).alignment?.horizontal).toBe('right')
    expect(worksheet.getCell(5, 1).value).toBe('科目编码')
    expect(worksheet.getCell(6, 1).value).toBe('1001')
    expect(worksheet.getCell(6, 3).value).toBe(1200.5)
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0)
  })

  it('writes multi-page pdf exports for long books without breaking header redraw path', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = {
      ...createPayload(),
      title: 'Ledger Detail',
      ledgerName: 'Demo Ledger',
      subjectLabel: 'Subject: Cash on Hand',
      periodLabel: 'Period: 2026-01-01 to 2026-12-31',
      rows: Array.from({ length: 160 }, (_, index) => ({
        key: `row-${index + 1}`,
        cells: [
          { value: `100${index}` },
          { value: `Line ${index + 1}` },
          { value: Number(index) + 0.5, isAmount: true }
        ]
      }))
    }
    const pdfPath = path.join(tempDir, 'ledger-detail.pdf')

    await writeBookExportPdf(pdfPath, payload)

    const pdfContent = fs.readFileSync(pdfPath)
    const pageCount = (pdfContent.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0)
    expect(pageCount).toBeGreaterThan(1)
  })

  it('splits subject and cross-year period metadata into separate excel header cells', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = {
      ...createPayload(),
      title: '序时账',
      subtitle: undefined,
      subjectLabel: '科目：库存现金',
      periodLabel: '期间：2025-12-01 至 2026-01-31'
    }
    const excelPath = path.join(tempDir, '序时账.xlsx')

    await writeBookExportExcel(excelPath, payload)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(excelPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet.getCell(1, 1).value).toBe('序时账')
    expect(worksheet.getCell(3, 1).value).toBe('科目：库存现金')
    expect(worksheet.getCell(3, 2).value).toBe('期间：2025-12-01 至 2026-01-31')
    expect(worksheet.getCell(3, 2).alignment?.horizontal).toBe('right')
  })
  it('falls back to a safe file name when title and metadata are blank', () => {
    const payload = {
      ...createPayload(),
      title: '   ',
      subtitle: undefined,
      subjectLabel: undefined,
      periodLabel: undefined
    }

    expect(buildDefaultBookExportFileName(payload, 'pdf')).toBe('账簿导出.pdf')
  })

  it('sanitizes invalid and overlong sheet names and fills blank column labels', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = {
      ...createPayload(),
      title: `${'超长账簿标题'.repeat(8)}[]:*?/\\`,
      columns: [
        { key: 'col_1', label: '   ', align: 'left' as const },
        { key: 'col_2', label: '', align: 'left' as const },
        { key: 'col_3', label: '期末余额', align: 'right' as const }
      ]
    }
    const excelPath = path.join(tempDir, '异常标题.xlsx')

    await writeBookExportExcel(excelPath, payload)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(excelPath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet.name.length).toBeLessThanOrEqual(31)
    expect(worksheet.name).not.toMatch(/[[\]:*?/\\]/)
    expect(worksheet.getCell(5, 1).value).toBe('列1')
    expect(worksheet.getCell(5, 2).value).toBe('列2')
    expect(worksheet.getCell(5, 3).value).toBe('期末余额')
  })
})

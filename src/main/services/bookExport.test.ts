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
})

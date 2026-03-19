import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildBookQueryExportDefaultPath,
  exportBookQueryToFile,
  getBookQueryExportFilters,
  getDefaultBookQueryExportRootDir,
  getPreferredBookQueryExportDir,
  normalizeBookQueryExportPayload,
  rememberBookQueryExportDir,
  type BookQueryExportPayload
} from './bookQueryExport'

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

function createPayload(overrides?: Partial<BookQueryExportPayload>): BookQueryExportPayload {
  return {
    ledgerId: 1,
    bookType: 'detail_ledger',
    title: '明细账',
    subtitle: ' 2026年3月 ',
    ledgerName: ' 测试账套 ',
    subjectLabel: '科目：银行存款',
    periodLabel: '期间：2026-03-01 至 2026-03-31',
    format: 'xlsx',
    columns: [
      { key: '', label: '日期', align: 'left' },
      { key: 'summary', label: '摘要', align: 'left' }
    ],
    rows: [
      {
        key: '',
        cells: [{ value: '2026-03-01' }, { value: '摘要' }]
      }
    ],
    ...overrides
  }
}

describe('bookQueryExport service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('resolves export preference with default fallback', () => {
    const db = new FakePathPreferenceDb()
    const documentsPath = 'D:/Users/Test/Documents'

    expect(getPreferredBookQueryExportDir(db as never, documentsPath)).toBe(
      getDefaultBookQueryExportRootDir(documentsPath)
    )

    rememberBookQueryExportDir(db as never, 'D:/exports/book.pdf')

    expect(getPreferredBookQueryExportDir(db as never, documentsPath)).toBe('D:/exports')
  })

  it('normalizes payload and builds default path', () => {
    const payload = normalizeBookQueryExportPayload(createPayload())

    expect(payload.title).toBe('明细账')
    expect(payload.subtitle).toBe('2026年3月')
    expect(payload.ledgerName).toBe('测试账套')
    expect(payload.columns[0]?.key).toBe('col_1')
    expect(payload.rows[0]?.key).toBe('row-1')
    expect(buildBookQueryExportDefaultPath('D:/exports', payload)).toBe(
      'D:\\exports\\明细账-2026年3月.xlsx'
    )
  })

  it('falls back to subject and cross-year period labels when subtitle is absent', () => {
    const payload = normalizeBookQueryExportPayload(
      createPayload({
        title: '序时账',
        subtitle: undefined,
        periodLabel: '期间：2025-12-01 至 2026-01-31'
      })
    )

    expect(buildBookQueryExportDefaultPath('D:/exports', payload)).toBe(
      'D:\\exports\\序时账-科目：银行存款-期间：2025-12-01 至 2026-01-31.xlsx'
    )
  })

  it('returns export filters by format', () => {
    expect(getBookQueryExportFilters('xlsx')).toEqual([
      { name: 'Excel 工作簿', extensions: ['xlsx'] }
    ])
    expect(getBookQueryExportFilters('pdf')).toEqual([{ name: 'PDF 文档', extensions: ['pdf'] }])
  })

  it('writes cross-year subject and period labels into excel header rows', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = normalizeBookQueryExportPayload(
      createPayload({
        title: '序时账',
        subtitle: undefined,
        subjectLabel: '科目：库存现金',
        periodLabel: '期间：2025-12-01 至 2026-01-31'
      })
    )
    const filePath = path.join(tempDir, 'book.xlsx')

    await exportBookQueryToFile(payload, filePath)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(filePath)
    const worksheet = workbook.worksheets[0]

    expect(worksheet?.getCell(1, 1).value).toBe('序时账')
    expect(worksheet?.getCell(3, 1).value).toBe('科目：库存现金')
    expect(worksheet?.getCell(3, 2).value).toBe('期间：2025-12-01 至 2026-01-31')
  })

  it('exports through the matching book export writer', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-book-export-'))
    const payload = normalizeBookQueryExportPayload(createPayload())
    const filePath = path.join(tempDir, 'book.pdf')
    const exportedPath = await exportBookQueryToFile(
      {
        ...payload,
        format: 'pdf'
      },
      filePath
    )

    expect(exportedPath).toBe(filePath)
    expect(fs.existsSync(filePath)).toBe(true)
  })
})

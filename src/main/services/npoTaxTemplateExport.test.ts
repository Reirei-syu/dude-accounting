import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportNpoTaxTemplate,
  getDefaultTaxTemplateOutputDir,
  getPreferredTaxTemplateOutputDir,
  normalizeTaxTemplateOutputPath,
  rememberTaxTemplateOutputDir,
  rememberTaxTemplateOutputDirectory,
  rememberTaxTemplateOutputFile,
  resolveNpoTaxTemplatePeriod
} from './npoTaxTemplateExport'

type LedgerRecord = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  taxpayer_identification_number: string
}

type SubjectRecord = {
  ledger_id: number
  code: string
  name: string
  category: string
  balance_direction: number
}

type InitialBalanceRecord = {
  ledger_id: number
  period: string
  subject_code: string
  debit_amount: number
  credit_amount: number
}

type VoucherRecord = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  status: 0 | 1 | 2 | 3
  is_carry_forward: number
}

type VoucherEntryRecord = {
  id: number
  voucher_id: number
  row_order: number
  subject_code: string
  debit_amount: number
  credit_amount: number
  cash_flow_item_id: number | null
}

type CashFlowItemRecord = {
  id: number
  ledger_id: number
  code: string
  name: string
  category: 'operating' | 'investing' | 'financing'
  direction: 'inflow' | 'outflow'
}

class FakeTaxTemplateDb {
  readonly ledgers: LedgerRecord[] = []
  readonly subjects: SubjectRecord[] = []
  readonly initialBalances: InitialBalanceRecord[] = []
  readonly vouchers: VoucherRecord[] = []
  readonly voucherEntries: VoucherEntryRecord[] = []
  readonly cashFlowItems: CashFlowItemRecord[] = []
  readonly reportSnapshotInserts: unknown[][] = []
  readonly userPreferences = new Map<string, string>()

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      'SELECT id, name, standard_type, start_period, current_period, taxpayer_identification_number FROM ledgers WHERE id = ?'
    ) {
      return {
        get: (ledgerId) => this.ledgers.find((ledger) => ledger.id === Number(ledgerId)),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT id, name, standard_type, start_period, current_period FROM ledgers WHERE id = ?'
    ) {
      return {
        get: (ledgerId) => this.ledgers.find((ledger) => ledger.id === Number(ledgerId)),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT code, name, category, balance_direction FROM subjects WHERE ledger_id = ? ORDER BY code ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.subjects
            .filter((subject) => subject.ledger_id === Number(ledgerId))
            .sort((left, right) => left.code.localeCompare(right.code)),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT subject_code, period, debit_amount, credit_amount FROM initial_balances WHERE ledger_id = ? AND period <= ? ORDER BY period ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, period) =>
          this.initialBalances
            .filter((row) => row.ledger_id === Number(ledgerId) && row.period <= String(period))
            .sort((left, right) => left.period.localeCompare(right.period)),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT id, period, voucher_date, status, is_carry_forward FROM vouchers WHERE ledger_id = ? AND voucher_date >= ? AND voucher_date <= ? AND status IN (0, 1, 2) ORDER BY voucher_date ASC, id ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, startDate, endDate) =>
          this.vouchers
            .filter(
              (voucher) =>
                voucher.ledger_id === Number(ledgerId) &&
                voucher.status !== 3 &&
                voucher.voucher_date >= String(startDate) &&
                voucher.voucher_date <= String(endDate)
            )
            .sort((left, right) => {
              if (left.voucher_date !== right.voucher_date) {
                return left.voucher_date.localeCompare(right.voucher_date)
              }
              return left.id - right.id
            }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized.startsWith(
        'SELECT id, voucher_id, row_order, subject_code, debit_amount, credit_amount, cash_flow_item_id FROM voucher_entries WHERE voucher_id IN ('
      )
    ) {
      return {
        get: () => undefined,
        all: (...voucherIds) =>
          this.voucherEntries
            .filter((entry) => voucherIds.map(Number).includes(entry.voucher_id))
            .sort((left, right) => {
              if (left.voucher_id !== right.voucher_id) return left.voucher_id - right.voucher_id
              if (left.row_order !== right.row_order) return left.row_order - right.row_order
              return left.id - right.id
            }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT id, code, name, category, direction FROM cash_flow_items WHERE ledger_id = ? ORDER BY category ASC, code ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.cashFlowItems
            .filter((item) => item.ledger_id === Number(ledgerId))
            .sort((left, right) => {
              if (left.category !== right.category) {
                return left.category.localeCompare(right.category)
              }
              return left.code.localeCompare(right.code)
            }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'INSERT INTO report_snapshots ( ledger_id, report_type, report_name, period, start_period, end_period, as_of_date, include_unposted_vouchers, generated_by, generated_at, content_json ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...params) => {
          this.reportSnapshotInserts.push(params)
          return { lastInsertRowid: 1, changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT value FROM user_preferences WHERE user_id = ? AND key = ?') {
      return {
        get: (userId, key) => {
          const value = this.userPreferences.get(`${String(userId)}:${String(key)}`)
          return value === undefined ? undefined : { value }
        },
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      "INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (userId, key, value) => {
          this.userPreferences.set(`${String(userId)}:${String(key)}`, String(value))
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeTaxTemplateDb: ${normalized}`)
  }
}

const templatePath = path.join(
  process.cwd(),
  'resources',
  'tax-templates',
  'npo',
  'npo-tax-template-v1.xlsx'
)

function seedNpoLedger(db: FakeTaxTemplateDb): void {
  db.ledgers.push({
    id: 1,
    name: '民非测试单位',
    standard_type: 'npo',
    start_period: '2026-01',
    current_period: '2026-03',
    taxpayer_identification_number: '91310000TESTNPO001'
  })

  db.subjects.push(
    { ledger_id: 1, code: '1002', name: '银行存款', category: 'asset', balance_direction: 1 },
    { ledger_id: 1, code: '3101', name: '非限定性净资产', category: 'net_assets', balance_direction: -1 },
    { ledger_id: 1, code: '430101', name: '提供服务收入-非限定性', category: 'income', balance_direction: -1 },
    { ledger_id: 1, code: '5301', name: '管理费用', category: 'expense', balance_direction: 1 }
  )

  db.initialBalances.push(
    { ledger_id: 1, period: '2026-01', subject_code: '1002', debit_amount: 50_000, credit_amount: 0 },
    { ledger_id: 1, period: '2026-01', subject_code: '3101', debit_amount: 0, credit_amount: 50_000 }
  )

  db.cashFlowItems.push(
    {
      id: 1,
      ledger_id: 1,
      code: 'CF01',
      name: '提供服务收到的现金',
      category: 'operating',
      direction: 'inflow'
    },
    {
      id: 2,
      ledger_id: 1,
      code: 'CF07',
      name: '支付的其他与业务活动有关的现金',
      category: 'operating',
      direction: 'outflow'
    }
  )

  db.vouchers.push(
    { id: 101, ledger_id: 1, period: '2026-01', voucher_date: '2026-01-15', status: 2, is_carry_forward: 0 },
    { id: 102, ledger_id: 1, period: '2026-02', voucher_date: '2026-02-15', status: 1, is_carry_forward: 0 },
    { id: 103, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-15', status: 2, is_carry_forward: 0 },
    { id: 104, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-18', status: 2, is_carry_forward: 0 },
    { id: 105, ledger_id: 1, period: '2026-04', voucher_date: '2026-04-01', status: 2, is_carry_forward: 0 }
  )

  db.voucherEntries.push(
    { id: 1, voucher_id: 101, row_order: 1, subject_code: '1002', debit_amount: 10_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 2, voucher_id: 101, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 10_000, cash_flow_item_id: null },
    { id: 3, voucher_id: 102, row_order: 1, subject_code: '1002', debit_amount: 40_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 4, voucher_id: 102, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 40_000, cash_flow_item_id: null },
    { id: 5, voucher_id: 103, row_order: 1, subject_code: '1002', debit_amount: 20_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 6, voucher_id: 103, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 20_000, cash_flow_item_id: null },
    { id: 7, voucher_id: 104, row_order: 1, subject_code: '5301', debit_amount: 5_000, credit_amount: 0, cash_flow_item_id: null },
    { id: 8, voucher_id: 104, row_order: 2, subject_code: '1002', debit_amount: 0, credit_amount: 5_000, cash_flow_item_id: 2 },
    { id: 9, voucher_id: 105, row_order: 1, subject_code: '1002', debit_amount: 30_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 10, voucher_id: 105, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 30_000, cash_flow_item_id: null }
  )
}

function seedEnterpriseLedger(db: FakeTaxTemplateDb): void {
  db.ledgers.push({
    id: 2,
    name: '企业测试单位',
    standard_type: 'enterprise',
    start_period: '2026-01',
    current_period: '2026-03',
    taxpayer_identification_number: '91310000TESTENT001'
  })
}

function getWorksheetMerges(sheet: ExcelJS.Worksheet): string[] {
  const model = sheet.model as { merges?: string[] }
  return [...(model.merges ?? [])].sort()
}

function getFormulaMap(sheet: ExcelJS.Worksheet): Record<string, string> {
  const formulas: Record<string, string> = {}
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cell.value
      if (value && typeof value === 'object' && 'formula' in value) {
        formulas[cell.address] = String(value.formula)
      }
    })
  })
  return formulas
}

function cloneStyle(style: Partial<ExcelJS.Style>): Partial<ExcelJS.Style> {
  const cloned = JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>
  if (cloned.numFmt === 'General') {
    delete cloned.numFmt
  }
  if (cloned.alignment) {
    const alignment = cloned.alignment as {
      indent?: number
      shrinkToFit?: boolean
      textRotation?: number
      wrapText?: boolean
    }
    if (alignment.indent === 0) delete alignment.indent
    if (alignment.shrinkToFit === false) delete alignment.shrinkToFit
    if (alignment.textRotation === 0) delete alignment.textRotation
    if (alignment.wrapText === false) delete alignment.wrapText
  }
  return cloned
}

function expectWorksheetStructurePreserved(
  sourceSheet: ExcelJS.Worksheet,
  exportedSheet: ExcelJS.Worksheet,
  styleCells: string[]
): void {
  expect(exportedSheet.rowCount).toBe(sourceSheet.rowCount)
  expect(exportedSheet.columnCount).toBe(sourceSheet.columnCount)
  expect(getWorksheetMerges(exportedSheet)).toEqual(getWorksheetMerges(sourceSheet))
  expect(getFormulaMap(exportedSheet)).toEqual(getFormulaMap(sourceSheet))

  for (let rowNumber = 1; rowNumber <= sourceSheet.rowCount; rowNumber += 1) {
    expect(exportedSheet.getRow(rowNumber).height).toBe(sourceSheet.getRow(rowNumber).height)
  }

  for (let columnNumber = 1; columnNumber <= sourceSheet.columnCount; columnNumber += 1) {
    expect(exportedSheet.getColumn(columnNumber).width).toBe(
      sourceSheet.getColumn(columnNumber).width
    )
  }

  for (const address of styleCells) {
    expect(cloneStyle(exportedSheet.getCell(address).style)).toEqual(
      cloneStyle(sourceSheet.getCell(address).style)
    )
  }
}

describe('npoTaxTemplateExport service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('maps declaration periods to exact date ranges', () => {
    expect(resolveNpoTaxTemplatePeriod({ declarationType: 'monthly', year: 2026, month: 2 })).toMatchObject({
      startPeriod: '2026-02',
      endPeriod: '2026-02',
      startDate: '2026-02-01',
      endDate: '2026-02-28'
    })
    expect(resolveNpoTaxTemplatePeriod({ declarationType: 'quarterly', year: 2026, quarter: 4 })).toMatchObject({
      startPeriod: '2026-10',
      endPeriod: '2026-12',
      startDate: '2026-10-01',
      endDate: '2026-12-31'
    })
    expect(resolveNpoTaxTemplatePeriod({ declarationType: 'annual', year: 2026 })).toMatchObject({
      startPeriod: '2026-01',
      endPeriod: '2026-12',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    })
  })

  it('normalizes WSL-style output paths on Windows', () => {
    const normalized = normalizeTaxTemplateOutputPath('/mnt/d/exports/tax-template.xlsx')

    if (process.platform === 'win32') {
      expect(normalized).toBe('D:\\exports\\tax-template.xlsx')
    } else {
      expect(normalized).toBe('/mnt/d/exports/tax-template.xlsx')
    }
  })

  it('remembers tax template output directory in current user preferences', () => {
    const db = new FakeTaxTemplateDb()
    const documentsPath = 'D:/Users/Test/Documents'

    expect(getPreferredTaxTemplateOutputDir(db as never, 7, documentsPath)).toBe(
      getDefaultTaxTemplateOutputDir(documentsPath)
    )

    rememberTaxTemplateOutputDir(db as never, 7, 'D:/exports/税务模板')

    expect(getPreferredTaxTemplateOutputDir(db as never, 7, documentsPath)).toBe(
      'D:/exports/税务模板'
    )

    rememberTaxTemplateOutputDirectory(db as never, 7, 'D:/exports.2026')
    expect(getPreferredTaxTemplateOutputDir(db as never, 7, documentsPath)).toBe(
      'D:/exports.2026'
    )

    rememberTaxTemplateOutputFile(db as never, 7, 'D:/exports.2026/tax-template.xlsx')
    expect(getPreferredTaxTemplateOutputDir(db as never, 7, documentsPath)).toBe(
      'D:/exports.2026'
    )
  })

  it('exports the fixed npo workbook without writing report snapshots', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-npo-tax-template-'))
    const db = new FakeTaxTemplateDb()
    seedNpoLedger(db)
    const outputPath = path.join(tempDir, 'tax-template.xlsx')

    const result = await exportNpoTaxTemplate(db as never, {
      ledgerId: 1,
      declarationType: 'quarterly',
      year: 2026,
      quarter: 1,
      outputPath,
      templatePath
    })

    expect(result).toMatchObject({
      filePath: outputPath,
      ledgerId: 1,
      declarationType: 'quarterly',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      templateVersion: 'npo-tax-template-v1'
    })
    expect(db.reportSnapshotInserts).toHaveLength(0)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(outputPath)
    const templateWorkbook = new ExcelJS.Workbook()
    await templateWorkbook.xlsx.readFile(templatePath)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '资产负债表',
      '业务活动表',
      '现金流量表'
    ])

    const balanceSheet = workbook.getWorksheet('资产负债表')
    const activitySheet = workbook.getWorksheet('业务活动表')
    const cashflowSheet = workbook.getWorksheet('现金流量表')
    expectWorksheetStructurePreserved(
      templateWorkbook.getWorksheet('资产负债表')!,
      balanceSheet!,
      ['C3', 'G3', 'C4', 'G4', 'D15', 'E15', 'H15', 'I15']
    )
    expectWorksheetStructurePreserved(
      templateWorkbook.getWorksheet('业务活动表')!,
      activitySheet!,
      ['C3', 'G3', 'C4', 'G4', 'D10', 'E10', 'G10', 'H10']
    )
    expectWorksheetStructurePreserved(
      templateWorkbook.getWorksheet('现金流量表')!,
      cashflowSheet!,
      ['C3', 'C4', 'C5', 'E5', 'E10', 'E22']
    )
    expect(balanceSheet?.getCell('C3').value).toBe('91310000TESTNPO001')
    expect(balanceSheet?.getCell('G3').value).toBe('民非测试单位')
    expect(balanceSheet?.getCell('C4').value).toBe('2026-01-01')
    expect(balanceSheet?.getCell('G4').value).toBe('2026-03-31')
    expect(balanceSheet?.getCell('D15').value).toMatchObject({ formula: expect.stringContaining('ROUND') })
    expect(balanceSheet?.getCell('H32').value).toBe(500)
    expect(balanceSheet?.getCell('I32').value).toBe(750)

    expect(activitySheet?.getCell('D10').value).toBe(300)
    expect(activitySheet?.getCell('G10').value).toBe(300)
    expect(activitySheet?.getCell('D22').value).toBe(50)
    expect(activitySheet?.getCell('G22').value).toBe(50)
    expect(activitySheet?.getCell('F10').value).toMatchObject({ formula: expect.stringContaining('D10') })
    expect(cashflowSheet?.getCell('E10').value).toBe(300)
    expect(cashflowSheet?.getCell('C3').value).toMatchObject({
      formula: expect.stringContaining('资产负债表!C3'),
      result: '91310000TESTNPO001'
    })
  })

  it('blocks non-npo ledgers and missing taxpayer identification numbers', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-npo-tax-template-'))
    const db = new FakeTaxTemplateDb()
    seedNpoLedger(db)
    seedEnterpriseLedger(db)
    db.ledgers[0].taxpayer_identification_number = ''

    await expect(
      exportNpoTaxTemplate(db as never, {
        ledgerId: 1,
        declarationType: 'monthly',
        year: 2026,
        month: 3,
        outputPath: path.join(tempDir, 'missing-tax.xlsx'),
        templatePath
      })
    ).rejects.toThrow('纳税人识别号不能为空')

    await expect(
      exportNpoTaxTemplate(db as never, {
        ledgerId: 2,
        declarationType: 'monthly',
        year: 2026,
        month: 3,
        outputPath: path.join(tempDir, 'enterprise.xlsx'),
        templatePath
      })
    ).rejects.toThrow('税务模板仅支持民间非营利组织账套')
  })
})

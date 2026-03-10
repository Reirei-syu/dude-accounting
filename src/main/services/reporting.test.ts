import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildReportSnapshotHtml,
  deleteReportSnapshot,
  generateReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots,
  writeReportSnapshotExcel,
  writeReportSnapshotPdf,
  type ReportSnapshotDetail,
  type ReportSnapshotTotal
} from './reporting'

type LedgerRecord = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
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

type ReportSnapshotRecord = {
  id: number
  ledger_id: number
  report_type: string
  report_name: string
  period: string
  start_period: string
  end_period: string
  as_of_date: string | null
  include_unposted_vouchers: number
  generated_by: number | null
  generated_at: string
  content_json: string
}

class FakeReportingDb {
  private nextSnapshotId = 1
  readonly ledgers: LedgerRecord[] = []
  readonly subjects: SubjectRecord[] = []
  readonly initialBalances: InitialBalanceRecord[] = []
  readonly vouchers: VoucherRecord[] = []
  readonly voucherEntries: VoucherEntryRecord[] = []
  readonly cashFlowItems: CashFlowItemRecord[] = []
  readonly snapshots: ReportSnapshotRecord[] = []

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT id, name, standard_type, start_period FROM ledgers WHERE id = ?') {
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
      'SELECT id FROM report_snapshots WHERE ledger_id = ? AND report_type = ? AND period = ? LIMIT 1'
    ) {
      return {
        get: (ledgerId, reportType, period) =>
          this.snapshots.find(
            (snapshot) =>
              snapshot.ledger_id === Number(ledgerId) &&
              snapshot.report_type === String(reportType) &&
              snapshot.period === String(period)
          ),
        all: () => [],
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
        run: (
          ledgerId,
          reportType,
          reportName,
          period,
          startPeriod,
          endPeriod,
          asOfDate,
          includeUnposted,
          generatedBy,
          generatedAt,
          contentJson
        ) => {
          const id = this.nextSnapshotId++
          this.snapshots.push({
            id,
            ledger_id: Number(ledgerId),
            report_type: String(reportType),
            report_name: String(reportName),
            period: String(period),
            start_period: String(startPeriod),
            end_period: String(endPeriod),
            as_of_date: asOfDate === null ? null : String(asOfDate),
            include_unposted_vouchers: Number(includeUnposted),
            generated_by: generatedBy === null || generatedBy === undefined ? null : Number(generatedBy),
            generated_at: String(generatedAt),
            content_json: String(contentJson)
          })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (
      normalized.startsWith(
        'SELECT rs.id, rs.ledger_id, rs.report_type, rs.report_name, rs.period, rs.start_period, rs.end_period, rs.as_of_date, rs.include_unposted_vouchers, rs.generated_by, rs.generated_at, l.name AS ledger_name, l.standard_type FROM report_snapshots rs INNER JOIN ledgers l ON l.id = rs.ledger_id WHERE '
      )
    ) {
      return {
        get: () => undefined,
        all: (...params) => {
          let cursor = 0
          const ledgerId = Number(params[cursor++])

          const reportTypeMatch = normalized.match(/rs\.report_type IN \(([^)]+)\)/)
          const reportTypeCount = reportTypeMatch ? reportTypeMatch[1].split(',').length : 0
          const reportTypes =
            reportTypeCount > 0
              ? params.slice(cursor, cursor + reportTypeCount).map((value) => String(value))
              : []
          cursor += reportTypeCount

          const periodMatch = normalized.match(/rs\.period IN \(([^)]+)\)/)
          const periodCount = periodMatch ? periodMatch[1].split(',').length : 0
          const periods =
            periodCount > 0
              ? params.slice(cursor, cursor + periodCount).map((value) => String(value))
              : []

          return this.snapshots
            .filter((snapshot) => snapshot.ledger_id === ledgerId)
            .filter((snapshot) => reportTypes.length === 0 || reportTypes.includes(snapshot.report_type))
            .filter((snapshot) => periods.length === 0 || periods.includes(snapshot.period))
            .map((snapshot) => {
              const ledger = this.ledgers.find((item) => item.id === snapshot.ledger_id)
              return {
                ...snapshot,
                ledger_name: ledger?.name ?? '',
                standard_type: ledger?.standard_type ?? 'enterprise'
              }
            })
            .sort((left, right) => {
              if (left.generated_at !== right.generated_at) {
                return right.generated_at.localeCompare(left.generated_at)
              }
              return right.id - left.id
            })
        },
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT rs.id, rs.ledger_id, rs.report_type, rs.report_name, rs.period, rs.start_period, rs.end_period, rs.as_of_date, rs.include_unposted_vouchers, rs.generated_by, rs.generated_at, rs.content_json, l.name AS ledger_name, l.standard_type FROM report_snapshots rs INNER JOIN ledgers l ON l.id = rs.ledger_id WHERE rs.id = ?'
    ) {
      return {
        get: (snapshotId) => {
          const snapshot = this.snapshots.find((item) => item.id === Number(snapshotId))
          if (!snapshot) return undefined
          const ledger = this.ledgers.find((item) => item.id === snapshot.ledger_id)
          return {
            ...snapshot,
            ledger_name: ledger?.name ?? '',
            standard_type: ledger?.standard_type ?? 'enterprise'
          }
        },
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'DELETE FROM report_snapshots WHERE id = ? AND ledger_id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (snapshotId, ledgerId) => {
          const before = this.snapshots.length
          const next = this.snapshots.filter(
            (snapshot) =>
              !(snapshot.id === Number(snapshotId) && snapshot.ledger_id === Number(ledgerId))
          )
          this.snapshots.splice(0, this.snapshots.length, ...next)
          return {
            lastInsertRowid: 0,
            changes: before - this.snapshots.length
          }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeReportingDb: ${normalized}`)
  }
}

function createTestDb(): FakeReportingDb {
  return new FakeReportingDb()
}

function seedEnterpriseLedger(db: FakeReportingDb): void {
  db.ledgers.push({
    id: 1,
    name: '企业测试账套',
    standard_type: 'enterprise',
    start_period: '2025-12',
    current_period: '2026-03'
  })

  db.subjects.push(
    { ledger_id: 1, code: '1002', name: '银行存款', category: 'asset', balance_direction: 1 },
    { ledger_id: 1, code: '2201', name: '应付票据', category: 'liability', balance_direction: -1 },
    { ledger_id: 1, code: '2202', name: '应付账款', category: 'liability', balance_direction: -1 },
    { ledger_id: 1, code: '4001', name: '实收资本', category: 'equity', balance_direction: -1 },
    { ledger_id: 1, code: '6001', name: '主营业务收入', category: 'profit_loss', balance_direction: -1 },
    { ledger_id: 1, code: '6051', name: '其他业务收入', category: 'profit_loss', balance_direction: -1 },
    { ledger_id: 1, code: '6602', name: '管理费用', category: 'profit_loss', balance_direction: 1 }
  )

  db.initialBalances.push(
    { ledger_id: 1, period: '2025-12', subject_code: '1002', debit_amount: 100_000, credit_amount: 0 },
    { ledger_id: 1, period: '2025-12', subject_code: '2202', debit_amount: 0, credit_amount: 20_000 },
    { ledger_id: 1, period: '2025-12', subject_code: '4001', debit_amount: 0, credit_amount: 80_000 }
  )

  db.cashFlowItems.push(
    {
      id: 1,
      ledger_id: 1,
      code: 'CF01',
      name: '销售商品、提供劳务收到的现金',
      category: 'operating',
      direction: 'inflow'
    },
    {
      id: 2,
      ledger_id: 1,
      code: 'CF07',
      name: '支付其他与经营活动有关的现金',
      category: 'operating',
      direction: 'outflow'
    },
    {
      id: 3,
      ledger_id: 1,
      code: 'CF12',
      name: '购建固定资产等长期资产支付的现金',
      category: 'investing',
      direction: 'outflow'
    }
  )

  db.vouchers.push(
    { id: 101, ledger_id: 1, period: '2025-12', voucher_date: '2025-12-01', status: 2, is_carry_forward: 0 },
    { id: 102, ledger_id: 1, period: '2025-12', voucher_date: '2025-12-31', status: 2, is_carry_forward: 0 },
    { id: 103, ledger_id: 1, period: '2026-01', voucher_date: '2026-01-31', status: 2, is_carry_forward: 0 },
    { id: 104, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-05', status: 2, is_carry_forward: 0 },
    { id: 105, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-12', status: 2, is_carry_forward: 0 },
    { id: 106, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-18', status: 2, is_carry_forward: 0 },
    { id: 107, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-21', status: 1, is_carry_forward: 0 },
    { id: 108, ledger_id: 1, period: '2026-03', voucher_date: '2026-03-22', status: 0, is_carry_forward: 0 },
    { id: 109, ledger_id: 1, period: '2026-04', voucher_date: '2026-04-01', status: 2, is_carry_forward: 0 }
  )

  db.voucherEntries.push(
    { id: 1, voucher_id: 101, row_order: 1, subject_code: '1002', debit_amount: 1_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 2, voucher_id: 101, row_order: 2, subject_code: '6001', debit_amount: 0, credit_amount: 1_000, cash_flow_item_id: null },
    { id: 3, voucher_id: 102, row_order: 1, subject_code: '1002', debit_amount: 500, credit_amount: 0, cash_flow_item_id: null },
    { id: 4, voucher_id: 102, row_order: 2, subject_code: '2202', debit_amount: 0, credit_amount: 500, cash_flow_item_id: null },
    { id: 5, voucher_id: 103, row_order: 1, subject_code: '6602', debit_amount: 200, credit_amount: 0, cash_flow_item_id: null },
    { id: 6, voucher_id: 103, row_order: 2, subject_code: '1002', debit_amount: 0, credit_amount: 200, cash_flow_item_id: 2 },
    { id: 7, voucher_id: 104, row_order: 1, subject_code: '1002', debit_amount: 50_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 8, voucher_id: 104, row_order: 2, subject_code: '6001', debit_amount: 0, credit_amount: 50_000, cash_flow_item_id: null },
    { id: 9, voucher_id: 105, row_order: 1, subject_code: '6602', debit_amount: 10_000, credit_amount: 0, cash_flow_item_id: null },
    { id: 10, voucher_id: 105, row_order: 2, subject_code: '1002', debit_amount: 0, credit_amount: 10_000, cash_flow_item_id: 2 },
    { id: 11, voucher_id: 106, row_order: 1, subject_code: '1002', debit_amount: 3_000, credit_amount: 0, cash_flow_item_id: null },
    { id: 12, voucher_id: 106, row_order: 2, subject_code: '2202', debit_amount: 0, credit_amount: 3_000, cash_flow_item_id: null },
    { id: 13, voucher_id: 107, row_order: 1, subject_code: '1002', debit_amount: 7_000, credit_amount: 0, cash_flow_item_id: 1 },
    { id: 14, voucher_id: 107, row_order: 2, subject_code: '6001', debit_amount: 0, credit_amount: 7_000, cash_flow_item_id: null },
    { id: 15, voucher_id: 108, row_order: 1, subject_code: '6602', debit_amount: 2_000, credit_amount: 0, cash_flow_item_id: null },
    { id: 16, voucher_id: 108, row_order: 2, subject_code: '1002', debit_amount: 0, credit_amount: 2_000, cash_flow_item_id: 2 },
    { id: 17, voucher_id: 109, row_order: 1, subject_code: '1002', debit_amount: 9_000, credit_amount: 0, cash_flow_item_id: 3 },
    { id: 18, voucher_id: 109, row_order: 2, subject_code: '6001', debit_amount: 0, credit_amount: 9_000, cash_flow_item_id: null }
  )
}

function seedNpoLedger(db: FakeReportingDb): void {
  db.ledgers.push({
    id: 2,
    name: '民非测试账套',
    standard_type: 'npo',
    start_period: '2026-01',
    current_period: '2026-03'
  })

  db.subjects.push(
    { ledger_id: 2, code: '1002', name: '银行存款', category: 'asset', balance_direction: 1 },
    { ledger_id: 2, code: '3101', name: '非限定性净资产', category: 'equity', balance_direction: -1 },
    { ledger_id: 2, code: '3102', name: '限定性净资产', category: 'equity', balance_direction: -1 },
    { ledger_id: 2, code: '430101', name: '提供服务收入-非限定性', category: 'profit_loss', balance_direction: -1 },
    { ledger_id: 2, code: '430102', name: '提供服务收入-限定性', category: 'profit_loss', balance_direction: -1 },
    { ledger_id: 2, code: '5301', name: '管理费用', category: 'profit_loss', balance_direction: 1 }
  )

  db.initialBalances.push(
    { ledger_id: 2, period: '2026-01', subject_code: '1002', debit_amount: 50_000, credit_amount: 0 },
    { ledger_id: 2, period: '2026-01', subject_code: '3101', debit_amount: 0, credit_amount: 50_000 }
  )

  db.cashFlowItems.push(
    {
      id: 11,
      ledger_id: 2,
      code: 'NCF03',
      name: '提供服务收到的现金',
      category: 'operating',
      direction: 'inflow'
    },
    {
      id: 12,
      ledger_id: 2,
      code: 'NCF12',
      name: '支付的其他与业务活动有关的现金',
      category: 'operating',
      direction: 'outflow'
    }
  )

  db.vouchers.push(
    { id: 201, ledger_id: 2, period: '2026-03', voucher_date: '2026-03-08', status: 2, is_carry_forward: 0 },
    { id: 202, ledger_id: 2, period: '2026-03', voucher_date: '2026-03-20', status: 2, is_carry_forward: 0 }
  )

  db.voucherEntries.push(
    { id: 19, voucher_id: 201, row_order: 1, subject_code: '1002', debit_amount: 20_000, credit_amount: 0, cash_flow_item_id: 11 },
    { id: 20, voucher_id: 201, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 20_000, cash_flow_item_id: null },
    { id: 21, voucher_id: 202, row_order: 1, subject_code: '5301', debit_amount: 5_000, credit_amount: 0, cash_flow_item_id: null },
    { id: 22, voucher_id: 202, row_order: 2, subject_code: '1002', debit_amount: 0, credit_amount: 5_000, cash_flow_item_id: 12 }
  )
}

function readTotal(totals: ReportSnapshotTotal[], key: string): number {
  return totals.find((item) => item.key === key)?.amountCents ?? 0
}

function findTableRow(
  detail: ReportSnapshotDetail,
  label: string
): { cells: Array<{ value: string | number | null }> } | undefined {
  return (
    detail.content.tables
      ?.flatMap((table) => table.rows)
      .find((row) => row.cells.some((cell) => cell.value === label))
  )
}

describe('reporting service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('generates enterprise balance sheet with the official parallel table structure', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    const balanceSheet = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T10:00:00.000Z'
    })

    const balanceTable = balanceSheet.content.tables?.[0]
    expect(balanceSheet.period).toBe('2026.03')
    expect(balanceSheet.as_of_date).toBe('2026-03-31')
    expect(balanceSheet.content.formCode).toBe('会企01表')
    expect(balanceTable?.columns.map((column) => column.label)).toEqual([
      '资产',
      '期末余额',
      '上年年末余额',
      '负债和所有者权益（或股东权益）',
      '期末余额',
      '上年年末余额'
    ])
    expect(findTableRow(balanceSheet, '货币资金')?.cells[1]?.value).toBe(144_300)
    expect(findTableRow(balanceSheet, '货币资金')?.cells[2]?.value).toBe(101_500)
    expect(findTableRow(balanceSheet, '应付票据')?.cells[4]?.value).toBe(0)
    expect(findTableRow(balanceSheet, '未分配利润')?.cells[4]?.value).toBe(40_800)
    expect(readTotal(balanceSheet.content.totals, 'assets')).toBe(144_300)
  })

  it('includes general risk reserve in enterprise balance sheet equity totals', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    db.subjects.push({
      ledger_id: 1,
      code: '4102',
      name: '一般风险准备',
      category: 'equity',
      balance_direction: -1
    })
    db.initialBalances.push(
      { ledger_id: 1, period: '2025-12', subject_code: '1002', debit_amount: 105_000, credit_amount: 0 },
      { ledger_id: 1, period: '2025-12', subject_code: '4102', debit_amount: 0, credit_amount: 5_000 }
    )

    const balanceSheet = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-10T10:00:00.000Z'
    })

    expect(readTotal(balanceSheet.content.totals, 'assets')).toBe(149_300)
    expect(readTotal(balanceSheet.content.totals, 'liabilities')).toBe(23_500)
    expect(readTotal(balanceSheet.content.totals, 'equity')).toBe(125_800)
    expect(
      readTotal(balanceSheet.content.totals, 'liabilities') +
        readTotal(balanceSheet.content.totals, 'equity')
    ).toBe(149_300)
  })

  it('includes unposted vouchers in dynamic enterprise reports only when the option is checked', () => {
    const postedDb = createTestDb()
    const postedTestDb = postedDb as never
    seedEnterpriseLedger(postedDb)

    const postedOnly = generateReportSnapshot(postedTestDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T10:01:00.000Z'
    })

    const unpostedDb = createTestDb()
    const unpostedTestDb = unpostedDb as never
    seedEnterpriseLedger(unpostedDb)

    const includeUnposted = generateReportSnapshot(unpostedTestDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: true,
      generatedBy: 9,
      now: '2026-03-09T10:02:00.000Z'
    })

    const postedTable = postedOnly.content.tables?.[0]
    const unpostedTable = includeUnposted.content.tables?.[0]

    expect(postedOnly.period).toBe('2026.03-2026.03')
    expect(postedOnly.content.formCode).toBe('会企02表')
    expect(postedOnly.content.scope.startDate).toBe('2026-03-01')
    expect(postedOnly.content.scope.endDate).toBe('2026-03-31')
    expect(readTotal(postedOnly.content.totals, 'net_profit')).toBe(40_000)
    expect(
      postedTable?.rows.some(
        (row) => row.cells[0]?.value === '一、营业收入' && row.cells[1]?.value === 50_000
      )
    ).toBe(true)
    expect(
      postedTable?.rows.some(
        (row) => row.cells[0]?.value === '管理费用' && row.cells[1]?.value === 10_000
      )
    ).toBe(true)

    expect(includeUnposted.include_unposted_vouchers).toBe(1)
    expect(readTotal(includeUnposted.content.totals, 'net_profit')).toBe(45_000)
    expect(
      unpostedTable?.rows.some(
        (row) => row.cells[0]?.value === '一、营业收入' && row.cells[1]?.value === 57_000
      )
    ).toBe(true)
  })

  it('supports cross-year dynamic ranges with inclusive first-day and month-end boundaries', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    const incomeStatement = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2025-12',
      endPeriod: '2026-01',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T10:03:00.000Z'
    })

    const incomeTable = incomeStatement.content.tables?.[0]

    expect(incomeStatement.period).toBe('2025.12-2026.01')
    expect(incomeStatement.content.scope.startDate).toBe('2025-12-01')
    expect(incomeStatement.content.scope.endDate).toBe('2026-01-31')
    expect(readTotal(incomeStatement.content.totals, 'operating_revenue')).toBe(1_000)
    expect(readTotal(incomeStatement.content.totals, 'operating_cost')).toBe(0)
    expect(readTotal(incomeStatement.content.totals, 'net_profit')).toBe(800)
    expect(
      incomeTable?.rows.some(
        (row) => row.cells[0]?.value === '二、营业利润（亏损以“-”号填列）' && row.cells[1]?.value === 800
      )
    ).toBe(true)
  })

  it('adds enterprise equity statements with dual year blocks and official columns', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'equity_statement',
      startPeriod: '2026-01',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T10:05:00.000Z'
    })

    const equityTable = snapshot.content.tables?.[0]
    expect(snapshot.content.title).toBe('所有者权益变动表')
    expect(snapshot.content.formCode).toBe('会企04表')
    expect(equityTable?.columns.map((column) => column.label)).toEqual([
      '项目',
      '实收资本（或股本）',
      '其他权益工具',
      '优先股',
      '永续债',
      '其他',
      '资本公积',
      '减：库存股',
      '其他综合收益',
      '专项储备',
      '盈余公积',
      '一般风险准备',
      '未分配利润',
      '所有者权益合计'
    ])
    expect(equityTable?.rows.some((row) => row.cells[0]?.value === '本年金额')).toBe(true)
    expect(equityTable?.rows.some((row) => row.cells[0]?.value === '上年金额')).toBe(true)
    expect(
      equityTable?.rows.some(
        (row) => row.cells[0]?.value === '（一）综合收益总额' && row.cells[12]?.value === 39_800
      )
    ).toBe(true)
    expect(readTotal(snapshot.content.totals, 'current_total_equity')).toBe(120_800)
  })

  it('generates npo activity statements and supports deleting saved report snapshots', () => {
    const db = createTestDb()
    const testDb = db as never
    seedNpoLedger(db)

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'activity_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:00:00.000Z'
    })

    expect(snapshot.content.title).toBe('业务活动表')
    expect(readTotal(snapshot.content.totals, 'income_total')).toBe(20_000)
    expect(readTotal(snapshot.content.totals, 'expense_total')).toBe(5_000)
    expect(readTotal(snapshot.content.totals, 'net_assets_change')).toBe(15_000)
    const activityTable = (snapshot.content as { tables?: Array<{ columns: Array<{ label: string }>; rows: Array<{ cells: Array<{ value: string | number | null }> }> }> }).tables?.[0]
    expect(activityTable?.columns.map((column) => column.label)).toEqual([
      '项目',
      '本月数\n（非限定性）',
      '本月数\n（限定性）',
      '本月数\n（合计）',
      '本年累计数\n（非限定性）',
      '本年累计数\n（限定性）',
      '本年累计数\n（合计）'
    ])
    expect(
      activityTable?.rows.some(
        (row) => row.cells[0]?.value === '提供服务收入' && row.cells[1]?.value === 20_000
      )
    ).toBe(true)
    expect(
      activityTable?.rows.some(
        (row) =>
          row.cells[0]?.value === '六、净资产变动额（减少以“-”号填列）' &&
          row.cells[3]?.value === 15_000 &&
          row.cells[6]?.value === 15_000
      )
    ).toBe(true)

    expect(
      listReportSnapshots(testDb, {
        ledgerId: 2,
        reportTypes: ['activity_statement'],
        periods: ['2026.03-2026.03']
      })
    ).toHaveLength(1)

    expect(deleteReportSnapshot(testDb, snapshot.id, 2)).toBe(true)
    expect(listReportSnapshots(testDb, { ledgerId: 2 })).toHaveLength(0)
    expect(() => getReportSnapshotDetail(testDb, snapshot.id, 2)).toThrow('报表快照不存在')
  })

  it('uses the official NGO cash flow statement table structure', () => {
    const db = createTestDb()
    const testDb = db as never
    seedNpoLedger(db)

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'cashflow_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:03:00.000Z'
    })

    const cashflowTable = (snapshot.content as { tables?: Array<{ columns: Array<{ label: string }>; rows: Array<{ cells: Array<{ value: string | number | null }> }> }> }).tables?.[0]
    expect(cashflowTable?.columns.map((column) => column.label)).toEqual(['项目', '本年金额', '上年金额'])
    expect(
      cashflowTable?.rows.some(
        (row) => row.cells[0]?.value === '提供服务收到的现金' && row.cells[1]?.value === 20_000
      )
    ).toBe(true)
    expect(
      cashflowTable?.rows.some(
        (row) => row.cells[0]?.value === '支付的其他与业务活动有关的现金' && row.cells[1]?.value === 5_000
      )
    ).toBe(true)
    expect(
      cashflowTable?.rows.some(
        (row) => row.cells[0]?.value === '业务活动产生的现金流量净额' && row.cells[1]?.value === 15_000
      )
    ).toBe(true)
  })

  it('uses the NGO system balance sheet template rows and year-start/year-end columns', () => {
    const db = createTestDb()
    const testDb = db as never
    seedNpoLedger(db)

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:05:00.000Z'
    })

    const allRows = snapshot.content.sections.flatMap((section) => section.rows)
    const cashRow = allRows.find((row) => row.label === '货币资金')
    const currentAssetTotalRow = allRows.find((row) => row.label === '流动资产合计')
    const nonCurrentAssetTotalRow = allRows.find((row) => row.label === '非流动资产合计')
    const assetTotalRow = allRows.find((row) => row.label === '资产总计')
    const liabilityTotalRow = allRows.find((row) => row.label === '负债合计')
    const unrestrictedNetAssetRow = allRows.find((row) => row.label === '非限定性净资产')
    const entrustedAssetRow = allRows.find((row) => row.label === '受托代理资产')
    const totalRow = allRows.find((row) => row.label === '负债和净资产总计')

    expect(cashRow?.lineNo).toBe('1')
    expect(cashRow?.cells?.opening).toBe(50_000)
    expect(cashRow?.cells?.closing).toBe(65_000)
    expect(currentAssetTotalRow?.cells?.opening).toBe(50_000)
    expect(currentAssetTotalRow?.cells?.closing).toBe(65_000)
    expect(nonCurrentAssetTotalRow?.cells?.opening).toBe(0)
    expect(nonCurrentAssetTotalRow?.cells?.closing).toBe(0)
    expect(assetTotalRow?.cells?.opening).toBe(50_000)
    expect(assetTotalRow?.cells?.closing).toBe(65_000)
    expect(liabilityTotalRow?.cells?.opening).toBe(0)
    expect(liabilityTotalRow?.cells?.closing).toBe(0)
    expect(unrestrictedNetAssetRow?.cells?.opening).toBe(50_000)
    expect(unrestrictedNetAssetRow?.cells?.closing).toBe(65_000)
    expect(entrustedAssetRow?.lineNo).toBe('26')
    expect(totalRow?.lineNo).toBe('80')
    expect(totalRow?.cells?.opening).toBe(50_000)
    expect(totalRow?.cells?.closing).toBe(65_000)
    expect(snapshot.content.tableColumns?.map((column) => column.label)).toEqual(['年初数', '期末数'])
  })

  it('aggregates descendant npo subjects into balance sheet and cash flow statement rows', () => {
    const db = createTestDb()
    const testDb = db as never
    seedNpoLedger(db)

    db.subjects.push(
      { ledger_id: 2, code: '100201', name: '银行存款-工行', category: 'asset', balance_direction: 1 },
      { ledger_id: 2, code: '530101', name: '管理费用-办公费', category: 'profit_loss', balance_direction: 1 }
    )
    db.cashFlowItems.push(
      {
        id: 13,
        ledger_id: 2,
        code: 'CF03',
        name: '收到其他与经营活动有关的现金',
        category: 'operating',
        direction: 'inflow'
      },
      {
        id: 14,
        ledger_id: 2,
        code: 'CF07',
        name: '支付其他与经营活动有关的现金',
        category: 'operating',
        direction: 'outflow'
      }
    )
    db.vouchers.push(
      { id: 203, ledger_id: 2, period: '2026-03', voucher_date: '2026-03-25', status: 2, is_carry_forward: 0 },
      { id: 204, ledger_id: 2, period: '2026-03', voucher_date: '2026-03-26', status: 2, is_carry_forward: 0 }
    )
    db.voucherEntries.push(
      { id: 23, voucher_id: 203, row_order: 1, subject_code: '100201', debit_amount: 15_000, credit_amount: 0, cash_flow_item_id: 13 },
      { id: 24, voucher_id: 203, row_order: 2, subject_code: '430101', debit_amount: 0, credit_amount: 15_000, cash_flow_item_id: null },
      { id: 25, voucher_id: 204, row_order: 1, subject_code: '530101', debit_amount: 3_000, credit_amount: 0, cash_flow_item_id: null },
      { id: 26, voucher_id: 204, row_order: 2, subject_code: '100201', debit_amount: 0, credit_amount: 3_000, cash_flow_item_id: 14 }
    )

    const balanceSheet = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:06:00.000Z'
    })
    const cashRow = balanceSheet.content.sections
      .flatMap((section) => section.rows)
      .find((row) => row.label === '货币资金')
    expect(cashRow?.cells?.closing).toBe(77_000)

    const activityStatement = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'activity_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:07:00.000Z'
    })
    const activityTable = (activityStatement.content as { tables?: Array<{ rows: Array<{ cells: Array<{ value: string | number | null }> }> }> }).tables?.[0]
    expect(
      activityTable?.rows.some(
        (row) => row.cells[0]?.value === '管理费用' && row.cells[1]?.value === 8_000
      )
    ).toBe(true)

    const cashflowStatement = generateReportSnapshot(testDb, {
      ledgerId: 2,
      reportType: 'cashflow_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 8,
      now: '2026-03-09T11:08:00.000Z'
    })
    const cashflowTable = (cashflowStatement.content as { tables?: Array<{ rows: Array<{ cells: Array<{ value: string | number | null }> }> }> }).tables?.[0]
    expect(
      cashflowTable?.rows.some(
        (row) => row.cells[0]?.value === '提供服务收到的现金' && row.cells[1]?.value === 35_000
      )
    ).toBe(true)
    expect(
      cashflowTable?.rows.some(
        (row) => row.cells[0]?.value === '支付的其他与业务活动有关的现金' && row.cells[1]?.value === 8_000
      )
    ).toBe(true)
  })

  it('blocks duplicate report generation and builds export html with official-style headers', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T12:00:00.000Z'
    })

    expect(() =>
      generateReportSnapshot(testDb, {
        ledgerId: 1,
        reportType: 'balance_sheet',
        month: '2026-03',
        includeUnpostedVouchers: true,
        generatedBy: 9,
        now: '2026-03-09T12:01:00.000Z'
      })
    ).toThrow('已存在同会计期间同类型的报表，请先删除原报表后再生成')

    const html = buildReportSnapshotHtml(snapshot)
    expect(html).toContain('<h1>资产负债表</h1>')
    expect(html).toContain('编制单位：企业测试账套')
    expect(html).toContain('会计期间：2026年3月31日')
    expect(html).toContain('单位：元')
    expect(html).toContain('<table>')
    expect(html).not.toContain('<h2>汇总</h2>')
    expect(html).not.toContain('取数范围：')
    expect(html).not.toContain('统计口径：')
    expect(html).not.toContain('导出时间：')
    expect(html).not.toContain('会民非01表')
  })

  it('formats dynamic export period labels in chinese month style', () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)

    const sameMonthSnapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T12:02:00.000Z'
    })
    expect(buildReportSnapshotHtml(sameMonthSnapshot)).toContain('会计期间：2026年3月')

    const sameYearSnapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2026-01',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T12:03:00.000Z'
    })
    expect(buildReportSnapshotHtml(sameYearSnapshot)).toContain('会计期间：2026年1-3月')

    const crossYearSnapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'income_statement',
      startPeriod: '2025-12',
      endPeriod: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T12:04:00.000Z'
    })
    expect(buildReportSnapshotHtml(crossYearSnapshot)).toContain('会计期间：2025年12月-2026年3月')
  })

  it('writes excel and pdf exports for save-as flow', async () => {
    const db = createTestDb()
    const testDb = db as never
    seedEnterpriseLedger(db)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-report-export-'))

    const snapshot = generateReportSnapshot(testDb, {
      ledgerId: 1,
      reportType: 'balance_sheet',
      month: '2026-03',
      includeUnpostedVouchers: false,
      generatedBy: 9,
      now: '2026-03-09T12:10:00.000Z'
    })

    const excelPath = path.join(tempDir, '资产负债表.xlsx')
    const pdfPath = path.join(tempDir, '资产负债表.pdf')

    await writeReportSnapshotExcel(excelPath, snapshot)
    await writeReportSnapshotPdf(pdfPath, snapshot)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(excelPath)
    const worksheet = workbook.worksheets[0]

    expect(fs.existsSync(excelPath)).toBe(true)
    expect(fs.statSync(excelPath).size).toBeGreaterThan(0)
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(0)
    expect(worksheet.getCell(1, 1).value).toBe('资产负债表')
    expect(worksheet.getCell(2, 1).value).toBe('编制单位：企业测试账套')
    expect(worksheet.getCell(2, 6).value).toBe('单位：元')
    expect(worksheet.getCell(3, 1).value).toBe('会计期间：2026年3月31日')
    expect(worksheet.getCell(4, 1).alignment?.horizontal).toBe('center')
    expect(worksheet.getCell(4, 1).alignment?.vertical).toBe('middle')
    expect(worksheet.getCell(4, 2).alignment?.horizontal).toBe('center')
  })
})

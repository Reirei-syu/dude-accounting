import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import { createPrintDocument } from './printJobs'
import { buildTableLayoutResult, estimateTableRowGroups } from './printLayout'
import type { PrintTableSegment } from './print'
import { afterEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import {
  seedSubjectsForLedger,
  seedCashFlowItemsForLedger,
  seedCashFlowMappingsForLedger
} from '../database/seed'
import {
  buildReportSnapshotContentForExport,
  generateReportSnapshot,
  getReportSnapshotDetail,
  buildReportSnapshotHtml,
  writeReportSnapshotExcel,
  type AccountingStandardType,
  type GenerateReportSnapshotParams,
  type ReportType
} from './reporting'

const cases: Array<[AccountingStandardType, ReportType]> = [
  ['enterprise', 'balance_sheet'],
  ['enterprise', 'income_statement'],
  ['enterprise', 'cashflow_statement'],
  ['enterprise', 'equity_statement'],
  ['npo', 'balance_sheet'],
  ['npo', 'activity_statement'],
  ['npo', 'cashflow_statement']
]
const opened: Database.Database[] = []
const folders: string[] = []
const now = '2026-09-08T12:00:00.000Z'

function createFixture(standard: AccountingStandardType, populated: boolean): Database.Database {
  const db = new Database(':memory:')
  opened.push(db)
  runDatabaseMigrations(db)
  db.prepare(
    'INSERT INTO ledgers(id,name,standard_type,start_period,current_period) VALUES(1,?,?,?,?)'
  ).run(`报表基准-${standard}`, standard, '2024-01', '2026-02')
  // 沿用生产种子，不创建简化科目体系，也不修改生产种子。
  seedSubjectsForLedger(db, 1, standard)
  seedCashFlowItemsForLedger(db, 1)
  seedCashFlowMappingsForLedger(db, 1, standard)
  if (!populated) return db
  const subjects = db
    .prepare(
      `SELECT code,balance_direction FROM subjects s
    WHERE ledger_id=1 AND NOT EXISTS(SELECT 1 FROM subjects c WHERE c.ledger_id=s.ledger_id AND c.parent_code=s.code)
    ORDER BY code DESC`
    )
    .all() as Array<{ code: string; balance_direction: number }>
  db.prepare(
    'INSERT INTO initial_balances(ledger_id,subject_code,period,debit_amount,credit_amount) VALUES(1,?,?,?,?)'
  ).run('1002', '2024-01', 1_234_567, 0)
  db.prepare(
    'INSERT INTO initial_balances(ledger_id,subject_code,period,debit_amount,credit_amount) VALUES(1,?,?,?,?)'
  ).run(standard === 'enterprise' ? '4001' : '3101', '2024-01', 0, 1_234_567)
  const items = db
    .prepare('SELECT id FROM cash_flow_items WHERE ledger_id=1 ORDER BY code')
    .all() as Array<{ id: number }>
  const insertVoucher = db.prepare(
    'INSERT INTO vouchers(ledger_id,period,voucher_date,voucher_number,status,is_carry_forward) VALUES(1,?,?,?,?,?)'
  )
  const insertEntry = db.prepare(
    'INSERT INTO voucher_entries(voucher_id,row_order,subject_code,debit_amount,credit_amount,cash_flow_item_id) VALUES(?,?,?,?,?,?)'
  )
  let sequence = 0
  const post = (
    date: string,
    code: string,
    amount: number,
    direction: number,
    status = 2,
    carryForward = 0
  ): void => {
    const voucherId = Number(
      insertVoucher.run(date.slice(0, 7), date, ++sequence, status, carryForward).lastInsertRowid
    )
    const debit = direction === 1 ? amount : 0
    const credit = direction === 1 ? 0 : amount
    const mapping = db
      .prepare(
        'SELECT cash_flow_item_id FROM cash_flow_mappings WHERE ledger_id=1 AND subject_code=? AND counterpart_subject_code=? AND entry_direction=? LIMIT 1'
      )
      .get('1002', code, credit > 0 ? 'inflow' : 'outflow') as
      | { cash_flow_item_id: number }
      | undefined
    insertEntry.run(voucherId, 9, code, debit, credit, null)
    insertEntry.run(
      voucherId,
      1,
      '1002',
      credit,
      debit,
      mapping?.cash_flow_item_id ?? items[sequence % items.length].id
    )
  }
  for (const [yearIndex, date] of [
    '2024-12-31',
    '2025-12-31',
    '2026-01-01',
    '2026-02-28'
  ].entries()) {
    subjects
      .filter((subject) => subject.code !== '1002')
      .forEach((subject, index) => {
        const amount = (index + 1) * (101 + yearIndex) * (index % 5 === 0 ? -1 : 1)
        post(date, subject.code, amount, subject.balance_direction)
      })
  }
  const income = standard === 'enterprise' ? '6001' : '410101'
  post('2025-11-30', income, 999_999, -1)
  post('2026-03-01', income, 888_888, -1)
  post('2026-02-28', income, 123_457, -1, 0)
  post('2026-02-28', income, 234_569, -1, 1)
  post('2026-02-28', income, 345_671, -1, 3)
  post('2025-12-31', income, 765_431, -1, 2, 1)
  if (standard === 'npo') post('2026-02-28', '3102', 10_105, 1)
  return db
}

function params(
  reportType: ReportType,
  yearEnd: boolean,
  unposted = false
): GenerateReportSnapshotParams {
  return {
    ledgerId: 1,
    reportType,
    now,
    ...(reportType === 'balance_sheet'
      ? { month: yearEnd ? '2025-12' : '2026-02' }
      : { startPeriod: '2025-12', endPeriod: yearEnd ? '2025-12' : '2026-02' }),
    includeUnpostedVouchers: unposted
  }
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

describe('reporting 重构前完整输出基线（冻结后禁止更新快照掩盖差异）', () => {
  for (const [standard, reportType] of cases) {
    for (const scenario of ['empty', 'year-end', 'cross-year', 'unposted'] as const) {
      it(`${standard}/${reportType}/${scenario} 所有字段与已保存快照一致`, () => {
        const db = createFixture(standard, scenario !== 'empty')
        const input = params(reportType, scenario === 'year-end', scenario === 'unposted')
        const direct = buildReportSnapshotContentForExport(db, input)
        const detail = generateReportSnapshot(db, input)
        expect(detail.content).toEqual(direct)
        // SQLite 快照经过 JSON 序列化：既有 -0 会转为 0，undefined 字段会被省略。
        // 完整内存结果仍由下方快照逐字段锁定，不修改生产计算来消除此差异。
        expect(JSON.parse(JSON.stringify(getReportSnapshotDetail(db, detail.id, 1)))).toEqual(
          JSON.parse(JSON.stringify(detail))
        )
        expect(detail).toMatchSnapshot()
      })
    }
    it(`${standard}/${reportType} HTML 和 Excel 输出契约`, async () => {
      const db = createFixture(standard, true)
      const detail = generateReportSnapshot(db, params(reportType, false))
      const base = path.resolve('.tmp/reporting-characterization')
      fs.mkdirSync(base, { recursive: true })
      const folder = fs.mkdtempSync(path.join(base, 'run-'))
      folders.push(folder)
      const filePath = path.join(folder, 'report.xlsx')
      await writeReportSnapshotExcel(filePath, detail)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.readFile(filePath)
      const sheets = workbook.worksheets.map((sheet) => ({
        name: sheet.name,
        pageSetup: sheet.pageSetup,
        merges: sheet.model.merges,
        rows: Array.from({ length: sheet.rowCount }, (_, index) => sheet.getRow(index + 1).values)
      }))
      // XLSX 压缩容器带生成时间；比较单元格/分页元数据，HTML 比较全部字节摘要。
      expect({
        sheets,
        htmlSha256: createHash('sha256').update(buildReportSnapshotHtml(detail)).digest('hex')
      }).toMatchSnapshot()
      const prepared = createPrintDocument(db, {
        type: 'report',
        ledgerId: 1,
        snapshotId: detail.id
      })
      const segments = prepared.document.segments as PrintTableSegment[]
      const layout = buildTableLayoutResult({
        title: prepared.title,
        orientation: prepared.orientation,
        settings: prepared.settings,
        segmentDrafts: segments.map((segment) => ({
          segment,
          rowKeyGroups: estimateTableRowGroups(segment, prepared.settings).rowKeyGroups
        })),
        oversizeRowKeys: []
      })
      expect({
        orientation: prepared.orientation,
        settings: prepared.settings,
        controlLocks: prepared.controlLocks,
        pageCount: layout.pageCount,
        diagnostics: layout.diagnostics,
        pages: layout.pages.map((page) => ({
          ...page,
          pageHtml: createHash('sha256').update(page.pageHtml).digest('hex')
        }))
      }).toMatchSnapshot('分页和逐页HTML')
    })
  }
  it.each([undefined, null, '2025-12'])(
    '民非动态导出当前期选项 %s 保持独立口径',
    (activityCurrentPeriod) => {
      const db = createFixture('npo', true)
      const content = buildReportSnapshotContentForExport(db, params('activity_statement', false), {
        activityCurrentPeriod
      })
      expect(content).toMatchSnapshot()
    }
  )
  it.each(['enterprise', 'npo'] as const)(
    '%s 多期初余额按科目取最近期间且排除未来记录',
    (standard) => {
      const db = createFixture(standard, false)
      const insert = db.prepare(
        'INSERT INTO initial_balances(ledger_id,subject_code,period,debit_amount,credit_amount) VALUES(1,?,?,?,?)'
      )
      // 故意不按期间顺序插入，验证 SQL 排序与逐科目覆盖行为。
      for (const [period, amount] of [
        ['2026-03', 999_999],
        ['2024-01', 100_001],
        ['2026-02', 300_005],
        ['2025-12', 200_003]
      ] as const) {
        insert.run('1002', period, amount, 0)
      }
      insert.run(standard === 'enterprise' ? '4001' : '3101', '2024-01', 0, 100_001)
      expect({
        yearEnd: buildReportSnapshotContentForExport(db, params('balance_sheet', true)),
        current: buildReportSnapshotContentForExport(db, params('balance_sheet', false))
      }).toMatchSnapshot()
    }
  )
  it('多个非法条件并存时保留原始校验顺序和中文错误', () => {
    const db = createFixture('npo', false)
    const errorMessage = (input: GenerateReportSnapshotParams): string => {
      try {
        buildReportSnapshotContentForExport(db, input)
      } catch (error) {
        if (error instanceof Error) return error.message
        throw error
      }
      throw new Error('预期输入被拒绝')
    }
    const invalid: GenerateReportSnapshotParams = {
      ledgerId: 999,
      reportType: 'income_statement',
      startPeriod: 'invalid',
      endPeriod: 'invalid',
      now
    }
    expect(errorMessage(invalid)).toBe('账套不存在')
    expect(errorMessage({ ...invalid, ledgerId: 1 })).toBe('会计期间格式应为 YYYY-MM')
    expect(
      errorMessage({
        ...invalid,
        ledgerId: 1,
        startPeriod: '2026-02',
        endPeriod: '2026-01'
      })
    ).toBe('起始月份不能晚于结束月份')
    expect(
      errorMessage({
        ...invalid,
        ledgerId: 1,
        startPeriod: '2026-01',
        endPeriod: '2026-02'
      })
    ).toBe('当前账套不支持生成利润表')
  })
})

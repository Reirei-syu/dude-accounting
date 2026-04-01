import { describe, expect, it } from 'vitest'
import {
  areNumberArraysEqual,
  buildReportFilterOptions,
  filterSnapshotSelection,
  filterReportSnapshots,
  type ReportSnapshotSummaryLike
} from './reportingQueryUtils'

const rows: ReportSnapshotSummaryLike[] = [
  {
    id: 1,
    report_type: 'balance_sheet',
    report_name: '资产负债表 2026-03',
    period: '2026.03',
    start_period: '2026-03',
    end_period: '2026-03',
    as_of_date: '2026-03-31',
    generated_at: '2026-03-09T10:00:00.000Z'
  },
  {
    id: 2,
    report_type: 'income_statement',
    report_name: '利润表 2026-02',
    period: '2026.02-2026.02',
    start_period: '2026-02',
    end_period: '2026-02',
    as_of_date: null,
    generated_at: '2026-03-09T09:00:00.000Z'
  },
  {
    id: 3,
    report_type: 'cashflow_statement',
    report_name: '现金流量表 2026-03',
    period: '2026.03-2026.03',
    start_period: '2026-03',
    end_period: '2026-03',
    as_of_date: null,
    generated_at: '2026-03-09T11:00:00.000Z'
  },
  {
    id: 4,
    report_type: 'equity_statement',
    report_name: '所有者权益变动表 2026-01-2026-03',
    period: '2026.01-2026.03',
    start_period: '2026-01',
    end_period: '2026-03',
    as_of_date: null,
    generated_at: '2026-03-09T12:00:00.000Z'
  }
]

describe('reportingQueryUtils', () => {
  it('filters report snapshots with multi-select report types and date range', () => {
    const filtered = filterReportSnapshots(rows, {
      reportTypes: ['balance_sheet', 'cashflow_statement'],
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    })

    expect(filtered.map((item) => item.id)).toEqual([1, 3])
  })

  it('returns all snapshots when no filter is selected', () => {
    expect(filterReportSnapshots(rows, { reportTypes: [], startDate: null, endDate: null })).toEqual(rows)
  })

  it('builds filter option bounds from snapshot rows', () => {
    const options = buildReportFilterOptions(rows)

    expect(options.minDate).toBe('2026-01-01')
    expect(options.maxDate).toBe('2026-03-31')
    expect(options.reportTypes).toEqual([
      'balance_sheet',
      'cashflow_statement',
      'equity_statement',
      'income_statement'
    ])
  })

  it('filters selected snapshot ids against current visible rows', () => {
    expect(filterSnapshotSelection([1, 2, 5], rows)).toEqual([1, 2])
  })

  it('compares number arrays by value and order', () => {
    expect(areNumberArraysEqual([1, 2], [1, 2])).toBe(true)
    expect(areNumberArraysEqual([1, 2], [2, 1])).toBe(false)
    expect(areNumberArraysEqual([1, 2], [1, 2, 3])).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildReportFilterOptions,
  filterReportSnapshots,
  type ReportSnapshotSummaryLike
} from './reportingQueryUtils'

const rows: ReportSnapshotSummaryLike[] = [
  {
    id: 1,
    report_type: 'balance_sheet',
    report_name: '资产负债表 2026-03',
    period: '2026.03',
    generated_at: '2026-03-09T10:00:00.000Z'
  },
  {
    id: 2,
    report_type: 'income_statement',
    report_name: '利润表 2026-02',
    period: '2026.02-2026.02',
    generated_at: '2026-03-09T09:00:00.000Z'
  },
  {
    id: 3,
    report_type: 'cashflow_statement',
    report_name: '现金流量表 2026-03',
    period: '2026.03-2026.03',
    generated_at: '2026-03-09T11:00:00.000Z'
  }
]

describe('reportingQueryUtils', () => {
  it('filters report snapshots with multi-select report types and periods', () => {
    const filtered = filterReportSnapshots(rows, {
      reportTypes: ['balance_sheet', 'cashflow_statement'],
      periods: ['2026.03', '2026.03-2026.03']
    })

    expect(filtered.map((item) => item.id)).toEqual([1, 3])
  })

  it('returns all snapshots when no filter is selected', () => {
    expect(filterReportSnapshots(rows, { reportTypes: [], periods: [] })).toEqual(rows)
  })

  it('builds sorted filter options from snapshot rows', () => {
    const options = buildReportFilterOptions(rows)

    expect(options.periods).toEqual(['2026.03-2026.03', '2026.03', '2026.02-2026.02'])
    expect(options.reportTypes).toEqual(['balance_sheet', 'cashflow_statement', 'income_statement'])
  })
})

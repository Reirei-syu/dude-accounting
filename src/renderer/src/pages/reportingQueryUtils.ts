export type ReportType =
  | 'balance_sheet'
  | 'income_statement'
  | 'activity_statement'
  | 'cashflow_statement'

export interface ReportSnapshotSummaryLike {
  id: number
  report_type: ReportType
  report_name: string
  period: string
  generated_at: string
}

export interface ReportFilterState {
  reportTypes: ReportType[]
  periods: string[]
}

export function filterReportSnapshots<T extends ReportSnapshotSummaryLike>(
  rows: T[],
  filters: ReportFilterState
): T[] {
  const reportTypeSet = new Set(filters.reportTypes)
  const periodSet = new Set(filters.periods)

  return rows.filter((row) => {
    const matchesType = reportTypeSet.size === 0 || reportTypeSet.has(row.report_type)
    const matchesPeriod = periodSet.size === 0 || periodSet.has(row.period)
    return matchesType && matchesPeriod
  })
}

export function buildReportFilterOptions(rows: ReportSnapshotSummaryLike[]): {
  reportTypes: ReportType[]
  periods: string[]
} {
  const reportTypes = Array.from(new Set(rows.map((row) => row.report_type))).sort()
  const periods = Array.from(new Set(rows.map((row) => row.period))).sort((left, right) =>
    right.localeCompare(left)
  )

  return {
    reportTypes,
    periods
  }
}

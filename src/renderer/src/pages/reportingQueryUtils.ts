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
  start_period: string
  end_period: string
  as_of_date: string | null
  generated_at: string
}

export interface ReportFilterState {
  reportTypes: ReportType[]
  startDate: string | null
  endDate: string | null
}

function getPeriodStartDate(period: string): string {
  return `${period}-01`
}

function getPeriodEndDate(period: string): string {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(year, month, 0).getDate()
  return `${period}-${String(lastDay).padStart(2, '0')}`
}

export function getSnapshotDateRange(row: ReportSnapshotSummaryLike): {
  startDate: string
  endDate: string
} {
  if (row.as_of_date) {
    return {
      startDate: row.as_of_date,
      endDate: row.as_of_date
    }
  }

  return {
    startDate: getPeriodStartDate(row.start_period),
    endDate: getPeriodEndDate(row.end_period)
  }
}

export function filterReportSnapshots<T extends ReportSnapshotSummaryLike>(
  rows: T[],
  filters: ReportFilterState
): T[] {
  const reportTypeSet = new Set(filters.reportTypes)

  return rows.filter((row) => {
    const scope = getSnapshotDateRange(row)
    const matchesType = reportTypeSet.size === 0 || reportTypeSet.has(row.report_type)
    const matchesStart = !filters.startDate || scope.startDate >= filters.startDate
    const matchesEnd = !filters.endDate || scope.endDate <= filters.endDate
    return matchesType && matchesStart && matchesEnd
  })
}

export function buildReportFilterOptions(rows: ReportSnapshotSummaryLike[]): {
  reportTypes: ReportType[]
  minDate: string | null
  maxDate: string | null
} {
  const reportTypes = Array.from(new Set(rows.map((row) => row.report_type))).sort()
  const ranges = rows.map(getSnapshotDateRange)
  const minDate = ranges.length > 0 ? ranges.map((range) => range.startDate).sort()[0] : null
  const maxDate =
    ranges.length > 0 ? ranges.map((range) => range.endDate).sort((left, right) => right.localeCompare(left))[0] : null

  return {
    reportTypes,
    minDate,
    maxDate
  }
}

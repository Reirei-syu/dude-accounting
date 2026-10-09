export interface ReportRenderOptions {
  showCashflowPreviousAmount?: boolean
}

export interface ReportTablePresentationColumn {
  key: string
  label: string
}

export interface ReportTablePresentationCell {
  value: string | number | null
  isAmount?: boolean
}

export interface ReportTablePresentationRow {
  key: string
  cells: ReportTablePresentationCell[]
}

export interface ReportTablePresentationTable {
  key: string
  columns: ReportTablePresentationColumn[]
  rows: ReportTablePresentationRow[]
}

export function normalizeReportRenderOptions(
  reportType: string,
  options?: ReportRenderOptions | null
): Required<ReportRenderOptions> {
  return {
    showCashflowPreviousAmount:
      reportType === 'cashflow_statement' ? options?.showCashflowPreviousAmount !== false : true
  }
}

export function buildPresentedReportTables(
  reportType: string,
  tables: ReportTablePresentationTable[] | undefined,
  options?: ReportRenderOptions | null,
  amountMode: 'cents' | 'yuan' = 'cents',
  scope?: { startPeriod: string; endPeriod: string }
): ReportTablePresentationTable[] | undefined {
  if (!tables) {
    return tables
  }

  const normalizedOptions = normalizeReportRenderOptions(reportType, options)

  return tables.map((table) => {
    const hiddenColumnIndexes =
      reportType === 'cashflow_statement' && !normalizedOptions.showCashflowPreviousAmount
        ? table.columns.reduce<number[]>((indexes, column, index) => {
            if (column.key === 'previous') {
              indexes.push(index)
            }
            return indexes
          }, [])
        : []

    return {
      ...table,
      columns: table.columns
        .filter((_, index) => !hiddenColumnIndexes.includes(index))
        .map((column) => {
          let label = column.label
          if (
            scope &&
            reportType === 'activity_statement' &&
            scope.startPeriod !== scope.endPeriod
          ) {
            const [year, month] = scope.endPeriod.split('-')
            label = label.replace(/^本月数/, `${year}年${Number(month)}月数`)
            if (scope.startPeriod.slice(0, 4) !== year) {
              label = label.replace(/^本年累计数/, `${year}年累计数`)
            }
          }
          if (scope && reportType === 'cashflow_statement') {
            if (column.key === 'previous' && label === '上期金额') label = '上年同期金额'
            const fullYear =
              scope.startPeriod.slice(0, 4) === scope.endPeriod.slice(0, 4) &&
              scope.startPeriod.endsWith('-01') &&
              scope.endPeriod.endsWith('-12')
            if (!fullYear) {
              if (column.key === 'current' && label === '本年金额') label = '本期金额'
              if (column.key === 'previous' && label === '上年金额') label = '上年同期金额'
            }
          }
          return { ...column, label }
        }),
      rows: table.rows.map((row) => ({
        ...row,
        cells: row.cells
          .filter((_, index) => !hiddenColumnIndexes.includes(index))
          .map((cell) => ({
            ...cell,
            value:
              amountMode === 'yuan' && cell.isAmount === true && typeof cell.value === 'number'
                ? cell.value / 100
                : cell.value
          }))
      }))
    }
  })
}

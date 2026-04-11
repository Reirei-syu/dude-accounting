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
  amountMode: 'cents' | 'yuan' = 'cents'
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
      columns: table.columns.filter((_, index) => !hiddenColumnIndexes.includes(index)),
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

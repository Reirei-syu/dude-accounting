export interface SubjectBalanceBaseRow {
  subject_code: string
  subject_name: string
  category: string
  balance_direction: number
  level: number
  is_leaf: 0 | 1
  opening_debit_amount: number
  opening_credit_amount: number
  period_debit_amount: number
  period_credit_amount: number
  ending_debit_amount: number
  ending_credit_amount: number
}

export type SubjectBalanceRowType = 'data' | 'subtotal' | 'total'

export interface SubjectBalanceDisplayRow extends SubjectBalanceBaseRow {
  rowType: SubjectBalanceRowType
}

function sumRows(rows: SubjectBalanceBaseRow[]): Omit<
  SubjectBalanceDisplayRow,
  'subject_code' | 'subject_name' | 'category' | 'balance_direction' | 'level' | 'is_leaf' | 'rowType'
> {
  return rows.reduce(
    (totals, row) => ({
      opening_debit_amount: totals.opening_debit_amount + row.opening_debit_amount,
      opening_credit_amount: totals.opening_credit_amount + row.opening_credit_amount,
      period_debit_amount: totals.period_debit_amount + row.period_debit_amount,
      period_credit_amount: totals.period_credit_amount + row.period_credit_amount,
      ending_debit_amount: totals.ending_debit_amount + row.ending_debit_amount,
      ending_credit_amount: totals.ending_credit_amount + row.ending_credit_amount
    }),
    {
      opening_debit_amount: 0,
      opening_credit_amount: 0,
      period_debit_amount: 0,
      period_credit_amount: 0,
      ending_debit_amount: 0,
      ending_credit_amount: 0
    }
  )
}

function buildSummaryRow(
  key: string,
  label: string,
  category: string,
  rowType: SubjectBalanceRowType,
  rows: SubjectBalanceBaseRow[]
): SubjectBalanceDisplayRow {
  return {
    subject_code: key,
    subject_name: label,
    category,
    balance_direction: 1,
    level: 0,
    is_leaf: 0,
    rowType,
    ...sumRows(rows)
  }
}

export function buildSubjectBalanceDisplayRows(
  rows: SubjectBalanceBaseRow[],
  standardType: 'enterprise' | 'npo'
): SubjectBalanceDisplayRow[] {
  const dataRows = rows.map((row) => ({ ...row, rowType: 'data' as const }))
  const leafRows = rows.filter((row) => row.is_leaf === 1)

  if (leafRows.length === 0) {
    return dataRows
  }

  const subtotalConfigs =
    standardType === 'npo'
      ? [
          { key: 'subtotal-asset', label: '资产合计', categories: ['asset'] },
          { key: 'subtotal-liability', label: '负债合计', categories: ['liability'] },
          { key: 'subtotal-net-assets', label: '净资产合计', categories: ['net_assets'] }
        ]
      : [
          { key: 'subtotal-asset', label: '资产合计', categories: ['asset'] },
          { key: 'subtotal-liability', label: '负债合计', categories: ['liability'] },
          { key: 'subtotal-equity', label: '所有者权益合计', categories: ['equity'] }
        ]

  const summaryRowsByCategory = new Map<string, SubjectBalanceDisplayRow>()
  for (const config of subtotalConfigs) {
    const matchedRows = leafRows.filter((row) => config.categories.includes(row.category))
    if (matchedRows.length === 0) {
      continue
    }
    summaryRowsByCategory.set(
      config.categories[0],
      buildSummaryRow(config.key, config.label, config.categories[0], 'subtotal', matchedRows)
    )
  }

  const lastDisplayIndexByCategory = new Map<string, number>()
  dataRows.forEach((row, index) => {
    if (summaryRowsByCategory.has(row.category)) {
      lastDisplayIndexByCategory.set(row.category, index)
    }
  })

  const totalRow = buildSummaryRow('total-all', '借贷总计', 'total', 'total', leafRows)

  const displayRows: SubjectBalanceDisplayRow[] = []
  dataRows.forEach((row, index) => {
    displayRows.push(row)
    if (lastDisplayIndexByCategory.get(row.category) === index) {
      const summaryRow = summaryRowsByCategory.get(row.category)
      if (summaryRow) {
        displayRows.push(summaryRow)
      }
    }
  })

  displayRows.push(totalRow)
  return displayRows
}

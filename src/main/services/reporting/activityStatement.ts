import type Database from 'better-sqlite3'
import type {
  EntryWithVoucher,
  LedgerRow,
  ReportSnapshotScope,
  ReportSnapshotContent,
  ReportSnapshotTableRow
} from './types'
import {
  listEffectiveEntries,
  createTextCell,
  createAmountCell,
  ACTIVITY_STATEMENT_TITLE,
  insertHeaderBreakBeforeParenthesis
} from './common'

function sumEntriesByPrefixes(
  entries: EntryWithVoucher[],
  prefixes: string[],
  direction: 'income' | 'expense',
  period?: string
): { unrestricted: number; restricted: number } {
  let unrestricted = 0
  let restricted = 0

  for (const entry of entries) {
    if (period && entry.period !== period) {
      continue
    }
    if (
      !prefixes.some(
        (prefix) => entry.subject_code === prefix || entry.subject_code.startsWith(prefix)
      )
    ) {
      continue
    }

    const amount =
      direction === 'income'
        ? entry.credit_amount - entry.debit_amount
        : entry.debit_amount - entry.credit_amount
    if (entry.subject_code.endsWith('02')) {
      restricted += amount
    } else {
      unrestricted += amount
    }
  }

  return { unrestricted, restricted }
}

function sumNgoNetAssetTransfers(
  entries: EntryWithVoucher[],
  period?: string
): {
  restrictedToUnrestricted: number
  unrestrictedToRestricted: number
} {
  const netAssetChangesByVoucher = new Map<number, { unrestricted: number; restricted: number }>()

  for (const entry of entries) {
    if (period && entry.period !== period) {
      continue
    }

    const isUnrestricted =
      entry.subject_code === '3101' || entry.subject_code.startsWith('3101')
    const isRestricted = entry.subject_code === '3102' || entry.subject_code.startsWith('3102')

    if (!isUnrestricted && !isRestricted) {
      continue
    }

    const current = netAssetChangesByVoucher.get(entry.voucher_id) ?? {
      unrestricted: 0,
      restricted: 0
    }
    const netChange = entry.credit_amount - entry.debit_amount

    if (isUnrestricted) {
      current.unrestricted += netChange
    }
    if (isRestricted) {
      current.restricted += netChange
    }

    netAssetChangesByVoucher.set(entry.voucher_id, current)
  }

  let restrictedToUnrestricted = 0
  let unrestrictedToRestricted = 0

  for (const change of netAssetChangesByVoucher.values()) {
    if (change.unrestricted > 0 && change.restricted < 0) {
      restrictedToUnrestricted += Math.min(change.unrestricted, Math.abs(change.restricted))
    } else if (change.unrestricted < 0 && change.restricted > 0) {
      unrestrictedToRestricted += Math.min(Math.abs(change.unrestricted), change.restricted)
    }
  }

  return {
    restrictedToUnrestricted,
    unrestrictedToRestricted
  }
}

export function buildNgoActivityStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  currentPeriod: string | null = scope.endPeriod
): ReportSnapshotContent {
  const selectedEntries = listEffectiveEntries(
    db,
    ledger.id,
    scope.startDate,
    scope.endDate,
    scope.includeUnpostedVouchers
  )
  const currentLabel =
    currentPeriod === null
      ? '本期数'
      : currentPeriod === scope.endPeriod
        ? '本月数'
        : `${currentPeriod.slice(0, 4)}年${Number(currentPeriod.slice(5))}月数`
  const cumulativeStartDate = `${scope.endPeriod.slice(0, 4)}-01-01`
  const cumulativeEntries = listEffectiveEntries(
    db,
    ledger.id,
    cumulativeStartDate,
    scope.endDate,
    scope.includeUnpostedVouchers
  )

  const incomeGroups = [
    { label: '捐赠收入', prefixes: ['4101'] },
    { label: '会费收入', prefixes: ['4201'] },
    { label: '提供服务收入', prefixes: ['4301'] },
    { label: '政府补助收入', prefixes: ['4401'] },
    { label: '商品销售收入', prefixes: ['4501'] },
    { label: '总部拨款收入', prefixes: ['4701'] },
    { label: '投资收益', prefixes: ['4601'] },
    { label: '其他收入', prefixes: ['4901'] }
  ]
  const expenseGroups = [
    { label: '业务活动成本', prefixes: ['5101'] },
    { label: '  其中：税金及附加', prefixes: ['5201'] },
    { label: '管理费用', prefixes: ['5301'] },
    { label: '筹资费用', prefixes: ['5401'] },
    { label: '资产减值损失', prefixes: ['5501'] },
    { label: '所得税费用', prefixes: ['5601'] },
    { label: '其他费用', prefixes: ['5901'] }
  ]

  const rowOf = (
    key: string,
    label: string,
    current: { unrestricted: number; restricted: number },
    cumulative: { unrestricted: number; restricted: number }
  ): ReportSnapshotTableRow => ({
    key,
    cells: [
      createTextCell(label),
      createAmountCell(current.unrestricted),
      createAmountCell(current.restricted),
      createAmountCell(current.unrestricted + current.restricted),
      createAmountCell(cumulative.unrestricted),
      createAmountCell(cumulative.restricted),
      createAmountCell(cumulative.unrestricted + cumulative.restricted)
    ]
  })

  const incomeRows = incomeGroups.map((group) =>
    rowOf(
      `income-${group.prefixes[0]}`,
      group.label,
      sumEntriesByPrefixes(selectedEntries, group.prefixes, 'income', currentPeriod ?? undefined),
      sumEntriesByPrefixes(cumulativeEntries, group.prefixes, 'income')
    )
  )
  const expenseRows = expenseGroups.map((group) =>
    rowOf(
      `expense-${group.prefixes[0]}`,
      group.label,
      sumEntriesByPrefixes(selectedEntries, group.prefixes, 'expense', currentPeriod ?? undefined),
      sumEntriesByPrefixes(cumulativeEntries, group.prefixes, 'expense')
    )
  )
  const currentTransfers = sumNgoNetAssetTransfers(selectedEntries, currentPeriod ?? undefined)
  const cumulativeTransfers = sumNgoNetAssetTransfers(cumulativeEntries)
  const restrictedToUnrestrictedCurrent = {
    unrestricted: currentTransfers.restrictedToUnrestricted,
    restricted: -currentTransfers.restrictedToUnrestricted
  }
  const restrictedToUnrestrictedCumulative = {
    unrestricted: cumulativeTransfers.restrictedToUnrestricted,
    restricted: -cumulativeTransfers.restrictedToUnrestricted
  }
  const unrestrictedToRestrictedCurrent = {
    unrestricted: -currentTransfers.unrestrictedToRestricted,
    restricted: currentTransfers.unrestrictedToRestricted
  }
  const unrestrictedToRestrictedCumulative = {
    unrestricted: -cumulativeTransfers.unrestrictedToRestricted,
    restricted: cumulativeTransfers.unrestrictedToRestricted
  }

  const sumColumns = (rows: ReportSnapshotTableRow[]): number[] =>
    [1, 2, 3, 4, 5, 6].map((index) =>
      rows.reduce(
        (sum, row) =>
          sum + (typeof row.cells[index]?.value === 'number' ? Number(row.cells[index].value) : 0),
        0
      )
    )

  const incomeTotals = sumColumns(incomeRows)
  const expenseTotals = sumColumns(expenseRows)
  const zeroSix = [0, 0, 0, 0, 0, 0]
  const netValues = [
    incomeTotals[0] -
      expenseTotals[0] +
      restrictedToUnrestrictedCurrent.unrestricted +
      unrestrictedToRestrictedCurrent.unrestricted,
    incomeTotals[1] -
      expenseTotals[1] +
      restrictedToUnrestrictedCurrent.restricted +
      unrestrictedToRestrictedCurrent.restricted,
    incomeTotals[2] - expenseTotals[2],
    incomeTotals[3] -
      expenseTotals[3] +
      restrictedToUnrestrictedCumulative.unrestricted +
      unrestrictedToRestrictedCumulative.unrestricted,
    incomeTotals[4] -
      expenseTotals[4] +
      restrictedToUnrestrictedCumulative.restricted +
      unrestrictedToRestrictedCumulative.restricted,
    incomeTotals[5] - expenseTotals[5]
  ]

  const tableRows: ReportSnapshotTableRow[] = [
    {
      key: 'income-header',
      cells: [createTextCell('一、收入'), ...zeroSix.map(() => createTextCell(''))]
    },
    ...incomeRows,
    {
      key: 'income-total',
      cells: [createTextCell('收入合计'), ...incomeTotals.map((value) => createAmountCell(value))]
    },
    {
      key: 'expense-header',
      cells: [createTextCell('二、费用'), ...zeroSix.map(() => createTextCell(''))]
    },
    ...expenseRows,
    {
      key: 'expense-total',
      cells: [createTextCell('费用合计'), ...expenseTotals.map((value) => createAmountCell(value))]
    },
    rowOf(
      'restricted-to-unrestricted',
      '三、限定性净资产转为非限定性净资产',
      restrictedToUnrestrictedCurrent,
      restrictedToUnrestrictedCumulative
    ),
    rowOf(
      'unrestricted-to-restricted',
      '四、非限定性净资产转为限定性净资产',
      unrestrictedToRestrictedCurrent,
      unrestrictedToRestrictedCumulative
    ),
    {
      key: 'prior-adjustment',
      cells: [createTextCell('五、以前年度净资产调整'), ...zeroSix.map(() => createAmountCell(0))]
    },
    {
      key: 'net-assets-change',
      cells: [
        createTextCell('六、净资产变动额（减少以“-”号填列）'),
        ...netValues.map((value) => createAmountCell(value))
      ]
    }
  ]

  return {
    title: ACTIVITY_STATEMENT_TITLE,
    reportType: 'activity_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非02表',
    tables: [
      {
        key: 'ngo-activity-statement',
        columns: [
          { key: 'item', label: '项目' },
          {
            key: 'current_unrestricted',
            label: insertHeaderBreakBeforeParenthesis(`${currentLabel}（非限定性）`)
          },
          {
            key: 'current_restricted',
            label: insertHeaderBreakBeforeParenthesis(`${currentLabel}（限定性）`)
          },
          {
            key: 'current_total',
            label: insertHeaderBreakBeforeParenthesis(`${currentLabel}（合计）`)
          },
          {
            key: 'cumulative_unrestricted',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（非限定性）')
          },
          {
            key: 'cumulative_restricted',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（限定性）')
          },
          {
            key: 'cumulative_total',
            label: insertHeaderBreakBeforeParenthesis('本年累计数（合计）')
          }
        ],
        rows: tableRows
      }
    ],
    sections: [],
    totals: [
      { key: 'income_total', label: '收入合计', amountCents: incomeTotals[5] },
      { key: 'expense_total', label: '费用合计', amountCents: expenseTotals[5] },
      { key: 'net_assets_change', label: '净资产变动额', amountCents: netValues[5] }
    ]
  }
}

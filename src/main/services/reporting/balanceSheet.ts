import type Database from 'better-sqlite3'
import {
  isCarryForwardSourceCategory
} from '../../database/subjectCategoryRules'
import type {
  ReportSnapshotLine,
  LedgerRow,
  ReportSnapshotScope,
  ReportSnapshotContent,
  ReportSnapshotTableCell,
  ReportSnapshotTableRow,
  EnterpriseBalancePoint,
  PrefixSpec
} from './types'
import {
  sumTemplateAmount,
  createAmountCell,
  createTextCell,
  BALANCE_SHEET_TITLE,
  listSubjects,
  getEffectiveLedgerStartPeriod,
  listInitialBalances,
  selectEffectiveVouchers,
  listVouchersInDateRange,
  getPeriodStartDate,
  mergeEntriesWithVouchers,
  listVoucherEntriesByVoucherIds,
  groupEntriesBySubject,
  buildSubjectBalanceMap,
  getOpeningBalance,
  toSubjectBalance
} from './common'
import {
  buildEnterpriseBalancePoint,
  buildEnterpriseEquityState
} from './enterpriseCalculations'

function createTemplateRow(
  key: string,
  label: string,
  lineNo: string,
  opening: number,
  closing: number
): ReportSnapshotLine {
  return {
    key,
    label,
    lineNo,
    amountCents: closing,
    cells: {
      opening,
      closing
    }
  }
}

function createEnterpriseComparableRow(
  key: string,
  label: string,
  lineNo: string,
  priorYearEnd: number,
  ending: number
): ReportSnapshotLine {
  return {
    key,
    label,
    lineNo,
    amountCents: ending,
    cells: {
      prior_year_end: priorYearEnd,
      ending
    }
  }
}

function buildNgoBalanceSheetSnapshot(
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  openingMap: Map<string, number>,
  closingMap: Map<string, number>,
  unrestrictedNetChange: number,
  restrictedNetChange: number
): ReportSnapshotContent {
  const buildRow = (
    key: string,
    label: string,
    lineNo: string,
    specs: Array<{ code: string; sign?: 1 | -1 }>
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      sumTemplateAmount(openingMap, specs),
      sumTemplateAmount(closingMap, specs)
    )

  const buildSumRow = (
    key: string,
    label: string,
    lineNo: string,
    rows: ReportSnapshotLine[]
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      rows.reduce((sum, row) => sum + (row.cells?.opening ?? 0), 0),
      rows.reduce((sum, row) => sum + (row.cells?.closing ?? 0), 0)
    )

  const buildDiffRow = (
    key: string,
    label: string,
    lineNo: string,
    minuend: ReportSnapshotLine,
    subtrahend: ReportSnapshotLine
  ): ReportSnapshotLine =>
    createTemplateRow(
      key,
      label,
      lineNo,
      (minuend.cells?.opening ?? 0) - (subtrahend.cells?.opening ?? 0),
      (minuend.cells?.closing ?? 0) - (subtrahend.cells?.closing ?? 0)
    )

  const createHeadingRow = (key: string, label: string): ReportSnapshotLine => ({
    key,
    label,
    amountCents: 0
  })

  const cashRow = buildRow('cash', '货币资金', '1', [
    { code: '1001' },
    { code: '1002' },
    { code: '1009' }
  ])
  const shortInvestmentRow = buildRow('short_investment', '短期投资', '2', [
    { code: '1101' },
    { code: '1102', sign: -1 }
  ])
  const receivablesRow = buildRow('receivables', '应收款项', '3', [
    { code: '1111' },
    { code: '1121' },
    { code: '1122' },
    { code: '1131', sign: -1 }
  ])
  const prepaymentRow = buildRow('prepayments', '预付账款', '4', [{ code: '1141' }])
  const inventoryRow = buildRow('inventory', '存货', '5', [
    { code: '1201' },
    { code: '1202', sign: -1 }
  ])
  const prepaidExpenseRow = buildRow('prepaid_expense', '待摊费用', '6', [{ code: '1301' }])
  const currentLongInvestmentRow = buildRow(
    'current_long_investment',
    '一年内到期的长期投资',
    '7',
    []
  )
  const otherCurrentAssetRow = buildRow('other_current_assets', '其他流动资产', '8', [])
  const flowAssetsTotalRow = buildSumRow('flow_assets_total', '流动资产合计', '9', [
    cashRow,
    shortInvestmentRow,
    receivablesRow,
    prepaymentRow,
    inventoryRow,
    prepaidExpenseRow,
    currentLongInvestmentRow,
    otherCurrentAssetRow
  ])

  const longTermEquityRow = buildRow('long_term_equity', '长期股权投资', '10', [{ code: '1401' }])
  const longTermDebtRow = buildRow('long_term_debt', '长期债权投资', '11', [{ code: '1402' }])
  const otherLongInvestmentRow = buildRow('other_long_investment', '其他长期投资', '12', [
    { code: '1403' }
  ])
  const longTermInvestmentTotalRow = buildSumRow(
    'long_term_investment_total',
    '长期投资合计',
    '13',
    [longTermEquityRow, longTermDebtRow, otherLongInvestmentRow]
  )

  const fixedAssetCostRow = buildRow('fixed_asset_cost', '固定资产原价', '14', [{ code: '1501' }])
  const accumulatedDepreciationRow = buildRow('accumulated_depreciation', '减：累计折旧', '15', [
    { code: '1502' }
  ])
  const fixedAssetNetRow = buildDiffRow(
    'fixed_asset_net',
    '固定资产净值',
    '16',
    fixedAssetCostRow,
    accumulatedDepreciationRow
  )
  const constructionInProgressRow = buildRow('construction_in_progress', '在建工程', '17', [
    { code: '1505' }
  ])
  const fixedAssetDisposalRow = buildRow('fixed_asset_disposal', '固定资产清理', '18', [
    { code: '1509' }
  ])
  const fixedAssetsTotalRow = buildSumRow('fixed_assets_total', '固定资产合计', '19', [
    fixedAssetNetRow,
    constructionInProgressRow,
    fixedAssetDisposalRow
  ])

  const culturalRelicRow = buildRow('cultural_relic', '文物资源', '20', [{ code: '1506' }])
  const intangibleOriginalRow = buildRow('intangible_original', '无形资产原价', '21', [
    { code: '1601' }
  ])
  const intangibleAccumulatedRow = buildRow('intangible_accumulated', '减：累计摊销', '22', [
    { code: '1602' }
  ])
  const intangibleNetRow = buildDiffRow(
    'intangible_net',
    '无形资产净值',
    '23',
    intangibleOriginalRow,
    intangibleAccumulatedRow
  )
  const longPrepaidRow = buildRow('long_prepaid', '长期待摊费用', '24', [{ code: '1701' }])
  const nonCurrentAssetTotalRow = buildSumRow('noncurrent_total', '非流动资产合计', '25', [
    longTermInvestmentTotalRow,
    fixedAssetsTotalRow,
    culturalRelicRow,
    intangibleNetRow,
    longPrepaidRow
  ])
  const entrustedAssetRow = buildRow('entrusted_asset', '受托代理资产', '26', [{ code: '1801' }])
  const assetTotalRow = buildSumRow('asset_total', '资产总计', '27', [
    flowAssetsTotalRow,
    nonCurrentAssetTotalRow,
    entrustedAssetRow
  ])

  const shortTermLoanRow = buildRow('short_term_loan', '短期借款', '61', [{ code: '2101' }])
  const payablesRow = buildRow('payables', '应付款项', '62', [
    { code: '2201' },
    { code: '2202' },
    { code: '2209' }
  ])
  const payrollRow = buildRow('payroll', '应付职工薪酬', '63', [{ code: '2204' }])
  const taxesRow = buildRow('taxes', '应交税费', '64', [{ code: '2206' }])
  const advanceReceiptsRow = buildRow('advance_receipts', '预收账款', '65', [{ code: '2203' }])
  const accruedExpenseRow = buildRow('accrued_expense', '预提费用', '66', [{ code: '2301' }])
  const currentLongLiabilityRow = buildRow(
    'current_long_liability',
    '一年内到期的长期负债',
    '67',
    []
  )
  const otherCurrentLiabilityRow = buildRow('other_current_liability', '其他流动负债', '68', [])
  const flowLiabilityTotalRow = buildSumRow('flow_liability_total', '流动负债合计', '69', [
    shortTermLoanRow,
    payablesRow,
    payrollRow,
    taxesRow,
    advanceReceiptsRow,
    accruedExpenseRow,
    currentLongLiabilityRow,
    otherCurrentLiabilityRow
  ])

  const longTermLoanRow = buildRow('long_term_loan', '长期借款', '70', [{ code: '2501' }])
  const longTermPayableRow = buildRow('long_term_payable', '长期应付款', '71', [{ code: '2502' }])
  const estimatedLiabilityRow = buildRow('estimated_liability', '预计负债', '72', [
    { code: '2503' }
  ])
  const otherLongTermLiabilityRow = buildRow('other_long_term_liability', '其他长期负债', '73', [])
  const longTermLiabilityTotalRow = buildSumRow('long_term_liability_total', '长期负债合计', '74', [
    longTermLoanRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    otherLongTermLiabilityRow
  ])
  const entrustedLiabilityRow = buildRow('entrusted_liability', '受托代理负债', '75', [
    { code: '2601' }
  ])
  const liabilityTotalRow = buildSumRow('liability_total', '负债合计', '76', [
    flowLiabilityTotalRow,
    longTermLiabilityTotalRow,
    entrustedLiabilityRow
  ])
  const unrestrictedNetAssetsRow = createTemplateRow(
    'unrestricted_net_assets',
    '非限定性净资产',
    '77',
    sumTemplateAmount(openingMap, [{ code: '3101' }]),
    sumTemplateAmount(closingMap, [{ code: '3101' }]) + unrestrictedNetChange
  )
  const restrictedNetAssetsRow = createTemplateRow(
    'restricted_net_assets',
    '限定性净资产',
    '78',
    sumTemplateAmount(openingMap, [{ code: '3102' }]),
    sumTemplateAmount(closingMap, [{ code: '3102' }]) + restrictedNetChange
  )
  const netAssetsTotalRow = buildSumRow('net_assets_total', '净资产合计', '79', [
    unrestrictedNetAssetsRow,
    restrictedNetAssetsRow
  ])
  const liabilityAndNetAssetsTotalRow = buildSumRow(
    'liability_and_net_assets_total',
    '负债和净资产总计',
    '80',
    [liabilityTotalRow, netAssetsTotalRow]
  )

  const assetRows: ReportSnapshotLine[] = [
    cashRow,
    shortInvestmentRow,
    receivablesRow,
    prepaymentRow,
    inventoryRow,
    prepaidExpenseRow,
    currentLongInvestmentRow,
    otherCurrentAssetRow,
    flowAssetsTotalRow,
    longTermEquityRow,
    longTermDebtRow,
    otherLongInvestmentRow,
    longTermInvestmentTotalRow,
    fixedAssetCostRow,
    accumulatedDepreciationRow,
    fixedAssetNetRow,
    constructionInProgressRow,
    fixedAssetDisposalRow,
    fixedAssetsTotalRow,
    culturalRelicRow,
    intangibleOriginalRow,
    intangibleAccumulatedRow,
    intangibleNetRow,
    longPrepaidRow,
    nonCurrentAssetTotalRow,
    entrustedAssetRow,
    assetTotalRow
  ]

  const liabilityRows: ReportSnapshotLine[] = [
    shortTermLoanRow,
    payablesRow,
    payrollRow,
    taxesRow,
    advanceReceiptsRow,
    accruedExpenseRow,
    currentLongLiabilityRow,
    otherCurrentLiabilityRow,
    flowLiabilityTotalRow,
    longTermLoanRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    otherLongTermLiabilityRow,
    longTermLiabilityTotalRow,
    entrustedLiabilityRow,
    liabilityTotalRow,
    unrestrictedNetAssetsRow,
    restrictedNetAssetsRow,
    netAssetsTotalRow,
    liabilityAndNetAssetsTotalRow
  ]

  const amountCellsForRow = (row?: ReportSnapshotLine): ReportSnapshotTableCell[] =>
    row?.cells
      ? [createAmountCell(row.cells.opening ?? 0), createAmountCell(row.cells.closing ?? 0)]
      : [createTextCell(''), createTextCell('')]

  const pairRow = (
    key: string,
    left: ReportSnapshotLine | undefined,
    right: ReportSnapshotLine | undefined
  ): ReportSnapshotTableRow => ({
    key,
    cells: [
      createTextCell(left?.label ?? ''),
      ...amountCellsForRow(left),
      createTextCell(right?.label ?? ''),
      ...amountCellsForRow(right)
    ]
  })

  const officialRows: ReportSnapshotTableRow[] = [
    pairRow(
      'row-1',
      createHeadingRow('asset-current-heading', '一、流动资产：'),
      createHeadingRow('liability-current-heading', '一、流动负债：')
    ),
    pairRow('row-2', cashRow, shortTermLoanRow),
    pairRow('row-3', shortInvestmentRow, payablesRow),
    pairRow('row-4', receivablesRow, payrollRow),
    pairRow('row-5', prepaymentRow, taxesRow),
    pairRow('row-6', inventoryRow, advanceReceiptsRow),
    pairRow('row-7', prepaidExpenseRow, accruedExpenseRow),
    pairRow('row-8', currentLongInvestmentRow, currentLongLiabilityRow),
    pairRow('row-9', otherCurrentAssetRow, otherCurrentLiabilityRow),
    pairRow('row-10', flowAssetsTotalRow, flowLiabilityTotalRow),
    pairRow(
      'row-11',
      createHeadingRow('asset-noncurrent-heading', '二、非流动资产：'),
      createHeadingRow('liability-long-heading', '二、长期负债：')
    ),
    pairRow(
      'row-12',
      createHeadingRow('asset-long-investment-heading', '长期投资：'),
      longTermLoanRow
    ),
    pairRow('row-13', longTermEquityRow, longTermPayableRow),
    pairRow('row-14', longTermDebtRow, estimatedLiabilityRow),
    pairRow('row-15', otherLongInvestmentRow, otherLongTermLiabilityRow),
    pairRow('row-16', longTermInvestmentTotalRow, longTermLiabilityTotalRow),
    pairRow(
      'row-17',
      createHeadingRow('asset-fixed-heading', '固定资产：'),
      createHeadingRow('entrusted-liability-heading', '三、受托代理负债')
    ),
    pairRow('row-18', fixedAssetCostRow, entrustedLiabilityRow),
    pairRow('row-19', accumulatedDepreciationRow, liabilityTotalRow),
    pairRow('row-20', fixedAssetNetRow, createHeadingRow('net-assets-heading', '四、净资产：')),
    pairRow('row-21', constructionInProgressRow, unrestrictedNetAssetsRow),
    pairRow('row-22', fixedAssetDisposalRow, restrictedNetAssetsRow),
    pairRow('row-23', fixedAssetsTotalRow, netAssetsTotalRow),
    pairRow('row-24', culturalRelicRow, undefined),
    pairRow('row-25', createHeadingRow('asset-intangible-heading', '无形资产：'), undefined),
    pairRow('row-26', intangibleOriginalRow, undefined),
    pairRow('row-27', intangibleAccumulatedRow, undefined),
    pairRow('row-28', intangibleNetRow, undefined),
    pairRow('row-29', longPrepaidRow, undefined),
    pairRow('row-30', nonCurrentAssetTotalRow, undefined),
    pairRow('row-31', createHeadingRow('asset-entrusted-heading', '五、受托代理资产：'), undefined),
    pairRow('row-32', entrustedAssetRow, undefined),
    pairRow('row-33', assetTotalRow, liabilityAndNetAssetsTotalRow)
  ]

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非01表',
    tableColumns: [
      { key: 'opening', label: '年初数' },
      { key: 'closing', label: '期末数' }
    ],
    tables: [
      {
        key: 'ngo-balance-sheet',
        columns: [
          { key: 'left_label', label: '项目' },
          { key: 'left_opening', label: '年初余额' },
          { key: 'left_closing', label: '期末余额' },
          { key: 'right_label', label: '项目' },
          { key: 'right_opening', label: '年初余额' },
          { key: 'right_closing', label: '期末余额' }
        ],
        rows: officialRows
      }
    ],
    sections: [
      { key: 'assets', title: '资产', rows: assetRows },
      { key: 'liabilities_and_net_assets', title: '负债和净资产', rows: liabilityRows }
    ],
    totals: [
      { key: 'assets', label: '资产总计', amountCents: assetTotalRow.amountCents },
      { key: 'liabilities', label: '负债合计', amountCents: liabilityTotalRow.amountCents },
      { key: 'net_assets', label: '净资产合计', amountCents: netAssetsTotalRow.amountCents }
    ]
  }
}

export function buildBalanceSheetSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const effectiveLedgerStartPeriod = getEffectiveLedgerStartPeriod(ledger, scope.endPeriod)
  const openingBySubject = listInitialBalances(db, ledger.id, scope.endPeriod)
  const vouchers = selectEffectiveVouchers(
    listVouchersInDateRange(
      db,
      ledger.id,
      getPeriodStartDate(effectiveLedgerStartPeriod),
      scope.endDate
    ),
    scope.includeUnpostedVouchers
  )
  const entries = mergeEntriesWithVouchers(
    vouchers,
    listVoucherEntriesByVoucherIds(
      db,
      vouchers.map((voucher) => voucher.id)
    )
  )
  const entriesBySubject = groupEntriesBySubject(entries)

  const profitLossSubjects = subjects.filter((subject) =>
    isCarryForwardSourceCategory(ledger.standard_type, subject.category)
  )

  const closingBalanceMap = buildSubjectBalanceMap(
    subjects,
    openingBySubject,
    entriesBySubject,
    effectiveLedgerStartPeriod,
    scope.endDate
  )
  const openingBalanceMap = new Map<string, number>()
  for (const subject of subjects) {
    openingBalanceMap.set(
      subject.code,
      getOpeningBalance(subject, openingBySubject.get(subject.code))
    )
  }

  const ngoUnrestrictedNetChange =
    ledger.standard_type === 'npo'
      ? profitLossSubjects.reduce((sum, subject) => {
          const amount = closingBalanceMap.get(subject.code) ?? 0
          const signedAmount = subject.balance_direction === -1 ? amount : -amount
          return sum + (subject.code.endsWith('02') ? 0 : signedAmount)
        }, 0)
      : 0

  const ngoRestrictedNetChange =
    ledger.standard_type === 'npo'
      ? profitLossSubjects.reduce((sum, subject) => {
          const amount = closingBalanceMap.get(subject.code) ?? 0
          const signedAmount = subject.balance_direction === -1 ? amount : -amount
          return sum + (subject.code.endsWith('02') ? signedAmount : 0)
        }, 0)
      : 0

  if (ledger.standard_type === 'npo') {
    return buildNgoBalanceSheetSnapshot(
      ledger,
      scope,
      generatedAt,
      openingBalanceMap,
      closingBalanceMap,
      ngoUnrestrictedNetChange,
      ngoRestrictedNetChange
    )
  }
  const currentPoint: EnterpriseBalancePoint = {
    balanceMap: closingBalanceMap,
    unsettledProfitLossNet: profitLossSubjects.reduce((sum, subject) => {
      const amount = toSubjectBalance(
        subject,
        openingBySubject.get(subject.code),
        entriesBySubject.get(subject.code) ?? [],
        effectiveLedgerStartPeriod,
        scope.endDate
      )
      return sum + (subject.balance_direction === -1 ? amount : -amount)
    }, 0)
  }
  const priorYear = String(Number(scope.endPeriod.slice(0, 4)) - 1).padStart(4, '0')
  const priorYearEndPoint = buildEnterpriseBalancePoint(
    db,
    ledger,
    subjects,
    `${priorYear}-12`,
    scope.includeUnpostedVouchers
  )
  const currentEquityState = buildEnterpriseEquityState(currentPoint)
  const priorYearEndEquityState = buildEnterpriseEquityState(priorYearEndPoint)

  const buildRow = (key: string, label: string, specs: PrefixSpec[]): ReportSnapshotLine =>
    createEnterpriseComparableRow(
      key,
      label,
      '',
      sumTemplateAmount(priorYearEndPoint.balanceMap, specs),
      sumTemplateAmount(currentPoint.balanceMap, specs)
    )

  const buildSumRow = (
    key: string,
    label: string,
    rows: ReportSnapshotLine[]
  ): ReportSnapshotLine =>
    createEnterpriseComparableRow(
      key,
      label,
      '',
      rows.reduce((sum, row) => sum + (row.cells?.prior_year_end ?? 0), 0),
      rows.reduce((sum, row) => sum + (row.cells?.ending ?? 0), 0)
    )

  const headingRow = (key: string, label: string): ReportSnapshotLine => ({
    key,
    label,
    amountCents: 0
  })

  const cashRow = buildRow('cash', '货币资金', [
    { code: '1001' },
    { code: '1002' },
    { code: '1012' }
  ])
  const tradingAssetRow = buildRow('trading_asset', '交易性金融资产', [{ code: '1101' }])
  const derivativeAssetRow = buildRow('derivative_asset', '衍生金融资产', [{ code: '3101' }])
  const notesReceivableRow = buildRow('notes_receivable', '应收票据', [{ code: '1121' }])
  const accountsReceivableRow = buildRow('accounts_receivable', '应收账款', [{ code: '1122' }])
  const receivablesFinancingRow = buildRow('receivables_financing', '应收款项融资', [])
  const prepaymentRow = buildRow('prepayments', '预付款项', [{ code: '1123' }])
  const contractAssetRow = buildRow('contract_assets', '合同资产', [])
  const otherReceivableRow = buildRow('other_receivables', '其他应收款', [
    { code: '1131' },
    { code: '1132' },
    { code: '1221' },
    { code: '1231', sign: -1 }
  ])
  const inventoryRow = buildRow('inventory', '存货', [
    { code: '1401' },
    { code: '1402' },
    { code: '1403' },
    { code: '1404' },
    { code: '1405' },
    { code: '1406' },
    { code: '1407', sign: -1 },
    { code: '1408' },
    { code: '1411' },
    { code: '1421' },
    { code: '1431' },
    { code: '1441' },
    { code: '1451' },
    { code: '1471', sign: -1 }
  ])
  const heldForSaleAssetRow = buildRow('held_for_sale_assets', '持有待售资产', [])
  const oneYearNonCurrentAssetRow = buildRow(
    'one_year_noncurrent_assets',
    '一年内到期的非流动资产',
    []
  )
  const otherCurrentAssetRow = buildRow('other_current_assets', '其他流动资产', [
    { code: '1021' },
    { code: '1031' },
    { code: '1111' },
    { code: '1201' },
    { code: '1211' },
    { code: '1212' },
    { code: '1301' },
    { code: '1302' },
    { code: '1303' },
    { code: '1304', sign: -1 },
    { code: '1311' },
    { code: '1321' },
    { code: '1901' }
  ])
  const totalCurrentAssetsRow = buildSumRow('total_current_assets', '流动资产合计', [
    cashRow,
    tradingAssetRow,
    derivativeAssetRow,
    notesReceivableRow,
    accountsReceivableRow,
    receivablesFinancingRow,
    prepaymentRow,
    contractAssetRow,
    otherReceivableRow,
    inventoryRow,
    heldForSaleAssetRow,
    oneYearNonCurrentAssetRow,
    otherCurrentAssetRow
  ])

  const debtInvestmentRow = buildRow('debt_investment', '债权投资', [
    { code: '1501' },
    { code: '1502', sign: -1 }
  ])
  const otherDebtInvestmentRow = buildRow('other_debt_investment', '其他债权投资', [
    { code: '1503' }
  ])
  const longTermReceivableRow = buildRow('long_term_receivable', '长期应收款', [
    { code: '1531' },
    { code: '1532', sign: -1 }
  ])
  const longTermEquityInvestmentRow = buildRow('long_term_equity_investment', '长期股权投资', [
    { code: '1511' },
    { code: '1512', sign: -1 }
  ])
  const otherEquityInvestmentRow = buildRow('other_equity_investment', '其他权益工具投资', [])
  const otherNonCurrentFinancialAssetRow = buildRow(
    'other_noncurrent_financial_assets',
    '其他非流动金融资产',
    [{ code: '1541' }]
  )
  const investmentPropertyRow = buildRow('investment_property', '投资性房地产', [{ code: '1521' }])
  const fixedAssetRow = buildRow('fixed_assets', '固定资产', [
    { code: '1601' },
    { code: '1602', sign: -1 },
    { code: '1603', sign: -1 }
  ])
  const constructionRow = buildRow('construction', '在建工程', [{ code: '1604' }])
  const biologicalAssetRow = buildRow('biological_assets', '生产性生物资产', [
    { code: '1621' },
    { code: '1622', sign: -1 }
  ])
  const oilGasRow = buildRow('oil_gas_assets', '油气资产', [
    { code: '1631' },
    { code: '1632', sign: -1 }
  ])
  const rightOfUseRow = buildRow('right_of_use_assets', '使用权资产', [])
  const intangibleRow = buildRow('intangible_assets', '无形资产', [
    { code: '1701' },
    { code: '1702', sign: -1 },
    { code: '1703', sign: -1 }
  ])
  const developmentRow = buildRow('development_expenditure', '开发支出', [])
  const goodwillRow = buildRow('goodwill', '商誉', [{ code: '1711' }])
  const longDeferredExpenseRow = buildRow('long_deferred_expenses', '长期待摊费用', [
    { code: '1801' }
  ])
  const deferredTaxAssetRow = buildRow('deferred_tax_assets', '递延所得税资产', [{ code: '1811' }])
  const otherNonCurrentAssetRow = buildRow('other_noncurrent_assets', '其他非流动资产', [
    { code: '1611' },
    { code: '1821' }
  ])
  const totalNonCurrentAssetsRow = buildSumRow('total_noncurrent_assets', '非流动资产合计', [
    debtInvestmentRow,
    otherDebtInvestmentRow,
    longTermReceivableRow,
    longTermEquityInvestmentRow,
    otherEquityInvestmentRow,
    otherNonCurrentFinancialAssetRow,
    investmentPropertyRow,
    fixedAssetRow,
    constructionRow,
    biologicalAssetRow,
    oilGasRow,
    rightOfUseRow,
    intangibleRow,
    developmentRow,
    goodwillRow,
    longDeferredExpenseRow,
    deferredTaxAssetRow,
    otherNonCurrentAssetRow
  ])
  const totalAssetsRow = buildSumRow('total_assets', '资产总计', [
    totalCurrentAssetsRow,
    totalNonCurrentAssetsRow
  ])

  const shortTermLoanRow = buildRow('short_term_loans', '短期借款', [{ code: '2001' }])
  const tradingLiabilityRow = buildRow('trading_liabilities', '交易性金融负债', [{ code: '2101' }])
  const derivativeLiabilityRow = buildRow('derivative_liabilities', '衍生金融负债', [
    { code: '3101', sign: -1 }
  ])
  const notesPayableRow = buildRow('notes_payable', '应付票据', [{ code: '2201' }])
  const accountsPayableRow = buildRow('accounts_payable', '应付账款', [{ code: '2202' }])
  const advanceReceiptRow = buildRow('advance_receipts', '预收款项', [{ code: '2203' }])
  const contractLiabilityRow = buildRow('contract_liabilities', '合同负债', [])
  const payrollRow = buildRow('employee_compensation', '应付职工薪酬', [{ code: '2211' }])
  const taxesRow = buildRow('taxes_payable', '应交税费', [{ code: '2221' }])
  const otherPayableRow = buildRow('other_payables', '其他应付款', [
    { code: '2231' },
    { code: '2232' },
    { code: '2241' }
  ])
  const heldForSaleLiabilityRow = buildRow('held_for_sale_liabilities', '持有待售负债', [])
  const oneYearNonCurrentLiabilityRow = buildRow(
    'one_year_noncurrent_liabilities',
    '一年内到期的非流动负债',
    []
  )
  const otherCurrentLiabilityRow = buildRow('other_current_liabilities', '其他流动负债', [
    { code: '2002' },
    { code: '2003' },
    { code: '2004' },
    { code: '2011' },
    { code: '2012' },
    { code: '2021' },
    { code: '2251' },
    { code: '2261' },
    { code: '2311' },
    { code: '2312' },
    { code: '2313' },
    { code: '2314' }
  ])
  const totalCurrentLiabilitiesRow = buildSumRow('total_current_liabilities', '流动负债合计', [
    shortTermLoanRow,
    tradingLiabilityRow,
    derivativeLiabilityRow,
    notesPayableRow,
    accountsPayableRow,
    advanceReceiptRow,
    contractLiabilityRow,
    payrollRow,
    taxesRow,
    otherPayableRow,
    heldForSaleLiabilityRow,
    oneYearNonCurrentLiabilityRow,
    otherCurrentLiabilityRow
  ])

  const longTermLoanRow = buildRow('long_term_loans', '长期借款', [{ code: '2501' }])
  const bondsPayableRow = buildRow('bonds_payable', '应付债券', [{ code: '2502' }])
  const preferredShareRow = buildRow('preferred_share', '  其中：优先股', [])
  const perpetualBondRow = buildRow('perpetual_bond', '  永续债', [])
  const leaseLiabilityRow = buildRow('lease_liability', '租赁负债', [])
  const longTermPayableRow = buildRow('long_term_payables', '长期应付款', [
    { code: '2701' },
    { code: '2702', sign: -1 }
  ])
  const estimatedLiabilityRow = buildRow('estimated_liabilities', '预计负债', [{ code: '2801' }])
  const deferredIncomeRow = buildRow('deferred_income', '递延收益', [{ code: '2401' }])
  const deferredTaxLiabilityRow = buildRow('deferred_tax_liabilities', '递延所得税负债', [
    { code: '2901' }
  ])
  const otherNonCurrentLiabilityRow = buildRow('other_noncurrent_liabilities', '其他非流动负债', [
    { code: '2601' },
    { code: '2602' },
    { code: '2611' },
    { code: '2621' },
    { code: '2711' }
  ])
  const totalNonCurrentLiabilitiesRow = buildSumRow(
    'total_noncurrent_liabilities',
    '非流动负债合计',
    [
      longTermLoanRow,
      bondsPayableRow,
      leaseLiabilityRow,
      longTermPayableRow,
      estimatedLiabilityRow,
      deferredIncomeRow,
      deferredTaxLiabilityRow,
      otherNonCurrentLiabilityRow
    ]
  )
  const totalLiabilitiesRow = buildSumRow('total_liabilities', '负债合计', [
    totalCurrentLiabilitiesRow,
    totalNonCurrentLiabilitiesRow
  ])

  const paidInCapitalRow = createEnterpriseComparableRow(
    'paid_in_capital',
    '实收资本（或股本）',
    '',
    priorYearEndEquityState.paidInCapital,
    currentEquityState.paidInCapital
  )
  const otherEquityInstrumentRow = createEnterpriseComparableRow(
    'other_equity_instruments',
    '其他权益工具',
    '',
    priorYearEndEquityState.otherEquityInstruments,
    currentEquityState.otherEquityInstruments
  )
  const otherPreferredShareRow = createEnterpriseComparableRow(
    'other_equity_preferred',
    '  其中：优先股',
    '',
    priorYearEndEquityState.preferredShares,
    currentEquityState.preferredShares
  )
  const otherPerpetualBondRow = createEnterpriseComparableRow(
    'other_equity_perpetual',
    '  永续债',
    '',
    priorYearEndEquityState.perpetualBonds,
    currentEquityState.perpetualBonds
  )
  const capitalReserveRow = createEnterpriseComparableRow(
    'capital_reserve',
    '资本公积',
    '',
    priorYearEndEquityState.capitalReserve,
    currentEquityState.capitalReserve
  )
  const treasuryStockRow = createEnterpriseComparableRow(
    'treasury_stock',
    '减：库存股',
    '',
    priorYearEndEquityState.treasuryStock,
    currentEquityState.treasuryStock
  )
  const ociRow = createEnterpriseComparableRow(
    'other_comprehensive_income',
    '其他综合收益',
    '',
    priorYearEndEquityState.otherComprehensiveIncome,
    currentEquityState.otherComprehensiveIncome
  )
  const specialReserveRow = createEnterpriseComparableRow(
    'special_reserve',
    '专项储备',
    '',
    priorYearEndEquityState.specialReserve,
    currentEquityState.specialReserve
  )
  const surplusReserveRow = createEnterpriseComparableRow(
    'surplus_reserve',
    '盈余公积',
    '',
    priorYearEndEquityState.surplusReserve,
    currentEquityState.surplusReserve
  )
  const undistributedProfitRow = createEnterpriseComparableRow(
    'undistributed_profit',
    '未分配利润',
    '',
    priorYearEndEquityState.undistributedProfit,
    currentEquityState.undistributedProfit
  )
  const totalEquityRow = createEnterpriseComparableRow(
    'total_equity',
    '所有者权益（或股东权益）合计',
    '',
    priorYearEndEquityState.totalEquity,
    currentEquityState.totalEquity
  )
  const totalLiabilitiesAndEquityRow = buildSumRow(
    'total_liabilities_equity',
    '负债和所有者权益（或股东权益）总计',
    [totalLiabilitiesRow, totalEquityRow]
  )

  const assetSectionRows = [
    cashRow,
    tradingAssetRow,
    derivativeAssetRow,
    notesReceivableRow,
    accountsReceivableRow,
    receivablesFinancingRow,
    prepaymentRow,
    contractAssetRow,
    otherReceivableRow,
    inventoryRow,
    heldForSaleAssetRow,
    oneYearNonCurrentAssetRow,
    otherCurrentAssetRow,
    totalCurrentAssetsRow,
    debtInvestmentRow,
    otherDebtInvestmentRow,
    longTermReceivableRow,
    longTermEquityInvestmentRow,
    otherEquityInvestmentRow,
    otherNonCurrentFinancialAssetRow,
    investmentPropertyRow,
    fixedAssetRow,
    constructionRow,
    biologicalAssetRow,
    oilGasRow,
    rightOfUseRow,
    intangibleRow,
    developmentRow,
    goodwillRow,
    longDeferredExpenseRow,
    deferredTaxAssetRow,
    otherNonCurrentAssetRow,
    totalNonCurrentAssetsRow,
    totalAssetsRow
  ]
  const liabilityEquitySectionRows = [
    shortTermLoanRow,
    tradingLiabilityRow,
    derivativeLiabilityRow,
    notesPayableRow,
    accountsPayableRow,
    advanceReceiptRow,
    contractLiabilityRow,
    payrollRow,
    taxesRow,
    otherPayableRow,
    heldForSaleLiabilityRow,
    oneYearNonCurrentLiabilityRow,
    otherCurrentLiabilityRow,
    totalCurrentLiabilitiesRow,
    longTermLoanRow,
    bondsPayableRow,
    preferredShareRow,
    perpetualBondRow,
    leaseLiabilityRow,
    longTermPayableRow,
    estimatedLiabilityRow,
    deferredIncomeRow,
    deferredTaxLiabilityRow,
    otherNonCurrentLiabilityRow,
    totalNonCurrentLiabilitiesRow,
    totalLiabilitiesRow,
    paidInCapitalRow,
    otherEquityInstrumentRow,
    otherPreferredShareRow,
    otherPerpetualBondRow,
    capitalReserveRow,
    treasuryStockRow,
    ociRow,
    specialReserveRow,
    surplusReserveRow,
    undistributedProfitRow,
    totalEquityRow,
    totalLiabilitiesAndEquityRow
  ]

  const amountCellsForRow = (row?: ReportSnapshotLine): ReportSnapshotTableCell[] =>
    row?.cells
      ? [createAmountCell(row.cells.ending ?? 0), createAmountCell(row.cells.prior_year_end ?? 0)]
      : [createTextCell(''), createTextCell('')]

  const pairRow = (
    key: string,
    left: ReportSnapshotLine | undefined,
    right: ReportSnapshotLine | undefined
  ): ReportSnapshotTableRow => ({
    key,
    cells: [
      createTextCell(left?.label ?? ''),
      ...amountCellsForRow(left),
      createTextCell(right?.label ?? ''),
      ...amountCellsForRow(right)
    ]
  })

  const officialRows: ReportSnapshotTableRow[] = [
    pairRow(
      'bs-1',
      headingRow('asset-current', '一、流动资产：'),
      headingRow('liability-current', '一、流动负债：')
    ),
    pairRow('bs-2', cashRow, shortTermLoanRow),
    pairRow('bs-3', tradingAssetRow, tradingLiabilityRow),
    pairRow('bs-4', derivativeAssetRow, derivativeLiabilityRow),
    pairRow('bs-5', notesReceivableRow, notesPayableRow),
    pairRow('bs-6', accountsReceivableRow, accountsPayableRow),
    pairRow('bs-7', receivablesFinancingRow, advanceReceiptRow),
    pairRow('bs-8', prepaymentRow, contractLiabilityRow),
    pairRow('bs-9', contractAssetRow, payrollRow),
    pairRow('bs-10', otherReceivableRow, taxesRow),
    pairRow('bs-11', inventoryRow, otherPayableRow),
    pairRow('bs-12', heldForSaleAssetRow, heldForSaleLiabilityRow),
    pairRow('bs-13', oneYearNonCurrentAssetRow, oneYearNonCurrentLiabilityRow),
    pairRow('bs-14', otherCurrentAssetRow, otherCurrentLiabilityRow),
    pairRow('bs-15', totalCurrentAssetsRow, totalCurrentLiabilitiesRow),
    pairRow(
      'bs-16',
      headingRow('asset-noncurrent', '二、非流动资产：'),
      headingRow('liability-noncurrent', '二、非流动负债：')
    ),
    pairRow('bs-17', debtInvestmentRow, longTermLoanRow),
    pairRow('bs-18', otherDebtInvestmentRow, bondsPayableRow),
    pairRow('bs-19', longTermReceivableRow, preferredShareRow),
    pairRow('bs-20', longTermEquityInvestmentRow, perpetualBondRow),
    pairRow('bs-21', otherEquityInvestmentRow, leaseLiabilityRow),
    pairRow('bs-22', otherNonCurrentFinancialAssetRow, longTermPayableRow),
    pairRow('bs-23', investmentPropertyRow, estimatedLiabilityRow),
    pairRow('bs-24', fixedAssetRow, deferredIncomeRow),
    pairRow('bs-25', constructionRow, deferredTaxLiabilityRow),
    pairRow('bs-26', biologicalAssetRow, otherNonCurrentLiabilityRow),
    pairRow('bs-27', oilGasRow, totalNonCurrentLiabilitiesRow),
    pairRow('bs-28', rightOfUseRow, totalLiabilitiesRow),
    pairRow('bs-29', intangibleRow, headingRow('equity-heading', '三、所有者权益（或股东权益）：')),
    pairRow('bs-30', developmentRow, paidInCapitalRow),
    pairRow('bs-31', goodwillRow, otherEquityInstrumentRow),
    pairRow('bs-32', longDeferredExpenseRow, otherPreferredShareRow),
    pairRow('bs-33', deferredTaxAssetRow, otherPerpetualBondRow),
    pairRow('bs-34', otherNonCurrentAssetRow, capitalReserveRow),
    pairRow('bs-35', totalNonCurrentAssetsRow, treasuryStockRow),
    pairRow('bs-36', totalAssetsRow, ociRow),
    pairRow('bs-37', undefined, specialReserveRow),
    pairRow('bs-38', undefined, surplusReserveRow),
    pairRow('bs-39', undefined, undistributedProfitRow),
    pairRow('bs-40', undefined, totalEquityRow),
    pairRow('bs-41', undefined, totalLiabilitiesAndEquityRow)
  ]

  return {
    title: BALANCE_SHEET_TITLE,
    reportType: 'balance_sheet',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企01表',
    tables: [
      {
        key: 'enterprise-balance-sheet',
        columns: [
          { key: 'left_label', label: '资产' },
          { key: 'left_ending', label: '期末余额' },
          { key: 'left_prior', label: '上年年末余额' },
          { key: 'right_label', label: '负债和所有者权益（或股东权益）' },
          { key: 'right_ending', label: '期末余额' },
          { key: 'right_prior', label: '上年年末余额' }
        ],
        rows: officialRows
      }
    ],
    sections: [
      { key: 'assets', title: '资产', rows: assetSectionRows },
      { key: 'liabilities_equity', title: '负债和所有者权益', rows: liabilityEquitySectionRows }
    ],
    totals: [
      { key: 'assets', label: '资产总计', amountCents: totalAssetsRow.amountCents },
      { key: 'liabilities', label: '负债合计', amountCents: totalLiabilitiesRow.amountCents },
      { key: 'equity', label: '所有者权益合计', amountCents: totalEquityRow.amountCents }
    ]
  }
}

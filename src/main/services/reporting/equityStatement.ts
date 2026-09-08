import type Database from 'better-sqlite3'
import type {
  EquityColumnState,
  ReportSnapshotTableCell,
  LedgerRow,
  ReportSnapshotScope,
  ReportSnapshotContent,
  EnterpriseProfitStatementAmounts,
  ReportSnapshotTableRow
} from './types'
import {
  createAmountCell,
  listSubjects,
  getPreviousPeriod,
  shiftPeriod,
  listEffectiveEntries,
  getPeriodStartDate,
  getPeriodEndDate,
  createTextCell,
  EQUITY_STATEMENT_TITLE
} from './common'
import {
  buildEnterpriseEquityState,
  buildEnterpriseBalancePoint,
  buildEnterpriseProfitAmounts
} from './enterpriseCalculations'

function equityStateToCells(values: EquityColumnState): ReportSnapshotTableCell[] {
  return [
    createAmountCell(values.paidInCapital),
    createAmountCell(values.otherEquityInstruments),
    createAmountCell(values.preferredShares),
    createAmountCell(values.perpetualBonds),
    createAmountCell(values.otherEquityInstrumentsOther),
    createAmountCell(values.capitalReserve),
    createAmountCell(values.treasuryStock),
    createAmountCell(values.otherComprehensiveIncome),
    createAmountCell(values.specialReserve),
    createAmountCell(values.surplusReserve),
    createAmountCell(values.generalRiskReserve),
    createAmountCell(values.undistributedProfit),
    createAmountCell(values.totalEquity)
  ]
}

function subtractEquityStates(
  left: EquityColumnState,
  right: EquityColumnState
): EquityColumnState {
  return {
    paidInCapital: left.paidInCapital - right.paidInCapital,
    otherEquityInstruments: left.otherEquityInstruments - right.otherEquityInstruments,
    preferredShares: left.preferredShares - right.preferredShares,
    perpetualBonds: left.perpetualBonds - right.perpetualBonds,
    otherEquityInstrumentsOther:
      left.otherEquityInstrumentsOther - right.otherEquityInstrumentsOther,
    capitalReserve: left.capitalReserve - right.capitalReserve,
    treasuryStock: left.treasuryStock - right.treasuryStock,
    otherComprehensiveIncome: left.otherComprehensiveIncome - right.otherComprehensiveIncome,
    specialReserve: left.specialReserve - right.specialReserve,
    surplusReserve: left.surplusReserve - right.surplusReserve,
    generalRiskReserve: left.generalRiskReserve - right.generalRiskReserve,
    undistributedProfit: left.undistributedProfit - right.undistributedProfit,
    totalEquity: left.totalEquity - right.totalEquity
  }
}

function emptyEquityState(): EquityColumnState {
  return {
    paidInCapital: 0,
    otherEquityInstruments: 0,
    preferredShares: 0,
    perpetualBonds: 0,
    otherEquityInstrumentsOther: 0,
    capitalReserve: 0,
    treasuryStock: 0,
    otherComprehensiveIncome: 0,
    specialReserve: 0,
    surplusReserve: 0,
    generalRiskReserve: 0,
    undistributedProfit: 0,
    totalEquity: 0
  }
}

export function buildEnterpriseEquityStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const currentOpening = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      getPreviousPeriod(scope.startPeriod),
      scope.includeUnpostedVouchers
    )
  )
  const currentEnding = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      scope.endPeriod,
      scope.includeUnpostedVouchers
    )
  )
  const priorOpening = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      getPreviousPeriod(shiftPeriod(scope.startPeriod, -1)),
      scope.includeUnpostedVouchers
    )
  )
  const priorEnding = buildEnterpriseEquityState(
    buildEnterpriseBalancePoint(
      db,
      ledger,
      subjects,
      shiftPeriod(scope.endPeriod, -1),
      scope.includeUnpostedVouchers
    )
  )
  const currentChanges = subtractEquityStates(currentEnding, currentOpening)
  const priorChanges = subtractEquityStates(priorEnding, priorOpening)
  const currentProfit = buildEnterpriseProfitAmounts(
    listEffectiveEntries(
      db,
      ledger.id,
      scope.startDate,
      scope.endDate,
      scope.includeUnpostedVouchers
    )
  )
  const priorProfit = buildEnterpriseProfitAmounts(
    listEffectiveEntries(
      db,
      ledger.id,
      getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
      getPeriodEndDate(shiftPeriod(scope.endPeriod, -1)),
      scope.includeUnpostedVouchers
    )
  )

  const contributionState = (changes: EquityColumnState): EquityColumnState => ({
    ...emptyEquityState(),
    paidInCapital: changes.paidInCapital,
    otherEquityInstruments: changes.otherEquityInstruments,
    preferredShares: changes.preferredShares,
    perpetualBonds: changes.perpetualBonds,
    otherEquityInstrumentsOther: changes.otherEquityInstrumentsOther,
    capitalReserve: changes.capitalReserve,
    treasuryStock: changes.treasuryStock,
    totalEquity:
      changes.paidInCapital +
      changes.otherEquityInstruments +
      changes.preferredShares +
      changes.perpetualBonds +
      changes.otherEquityInstrumentsOther +
      changes.capitalReserve -
      changes.treasuryStock
  })
  const profitDistributionState = (changes: EquityColumnState): EquityColumnState => ({
    ...emptyEquityState(),
    surplusReserve: changes.surplusReserve,
    generalRiskReserve: changes.generalRiskReserve,
    totalEquity: changes.surplusReserve + changes.generalRiskReserve
  })
  const comprehensiveState = (profit: EnterpriseProfitStatementAmounts): EquityColumnState => ({
    ...emptyEquityState(),
    otherComprehensiveIncome: profit.otherComprehensiveIncome,
    undistributedProfit: profit.netProfit,
    totalEquity: profit.comprehensiveIncomeTotal
  })
  const currentContribution = contributionState(currentChanges)
  const priorContribution = contributionState(priorChanges)
  const currentDistribution = profitDistributionState(currentChanges)
  const priorDistribution = profitDistributionState(priorChanges)
  const currentComprehensive = comprehensiveState(currentProfit)
  const priorComprehensive = comprehensiveState(priorProfit)
  const currentResidual = subtractEquityStates(
    subtractEquityStates(
      subtractEquityStates(currentChanges, currentComprehensive),
      currentContribution
    ),
    currentDistribution
  )
  const priorResidual = subtractEquityStates(
    subtractEquityStates(subtractEquityStates(priorChanges, priorComprehensive), priorContribution),
    priorDistribution
  )
  const zero = emptyEquityState()
  const blockHeadingRow = (key: string, label: string): ReportSnapshotTableRow => ({
    key,
    cells: [createTextCell(label), ...Array.from({ length: 13 }, () => createTextCell(''))]
  })
  const stateRow = (
    key: string,
    label: string,
    values: EquityColumnState
  ): ReportSnapshotTableRow => ({
    key,
    cells: [createTextCell(label), ...equityStateToCells(values)]
  })

  const buildBlockRows = (
    prefix: 'current' | 'prior',
    opening: EquityColumnState,
    changes: EquityColumnState,
    comprehensive: EquityColumnState,
    contribution: EquityColumnState,
    distribution: EquityColumnState,
    residual: EquityColumnState,
    ending: EquityColumnState
  ): ReportSnapshotTableRow[] => [
    blockHeadingRow(`${prefix}-block-heading`, prefix === 'current' ? '本年金额' : '上年金额'),
    stateRow(`${prefix}-last-year-end`, '一、上年年末余额', opening),
    stateRow(`${prefix}-policy-change`, '加：会计政策变更', zero),
    stateRow(`${prefix}-error-correction`, '前期差错更正', zero),
    stateRow(`${prefix}-other-adjustments`, '其他', zero),
    stateRow(`${prefix}-beginning`, '二、本年年初余额', opening),
    stateRow(`${prefix}-total-change`, '三、本年增减变动金额（减少以“-”号填列）', changes),
    stateRow(`${prefix}-comprehensive`, '（一）综合收益总额', comprehensive),
    stateRow(`${prefix}-capital-change`, '（二）所有者投入和减少资本', contribution),
    stateRow(`${prefix}-ordinary-share`, '1．所有者投入的普通股', {
      ...zero,
      paidInCapital: contribution.paidInCapital,
      totalEquity: contribution.paidInCapital
    }),
    stateRow(`${prefix}-other-equity`, '2．其他权益工具持有者投入资本', {
      ...zero,
      otherEquityInstruments: contribution.otherEquityInstruments,
      preferredShares: contribution.preferredShares,
      perpetualBonds: contribution.perpetualBonds,
      otherEquityInstrumentsOther: contribution.otherEquityInstrumentsOther,
      totalEquity:
        contribution.otherEquityInstruments +
        contribution.preferredShares +
        contribution.perpetualBonds +
        contribution.otherEquityInstrumentsOther
    }),
    stateRow(`${prefix}-share-payment`, '3．股份支付计入所有者权益的金额', {
      ...zero,
      capitalReserve: contribution.capitalReserve,
      totalEquity: contribution.capitalReserve
    }),
    stateRow(`${prefix}-capital-other`, '4．其他', {
      ...zero,
      treasuryStock: contribution.treasuryStock,
      totalEquity: -contribution.treasuryStock
    }),
    stateRow(`${prefix}-profit-distribution`, '（三）利润分配', distribution),
    stateRow(`${prefix}-surplus`, '1．提取盈余公积', {
      ...zero,
      surplusReserve: distribution.surplusReserve,
      totalEquity: distribution.surplusReserve
    }),
    stateRow(`${prefix}-risk-reserve`, '2．提取一般风险准备', {
      ...zero,
      generalRiskReserve: distribution.generalRiskReserve,
      totalEquity: distribution.generalRiskReserve
    }),
    stateRow(`${prefix}-owner-distribution`, '3．对所有者（或股东）的分配', zero),
    stateRow(`${prefix}-profit-other`, '4．其他', zero),
    stateRow(`${prefix}-internal-carry`, '（四）所有者权益内部结转', residual),
    stateRow(`${prefix}-capital-reserve-transfer`, '1．资本公积转增资本（或股本）', zero),
    stateRow(`${prefix}-surplus-transfer`, '2．盈余公积转增资本（或股本）', zero),
    stateRow(`${prefix}-surplus-offset`, '3．盈余公积弥补亏损', zero),
    stateRow(`${prefix}-benefit-plan`, '4．设定受益计划变动额结转留存收益', zero),
    stateRow(`${prefix}-oci-carry`, '5．其他综合收益结转留存收益', {
      ...zero,
      otherComprehensiveIncome: residual.otherComprehensiveIncome,
      undistributedProfit: residual.undistributedProfit,
      totalEquity: residual.otherComprehensiveIncome + residual.undistributedProfit
    }),
    stateRow(`${prefix}-internal-other`, '6．其他', residual),
    stateRow(`${prefix}-ending`, '四、本年年末余额', ending)
  ]

  return {
    title: EQUITY_STATEMENT_TITLE,
    reportType: 'equity_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企04表',
    tables: [
      {
        key: 'enterprise-equity-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'paid_in_capital', label: '实收资本（或股本）' },
          { key: 'other_equity_instruments', label: '其他权益工具' },
          { key: 'preferred_shares', label: '优先股' },
          { key: 'perpetual_bonds', label: '永续债' },
          { key: 'other_equity_instruments_other', label: '其他' },
          { key: 'capital_reserve', label: '资本公积' },
          { key: 'treasury_stock', label: '减：库存股' },
          { key: 'other_comprehensive_income', label: '其他综合收益' },
          { key: 'special_reserve', label: '专项储备' },
          { key: 'surplus_reserve', label: '盈余公积' },
          { key: 'general_risk_reserve', label: '一般风险准备' },
          { key: 'undistributed_profit', label: '未分配利润' },
          { key: 'total_equity', label: '所有者权益合计' }
        ],
        rows: [
          ...buildBlockRows(
            'current',
            currentOpening,
            currentChanges,
            currentComprehensive,
            currentContribution,
            currentDistribution,
            currentResidual,
            currentEnding
          ),
          ...buildBlockRows(
            'prior',
            priorOpening,
            priorChanges,
            priorComprehensive,
            priorContribution,
            priorDistribution,
            priorResidual,
            priorEnding
          )
        ]
      }
    ],
    sections: [],
    totals: [
      {
        key: 'current_total_equity',
        label: '本年年末所有者权益合计',
        amountCents: currentEnding.totalEquity
      },
      {
        key: 'prior_total_equity',
        label: '上年年末所有者权益合计',
        amountCents: priorEnding.totalEquity
      }
    ]
  }
}

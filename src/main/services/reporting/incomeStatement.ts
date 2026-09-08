import type Database from 'better-sqlite3'
import type {
  LedgerRow,
  ReportSnapshotScope,
  ReportSnapshotContent,
  ReportSnapshotTableRow
} from './types'
import {
  listEffectiveEntries,
  getPeriodStartDate,
  shiftPeriod,
  getPeriodEndDate,
  createEnterpriseMovementRow
} from './common'
import {
  buildEnterpriseProfitAmounts
} from './enterpriseCalculations'

export function buildProfitLossSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string,
  title: string
): ReportSnapshotContent {
  const currentEntries = listEffectiveEntries(
    db,
    ledger.id,
    scope.startDate,
    scope.endDate,
    scope.includeUnpostedVouchers
  )
  const previousEntries = listEffectiveEntries(
    db,
    ledger.id,
    getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
    getPeriodEndDate(shiftPeriod(scope.endPeriod, -1)),
    scope.includeUnpostedVouchers
  )

  const current = buildEnterpriseProfitAmounts(currentEntries)
  const previous = buildEnterpriseProfitAmounts(previousEntries)

  const rows: ReportSnapshotTableRow[] = [
    createEnterpriseMovementRow(
      'operating_revenue',
      '一、营业收入',
      current.operatingRevenue,
      previous.operatingRevenue
    ),
    createEnterpriseMovementRow(
      'operating_cost',
      '减：营业成本',
      current.operatingCost,
      previous.operatingCost
    ),
    createEnterpriseMovementRow(
      'taxes_and_surcharges',
      '税金及附加',
      current.taxesAndSurcharges,
      previous.taxesAndSurcharges
    ),
    createEnterpriseMovementRow(
      'selling_expenses',
      '销售费用',
      current.sellingExpenses,
      previous.sellingExpenses
    ),
    createEnterpriseMovementRow(
      'administrative_expenses',
      '管理费用',
      current.administrativeExpenses,
      previous.administrativeExpenses
    ),
    createEnterpriseMovementRow(
      'research_expenses',
      '研发费用',
      current.researchExpenses,
      previous.researchExpenses
    ),
    createEnterpriseMovementRow(
      'finance_expenses',
      '财务费用',
      current.financeExpenses,
      previous.financeExpenses
    ),
    createEnterpriseMovementRow(
      'interest_expenses',
      '  其中：利息费用',
      current.interestExpenses,
      previous.interestExpenses
    ),
    createEnterpriseMovementRow(
      'interest_income',
      '  利息收入',
      current.interestIncome,
      previous.interestIncome
    ),
    createEnterpriseMovementRow(
      'other_income',
      '加：其他收益',
      current.otherIncome,
      previous.otherIncome
    ),
    createEnterpriseMovementRow(
      'investment_income',
      '投资收益（损失以“-”号填列）',
      current.investmentIncome,
      previous.investmentIncome
    ),
    createEnterpriseMovementRow(
      'associate_investment_income',
      '  其中：对联营企业和合营企业的投资收益',
      current.associateInvestmentIncome,
      previous.associateInvestmentIncome
    ),
    createEnterpriseMovementRow(
      'derecognition_gain',
      '以摊余成本计量的金融资产终止确认收益',
      current.derecognitionGain,
      previous.derecognitionGain
    ),
    createEnterpriseMovementRow(
      'hedge_gain',
      '净敞口套期收益',
      current.hedgeGain,
      previous.hedgeGain
    ),
    createEnterpriseMovementRow(
      'fair_value_gain',
      '公允价值变动收益',
      current.fairValueChangeGain,
      previous.fairValueChangeGain
    ),
    createEnterpriseMovementRow(
      'credit_impairment_loss',
      '信用减值损失',
      current.creditImpairmentLoss,
      previous.creditImpairmentLoss
    ),
    createEnterpriseMovementRow(
      'asset_impairment_loss',
      '资产减值损失',
      current.assetImpairmentLoss,
      previous.assetImpairmentLoss
    ),
    createEnterpriseMovementRow(
      'asset_disposal_gain',
      '资产处置收益',
      current.assetDisposalGain,
      previous.assetDisposalGain
    ),
    createEnterpriseMovementRow(
      'operating_profit',
      '二、营业利润（亏损以“-”号填列）',
      current.operatingProfit,
      previous.operatingProfit
    ),
    createEnterpriseMovementRow(
      'non_operating_income',
      '加：营业外收入',
      current.nonOperatingIncome,
      previous.nonOperatingIncome
    ),
    createEnterpriseMovementRow(
      'non_operating_expense',
      '减：营业外支出',
      current.nonOperatingExpense,
      previous.nonOperatingExpense
    ),
    createEnterpriseMovementRow(
      'total_profit',
      '三、利润总额（亏损总额以“-”号填列）',
      current.totalProfit,
      previous.totalProfit
    ),
    createEnterpriseMovementRow(
      'income_tax',
      '减：所得税费用',
      current.incomeTaxExpense,
      previous.incomeTaxExpense
    ),
    createEnterpriseMovementRow(
      'net_profit',
      '四、净利润（净亏损以“-”号填列）',
      current.netProfit,
      previous.netProfit
    ),
    createEnterpriseMovementRow(
      'going_concern_profit',
      '  （一）持续经营净利润',
      current.netProfit,
      previous.netProfit
    ),
    createEnterpriseMovementRow('discontinued_profit', '  （二）终止经营净利润', 0, 0),
    createEnterpriseMovementRow(
      'other_comprehensive_income',
      '五、其他综合收益的税后净额',
      current.otherComprehensiveIncome,
      previous.otherComprehensiveIncome
    ),
    createEnterpriseMovementRow(
      'other_comprehensive_nonreclass',
      '  （一）不能重分类进损益的其他综合收益',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'other_comprehensive_reclass',
      '  （二）将重分类进损益的其他综合收益',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'comprehensive_income_total',
      '六、综合收益总额',
      current.comprehensiveIncomeTotal,
      previous.comprehensiveIncomeTotal
    ),
    createEnterpriseMovementRow('earnings_per_share_header', '七、每股收益：', 0, 0),
    createEnterpriseMovementRow('basic_eps', '  （一）基本每股收益', 0, 0),
    createEnterpriseMovementRow('diluted_eps', '  （二）稀释每股收益', 0, 0)
  ]

  return {
    title,
    reportType: 'income_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企02表',
    tables: [
      {
        key: 'enterprise-income-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本期金额' },
          { key: 'previous', label: '上期金额' }
        ],
        rows
      }
    ],
    sections: [],
    totals: [
      { key: 'operating_revenue', label: '营业收入', amountCents: current.operatingRevenue },
      { key: 'operating_cost', label: '营业成本', amountCents: current.operatingCost },
      { key: 'net_profit', label: '净利润', amountCents: current.netProfit }
    ]
  }
}

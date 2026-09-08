import type Database from 'better-sqlite3'
import {
  isCarryForwardSourceCategory
} from '../../database/subjectCategoryRules'
import type {
  LedgerRow,
  SubjectRow,
  EnterpriseBalancePoint,
  EntryWithVoucher,
  EnterpriseProfitStatementAmounts,
  EquityColumnState
} from './types'
import {
  getEffectiveLedgerStartPeriod,
  listInitialBalances,
  getPeriodEndDate,
  groupEntriesBySubject,
  listEffectiveEntries,
  getPeriodStartDate,
  buildSubjectBalanceMap,
  sumEntriesByPrefixSpecs,
  sumTemplateAmount
} from './common'

const ENTERPRISE_CASH_SUBJECT_PREFIXES = ['1001', '1002', '1012']

export function buildEnterpriseBalancePoint(
  db: Database.Database,
  ledger: LedgerRow,
  subjects: SubjectRow[],
  targetPeriod: string,
  includeUnpostedVouchers: boolean
): EnterpriseBalancePoint {
  const effectiveLedgerStartPeriod = getEffectiveLedgerStartPeriod(ledger, targetPeriod)
  const openingBySubject = listInitialBalances(db, ledger.id, targetPeriod)
  const targetDate = getPeriodEndDate(targetPeriod)
  const entriesBySubject = groupEntriesBySubject(
    listEffectiveEntries(
      db,
      ledger.id,
      getPeriodStartDate(effectiveLedgerStartPeriod),
      targetDate,
      includeUnpostedVouchers
    )
  )
  const balanceMap = buildSubjectBalanceMap(
    subjects,
    openingBySubject,
    entriesBySubject,
    effectiveLedgerStartPeriod,
    targetDate
  )
  const unsettledProfitLossNet = subjects
    .filter((subject) => isCarryForwardSourceCategory(ledger.standard_type, subject.category))
    .reduce((sum, subject) => {
      const amount = balanceMap.get(subject.code) ?? 0
      return sum + (subject.balance_direction === -1 ? amount : -amount)
    }, 0)

  return {
    balanceMap,
    unsettledProfitLossNet
  }
}

export function buildEnterpriseProfitAmounts(
  entries: EntryWithVoucher[]
): EnterpriseProfitStatementAmounts {
  const operatingRevenue = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6001' }, { code: '6021' }, { code: '6031' }, { code: '6041' }, { code: '6051' }],
    'credit_minus_debit'
  )
  const operatingCost = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6401' }, { code: '6402' }],
    'debit_minus_credit'
  )
  const taxesAndSurcharges = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6403' }],
    'debit_minus_credit'
  )
  const sellingExpenses = sumEntriesByPrefixSpecs(entries, [{ code: '6601' }], 'debit_minus_credit')
  const administrativeExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6602' }],
    'debit_minus_credit'
  )
  const researchExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '5301' }],
    'debit_minus_credit'
  )
  const financeExpenses = sumEntriesByPrefixSpecs(entries, [{ code: '6603' }], 'debit_minus_credit')
  const interestExpenses = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6411' }],
    'debit_minus_credit'
  )
  const interestIncome = sumEntriesByPrefixSpecs(entries, [{ code: '6011' }], 'credit_minus_debit')
  const otherIncome = 0
  const investmentIncome = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6111' }],
    'credit_minus_debit'
  )
  const associateInvestmentIncome = 0
  const derecognitionGain = 0
  const hedgeGain = 0
  const fairValueChangeGain = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6101' }],
    'credit_minus_debit'
  )
  const creditImpairmentLoss = 0
  const assetImpairmentLoss = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6701' }],
    'debit_minus_credit'
  )
  const assetDisposalGain = 0
  const nonOperatingIncome = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6301' }],
    'credit_minus_debit'
  )
  const nonOperatingExpense = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6711' }],
    'debit_minus_credit'
  )
  const incomeTaxExpense = sumEntriesByPrefixSpecs(
    entries,
    [{ code: '6801' }],
    'debit_minus_credit'
  )
  const otherComprehensiveIncome = 0

  const operatingProfit =
    operatingRevenue -
    operatingCost -
    taxesAndSurcharges -
    sellingExpenses -
    administrativeExpenses -
    researchExpenses -
    financeExpenses +
    otherIncome +
    investmentIncome +
    associateInvestmentIncome +
    derecognitionGain +
    hedgeGain +
    fairValueChangeGain -
    creditImpairmentLoss -
    assetImpairmentLoss +
    assetDisposalGain
  const totalProfit = operatingProfit + nonOperatingIncome - nonOperatingExpense
  const netProfit = totalProfit - incomeTaxExpense
  const comprehensiveIncomeTotal = netProfit + otherComprehensiveIncome

  return {
    operatingRevenue,
    operatingCost,
    taxesAndSurcharges,
    sellingExpenses,
    administrativeExpenses,
    researchExpenses,
    financeExpenses,
    interestExpenses,
    interestIncome,
    otherIncome,
    investmentIncome,
    associateInvestmentIncome,
    derecognitionGain,
    hedgeGain,
    fairValueChangeGain,
    creditImpairmentLoss,
    assetImpairmentLoss,
    assetDisposalGain,
    nonOperatingIncome,
    nonOperatingExpense,
    incomeTaxExpense,
    otherComprehensiveIncome,
    operatingProfit,
    totalProfit,
    netProfit,
    comprehensiveIncomeTotal
  }
}

export function buildEnterpriseEquityState(point: EnterpriseBalancePoint): EquityColumnState {
  const paidInCapital = sumTemplateAmount(point.balanceMap, [{ code: '4001' }])
  const capitalReserve = sumTemplateAmount(point.balanceMap, [{ code: '4002' }])
  const treasuryStock = sumTemplateAmount(point.balanceMap, [{ code: '4201' }])
  const surplusReserve = sumTemplateAmount(point.balanceMap, [{ code: '4101' }])
  const generalRiskReserve = sumTemplateAmount(point.balanceMap, [{ code: '4102' }])
  const undistributedProfit =
    sumTemplateAmount(point.balanceMap, [{ code: '4103' }, { code: '4104' }]) +
    point.unsettledProfitLossNet
  const otherComprehensiveIncome = 0
  const otherEquityInstruments = 0
  const preferredShares = 0
  const perpetualBonds = 0
  const otherEquityInstrumentsOther = 0
  const specialReserve = 0
  const totalEquity =
    paidInCapital +
    capitalReserve +
    otherComprehensiveIncome +
    specialReserve +
    surplusReserve +
    generalRiskReserve +
    undistributedProfit -
    treasuryStock

  return {
    paidInCapital,
    otherEquityInstruments,
    preferredShares,
    perpetualBonds,
    otherEquityInstrumentsOther,
    capitalReserve,
    treasuryStock,
    otherComprehensiveIncome,
    specialReserve,
    surplusReserve,
    generalRiskReserve,
    undistributedProfit,
    totalEquity
  }
}

export function buildCashBalanceAtPeriodEnd(
  db: Database.Database,
  ledger: LedgerRow,
  subjects: SubjectRow[],
  targetPeriod: string,
  includeUnpostedVouchers: boolean
): number {
  const point = buildEnterpriseBalancePoint(
    db,
    ledger,
    subjects,
    targetPeriod,
    includeUnpostedVouchers
  )
  return sumTemplateAmount(
    point.balanceMap,
    ENTERPRISE_CASH_SUBJECT_PREFIXES.map((code) => ({ code }))
  )
}

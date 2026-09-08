import type Database from 'better-sqlite3'
import type {
  LedgerRow,
  ReportSnapshotScope,
  ReportSnapshotContent,
  EntryWithVoucher,
  ReportSnapshotTableRow
} from './types'
import {
  listCashFlowItems,
  selectEffectiveVouchers,
  listVouchersInDateRange,
  mergeEntriesWithVouchers,
  listVoucherEntriesByVoucherIds,
  getPeriodStartDate,
  shiftPeriod,
  getPeriodEndDate,
  createTextCell,
  createAmountCell,
  CASHFLOW_STATEMENT_TITLE,
  listSubjects,
  listEffectiveEntries,
  addAmount,
  getPreviousPeriod,
  createEnterpriseMovementRow
} from './common'
import {
  buildCashBalanceAtPeriodEnd
} from './enterpriseCalculations'

export function buildNgoCashFlowStatementSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const currentItems = listCashFlowItems(db, ledger.id)
  const currentVouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, scope.startDate, scope.endDate),
    scope.includeUnpostedVouchers
  )
  const currentEntries = mergeEntriesWithVouchers(
    currentVouchers,
    listVoucherEntriesByVoucherIds(
      db,
      currentVouchers.map((voucher) => voucher.id)
    )
  )

  const previousScope = {
    startDate: getPeriodStartDate(shiftPeriod(scope.startPeriod, -1)),
    endDate: getPeriodEndDate(shiftPeriod(scope.endPeriod, -1))
  }
  const previousVouchers = selectEffectiveVouchers(
    listVouchersInDateRange(db, ledger.id, previousScope.startDate, previousScope.endDate),
    scope.includeUnpostedVouchers
  )
  const previousEntries = mergeEntriesWithVouchers(
    previousVouchers,
    listVoucherEntriesByVoucherIds(
      db,
      previousVouchers.map((voucher) => voucher.id)
    )
  )

  type NgoCashflowRule = {
    label: string
    counterpartPrefixes?: string[]
    cashFlowCodes?: string[]
    cashFlowNames?: string[]
  }

  const operatingInRules: NgoCashflowRule[] = [
    { label: '接受捐赠收到的现金', counterpartPrefixes: ['4101'] },
    { label: '收取会费收到的现金', counterpartPrefixes: ['4201'] },
    {
      label: '提供服务收到的现金',
      counterpartPrefixes: ['4301'],
      cashFlowCodes: ['CF01'],
      cashFlowNames: ['提供服务收到的现金']
    },
    {
      label: '销售商品收到的现金',
      counterpartPrefixes: ['4501'],
      cashFlowCodes: ['CF01'],
      cashFlowNames: ['销售商品收到的现金']
    },
    { label: '政府补助收到的现金', counterpartPrefixes: ['4401'] },
    {
      label: '收到的其他与业务活动有关的现金',
      counterpartPrefixes: ['4601', '4701', '4901'],
      cashFlowCodes: ['CF03'],
      cashFlowNames: ['收到的其他与业务活动有关的现金', '收到其他与经营活动有关的现金']
    }
  ]
  const operatingOutRules: NgoCashflowRule[] = [
    { label: '提供捐赠或者资助支付的现金', counterpartPrefixes: ['5101'] },
    {
      label: '支付给员工以及为员工支付的现金',
      counterpartPrefixes: ['2204'],
      cashFlowCodes: ['CF05'],
      cashFlowNames: ['支付给员工以及为员工支付的现金', '支付给职工以及为职工支付的现金']
    },
    {
      label: '购买商品、接受服务支付的现金',
      counterpartPrefixes: ['2202', '1141'],
      cashFlowCodes: ['CF04'],
      cashFlowNames: ['购买商品、接受服务支付的现金', '购买商品、接受劳务支付的现金']
    },
    {
      label: '各项税费支付的现金',
      counterpartPrefixes: ['2206'],
      cashFlowCodes: ['CF06'],
      cashFlowNames: ['各项税费支付的现金', '支付的各项税费']
    },
    {
      label: '支付的其他与业务活动有关的现金',
      counterpartPrefixes: ['2209', '2301', '5201', '5301', '5401', '5501', '5601', '5901'],
      cashFlowCodes: ['CF07'],
      cashFlowNames: ['支付的其他与业务活动有关的现金', '支付其他与经营活动有关的现金']
    }
  ]
  const investingInRules: NgoCashflowRule[] = [
    {
      label: '收回投资所收到的现金',
      cashFlowCodes: ['CF08'],
      cashFlowNames: ['收回投资所收到的现金', '收回投资收到的现金']
    },
    {
      label: '取得投资收益所收到的现金',
      cashFlowCodes: ['CF09'],
      cashFlowNames: ['取得投资收益所收到的现金', '取得投资收益收到的现金']
    },
    {
      label: '处置固定资产、无形资产和其他非流动资产收回的现金',
      cashFlowCodes: ['CF10'],
      cashFlowNames: [
        '处置固定资产、无形资产和其他非流动资产收回的现金',
        '处置固定资产等长期资产收回的现金净额'
      ]
    },
    {
      label: '收到的其他与投资活动有关的现金',
      cashFlowCodes: ['CF11'],
      cashFlowNames: ['收到的其他与投资活动有关的现金', '收到其他与投资活动有关的现金']
    }
  ]
  const investingOutRules: NgoCashflowRule[] = [
    {
      label: '购建固定资产、无形资产和其他非流动资产支付的现金',
      cashFlowCodes: ['CF12'],
      cashFlowNames: [
        '购建固定资产、无形资产和其他非流动资产支付的现金',
        '购建固定资产等长期资产支付的现金'
      ]
    },
    {
      label: '对外投资所支付的现金',
      cashFlowCodes: ['CF13'],
      cashFlowNames: ['对外投资所支付的现金', '投资支付的现金']
    },
    {
      label: '支付的其他与投资活动有关的现金',
      cashFlowCodes: ['CF14'],
      cashFlowNames: ['支付的其他与投资活动有关的现金', '支付其他与投资活动有关的现金']
    }
  ]
  const financingInRules: NgoCashflowRule[] = [
    {
      label: '借款所收到的现金',
      cashFlowCodes: ['CF16'],
      cashFlowNames: ['借款所收到的现金', '取得借款收到的现金']
    },
    {
      label: '收到的其他与筹资活动有关的现金',
      cashFlowCodes: ['CF17'],
      cashFlowNames: ['收到的其他与筹资活动有关的现金', '收到其他与筹资活动有关的现金']
    }
  ]
  const financingOutRules: NgoCashflowRule[] = [
    {
      label: '偿还借款所支付的现金',
      cashFlowCodes: ['CF18'],
      cashFlowNames: ['偿还借款所支付的现金', '偿还债务支付的现金']
    },
    {
      label: '偿付利息所支付的现金',
      cashFlowCodes: ['CF19'],
      cashFlowNames: ['偿付利息所支付的现金', '分配股利、利润或偿付利息支付的现金']
    },
    {
      label: '支付的其他与筹资活动有关的现金',
      cashFlowCodes: ['CF20'],
      cashFlowNames: ['支付的其他与筹资活动有关的现金', '支付其他与筹资活动有关的现金']
    }
  ]
  const allRules = [
    ...operatingInRules,
    ...operatingOutRules,
    ...investingInRules,
    ...investingOutRules,
    ...financingInRules,
    ...financingOutRules
  ]

  const matchesCounterpartPrefix = (subjectCode: string, prefix: string): boolean =>
    subjectCode === prefix || subjectCode.startsWith(prefix)

  const buildCashflowAmountMap = (entries: EntryWithVoucher[]): Map<string, number> => {
    const amountByLabel = new Map(allRules.map((rule) => [rule.label, 0]))
    const itemById = new Map(currentItems.map((item) => [item.id, item]))
    const entriesByVoucherId = new Map<number, EntryWithVoucher[]>()

    for (const entry of entries) {
      const current = entriesByVoucherId.get(entry.voucher_id) ?? []
      current.push(entry)
      entriesByVoucherId.set(entry.voucher_id, current)
    }

    for (const entry of entries) {
      if (entry.cash_flow_item_id === null) {
        continue
      }

      const item = itemById.get(entry.cash_flow_item_id)
      if (!item) {
        continue
      }

      const counterpartEntries = (entriesByVoucherId.get(entry.voucher_id) ?? []).filter(
        (candidate) => candidate.id !== entry.id && candidate.cash_flow_item_id === null
      )
      const counterpartCodes = counterpartEntries.map((candidate) => candidate.subject_code)

      const matchedByCounterpart = allRules.find((rule) =>
        (rule.counterpartPrefixes ?? []).some((prefix) =>
          counterpartCodes.some((subjectCode) => matchesCounterpartPrefix(subjectCode, prefix))
        )
      )
      const matchedRule =
        matchedByCounterpart ??
        allRules.find(
          (rule) =>
            (rule.cashFlowCodes ?? []).includes(item.code) ||
            (rule.cashFlowNames ?? []).includes(item.name)
        )

      if (!matchedRule) {
        continue
      }

      const amount = entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount
      amountByLabel.set(matchedRule.label, (amountByLabel.get(matchedRule.label) ?? 0) + amount)
    }

    return amountByLabel
  }

  const currentAmountByLabel = buildCashflowAmountMap(currentEntries)
  const previousAmountByLabel = buildCashflowAmountMap(previousEntries)

  const line = (
    label: string,
    currentAmount: number,
    previousAmount: number
  ): ReportSnapshotTableRow => ({
    key: label,
    cells: [
      createTextCell(label),
      createAmountCell(currentAmount),
      createAmountCell(previousAmount)
    ]
  })

  const currentByName = (label: string): number => currentAmountByLabel.get(label) ?? 0
  const previousByName = (label: string): number => previousAmountByLabel.get(label) ?? 0

  const operatingInRows = [
    '接受捐赠收到的现金',
    '收取会费收到的现金',
    '提供服务收到的现金',
    '销售商品收到的现金',
    '政府补助收到的现金',
    '收到的其他与业务活动有关的现金'
  ]
  const operatingOutRows = [
    '提供捐赠或者资助支付的现金',
    '支付给员工以及为员工支付的现金',
    '购买商品、接受服务支付的现金',
    '各项税费支付的现金',
    '支付的其他与业务活动有关的现金'
  ]
  const investingInRows = [
    '收回投资所收到的现金',
    '取得投资收益所收到的现金',
    '处置固定资产、无形资产和其他非流动资产收回的现金',
    '收到的其他与投资活动有关的现金'
  ]
  const investingOutRows = [
    '购建固定资产、无形资产和其他非流动资产支付的现金',
    '对外投资所支付的现金',
    '支付的其他与投资活动有关的现金'
  ]
  const financingInRows = ['借款所收到的现金', '收到的其他与筹资活动有关的现金']
  const financingOutRows = [
    '偿还借款所支付的现金',
    '偿付利息所支付的现金',
    '支付的其他与筹资活动有关的现金'
  ]

  const sumLabels = (labels: string[], picker: (label: string) => number): number =>
    labels.reduce((sum, label) => sum + picker(label), 0)

  const currentOperatingIn = sumLabels(operatingInRows, currentByName)
  const currentOperatingOut = sumLabels(operatingOutRows, currentByName)
  const previousOperatingIn = sumLabels(operatingInRows, previousByName)
  const previousOperatingOut = sumLabels(operatingOutRows, previousByName)

  const currentInvestingIn = sumLabels(investingInRows, currentByName)
  const currentInvestingOut = sumLabels(investingOutRows, currentByName)
  const previousInvestingIn = sumLabels(investingInRows, previousByName)
  const previousInvestingOut = sumLabels(investingOutRows, previousByName)

  const currentFinancingIn = sumLabels(financingInRows, currentByName)
  const currentFinancingOut = sumLabels(financingOutRows, currentByName)
  const previousFinancingIn = sumLabels(financingInRows, previousByName)
  const previousFinancingOut = sumLabels(financingOutRows, previousByName)

  const tableRows: ReportSnapshotTableRow[] = [
    line('一、业务活动产生的现金流量：', 0, 0),
    ...operatingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentOperatingIn, previousOperatingIn),
    ...operatingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentOperatingOut, previousOperatingOut),
    line(
      '业务活动产生的现金流量净额',
      currentOperatingIn - currentOperatingOut,
      previousOperatingIn - previousOperatingOut
    ),
    line('二、投资活动产生的现金流量：', 0, 0),
    ...investingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentInvestingIn, previousInvestingIn),
    ...investingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentInvestingOut, previousInvestingOut),
    line(
      '投资活动产生的现金流量净额',
      currentInvestingIn - currentInvestingOut,
      previousInvestingIn - previousInvestingOut
    ),
    line('三、筹资活动产生的现金流量：', 0, 0),
    ...financingInRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流入小计', currentFinancingIn, previousFinancingIn),
    ...financingOutRows.map((label) => line(label, currentByName(label), previousByName(label))),
    line('现金流出小计', currentFinancingOut, previousFinancingOut),
    line(
      '筹资活动产生的现金流量净额',
      currentFinancingIn - currentFinancingOut,
      previousFinancingIn - previousFinancingOut
    ),
    line('四、汇率变动对现金的影响额', 0, 0),
    line(
      '五、现金及现金等价物净增加额',
      currentOperatingIn -
        currentOperatingOut +
        (currentInvestingIn - currentInvestingOut) +
        (currentFinancingIn - currentFinancingOut),
      previousOperatingIn -
        previousOperatingOut +
        (previousInvestingIn - previousInvestingOut) +
        (previousFinancingIn - previousFinancingOut)
    )
  ]

  return {
    title: CASHFLOW_STATEMENT_TITLE,
    reportType: 'cashflow_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会民非03表',
    tables: [
      {
        key: 'ngo-cashflow-statement',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本年金额' },
          { key: 'previous', label: '上年金额' }
        ],
        rows: tableRows
      }
    ],
    sections: [],
    totals: [
      {
        key: 'net_cash_flow',
        label: '现金及现金等价物净增加额',
        amountCents:
          typeof tableRows[tableRows.length - 1].cells[1].value === 'number'
            ? Number(tableRows[tableRows.length - 1].cells[1].value)
            : 0
      }
    ]
  }
}

export function buildCashFlowSnapshot(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  generatedAt: string
): ReportSnapshotContent {
  const subjects = listSubjects(db, ledger.id)
  const currentItems = listCashFlowItems(db, ledger.id)
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

  const buildAmountByCode = (entries: EntryWithVoucher[]): Map<string, number> => {
    const amountByCode = new Map<string, number>()
    const itemById = new Map(currentItems.map((item) => [item.id, item]))
    for (const entry of entries) {
      if (entry.cash_flow_item_id === null) {
        continue
      }
      const item = itemById.get(entry.cash_flow_item_id)
      if (!item) {
        continue
      }
      addAmount(
        amountByCode,
        item.code,
        entry.debit_amount > 0 ? entry.debit_amount : entry.credit_amount
      )
    }
    return amountByCode
  }

  const currentByCode = buildAmountByCode(currentEntries)
  const previousByCode = buildAmountByCode(previousEntries)
  const amountBy = (map: Map<string, number>, code: string): number => map.get(code) ?? 0

  const currentOperatingIn =
    amountBy(currentByCode, 'CF01') +
    amountBy(currentByCode, 'CF02') +
    amountBy(currentByCode, 'CF03')
  const previousOperatingIn =
    amountBy(previousByCode, 'CF01') +
    amountBy(previousByCode, 'CF02') +
    amountBy(previousByCode, 'CF03')
  const currentOperatingOut =
    amountBy(currentByCode, 'CF04') +
    amountBy(currentByCode, 'CF05') +
    amountBy(currentByCode, 'CF06') +
    amountBy(currentByCode, 'CF07')
  const previousOperatingOut =
    amountBy(previousByCode, 'CF04') +
    amountBy(previousByCode, 'CF05') +
    amountBy(previousByCode, 'CF06') +
    amountBy(previousByCode, 'CF07')
  const currentInvestingIn =
    amountBy(currentByCode, 'CF08') +
    amountBy(currentByCode, 'CF09') +
    amountBy(currentByCode, 'CF10') +
    amountBy(currentByCode, 'CF11')
  const previousInvestingIn =
    amountBy(previousByCode, 'CF08') +
    amountBy(previousByCode, 'CF09') +
    amountBy(previousByCode, 'CF10') +
    amountBy(previousByCode, 'CF11')
  const currentInvestingOut =
    amountBy(currentByCode, 'CF12') +
    amountBy(currentByCode, 'CF13') +
    amountBy(currentByCode, 'CF14')
  const previousInvestingOut =
    amountBy(previousByCode, 'CF12') +
    amountBy(previousByCode, 'CF13') +
    amountBy(previousByCode, 'CF14')
  const currentFinancingIn =
    amountBy(currentByCode, 'CF15') +
    amountBy(currentByCode, 'CF16') +
    amountBy(currentByCode, 'CF17')
  const previousFinancingIn =
    amountBy(previousByCode, 'CF15') +
    amountBy(previousByCode, 'CF16') +
    amountBy(previousByCode, 'CF17')
  const currentFinancingOut =
    amountBy(currentByCode, 'CF18') +
    amountBy(currentByCode, 'CF19') +
    amountBy(currentByCode, 'CF20')
  const previousFinancingOut =
    amountBy(previousByCode, 'CF18') +
    amountBy(previousByCode, 'CF19') +
    amountBy(previousByCode, 'CF20')

  const currentBeginningCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    getPreviousPeriod(scope.startPeriod),
    scope.includeUnpostedVouchers
  )
  const previousBeginningCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    getPreviousPeriod(shiftPeriod(scope.startPeriod, -1)),
    scope.includeUnpostedVouchers
  )
  const currentEndingCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    scope.endPeriod,
    scope.includeUnpostedVouchers
  )
  const previousEndingCash = buildCashBalanceAtPeriodEnd(
    db,
    ledger,
    subjects,
    shiftPeriod(scope.endPeriod, -1),
    scope.includeUnpostedVouchers
  )
  const currentNetCash =
    currentOperatingIn -
    currentOperatingOut +
    (currentInvestingIn - currentInvestingOut) +
    (currentFinancingIn - currentFinancingOut)
  const previousNetCash =
    previousOperatingIn -
    previousOperatingOut +
    (previousInvestingIn - previousInvestingOut) +
    (previousFinancingIn - previousFinancingOut)

  const rows: ReportSnapshotTableRow[] = [
    createEnterpriseMovementRow('operating_header', '一、经营活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf01',
      '销售商品、提供劳务收到的现金',
      amountBy(currentByCode, 'CF01'),
      amountBy(previousByCode, 'CF01')
    ),
    createEnterpriseMovementRow(
      'cf02',
      '收到的税费返还',
      amountBy(currentByCode, 'CF02'),
      amountBy(previousByCode, 'CF02')
    ),
    createEnterpriseMovementRow(
      'cf03',
      '收到其他与经营活动有关的现金',
      amountBy(currentByCode, 'CF03'),
      amountBy(previousByCode, 'CF03')
    ),
    createEnterpriseMovementRow(
      'operating_in',
      '经营活动现金流入小计',
      currentOperatingIn,
      previousOperatingIn
    ),
    createEnterpriseMovementRow(
      'cf04',
      '购买商品、接受劳务支付的现金',
      amountBy(currentByCode, 'CF04'),
      amountBy(previousByCode, 'CF04')
    ),
    createEnterpriseMovementRow(
      'cf05',
      '支付给职工以及为职工支付的现金',
      amountBy(currentByCode, 'CF05'),
      amountBy(previousByCode, 'CF05')
    ),
    createEnterpriseMovementRow(
      'cf06',
      '支付的各项税费',
      amountBy(currentByCode, 'CF06'),
      amountBy(previousByCode, 'CF06')
    ),
    createEnterpriseMovementRow(
      'cf07',
      '支付其他与经营活动有关的现金',
      amountBy(currentByCode, 'CF07'),
      amountBy(previousByCode, 'CF07')
    ),
    createEnterpriseMovementRow(
      'operating_out',
      '经营活动现金流出小计',
      currentOperatingOut,
      previousOperatingOut
    ),
    createEnterpriseMovementRow(
      'operating_net',
      '经营活动产生的现金流量净额',
      currentOperatingIn - currentOperatingOut,
      previousOperatingIn - previousOperatingOut
    ),
    createEnterpriseMovementRow('investing_header', '二、投资活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf08',
      '收回投资收到的现金',
      amountBy(currentByCode, 'CF08'),
      amountBy(previousByCode, 'CF08')
    ),
    createEnterpriseMovementRow(
      'cf09',
      '取得投资收益收到的现金',
      amountBy(currentByCode, 'CF09'),
      amountBy(previousByCode, 'CF09')
    ),
    createEnterpriseMovementRow(
      'cf10',
      '处置固定资产、无形资产和其他长期资产收回的现金净额',
      amountBy(currentByCode, 'CF10'),
      amountBy(previousByCode, 'CF10')
    ),
    createEnterpriseMovementRow(
      'investing_subsidiary_in',
      '处置子公司及其他营业单位收到的现金净额',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'cf11',
      '收到其他与投资活动有关的现金',
      amountBy(currentByCode, 'CF11'),
      amountBy(previousByCode, 'CF11')
    ),
    createEnterpriseMovementRow(
      'investing_in',
      '投资活动现金流入小计',
      currentInvestingIn,
      previousInvestingIn
    ),
    createEnterpriseMovementRow(
      'cf12',
      '购建固定资产、无形资产和其他长期资产支付的现金',
      amountBy(currentByCode, 'CF12'),
      amountBy(previousByCode, 'CF12')
    ),
    createEnterpriseMovementRow(
      'cf13',
      '投资支付的现金',
      amountBy(currentByCode, 'CF13'),
      amountBy(previousByCode, 'CF13')
    ),
    createEnterpriseMovementRow(
      'investing_subsidiary_out',
      '取得子公司及其他营业单位支付的现金净额',
      0,
      0
    ),
    createEnterpriseMovementRow(
      'cf14',
      '支付其他与投资活动有关的现金',
      amountBy(currentByCode, 'CF14'),
      amountBy(previousByCode, 'CF14')
    ),
    createEnterpriseMovementRow(
      'investing_out',
      '投资活动现金流出小计',
      currentInvestingOut,
      previousInvestingOut
    ),
    createEnterpriseMovementRow(
      'investing_net',
      '投资活动产生的现金流量净额',
      currentInvestingIn - currentInvestingOut,
      previousInvestingIn - previousInvestingOut
    ),
    createEnterpriseMovementRow('financing_header', '三、筹资活动产生的现金流量：', 0, 0),
    createEnterpriseMovementRow(
      'cf15',
      '吸收投资收到的现金',
      amountBy(currentByCode, 'CF15'),
      amountBy(previousByCode, 'CF15')
    ),
    createEnterpriseMovementRow(
      'cf16',
      '取得借款收到的现金',
      amountBy(currentByCode, 'CF16'),
      amountBy(previousByCode, 'CF16')
    ),
    createEnterpriseMovementRow(
      'cf17',
      '收到其他与筹资活动有关的现金',
      amountBy(currentByCode, 'CF17'),
      amountBy(previousByCode, 'CF17')
    ),
    createEnterpriseMovementRow(
      'financing_in',
      '筹资活动现金流入小计',
      currentFinancingIn,
      previousFinancingIn
    ),
    createEnterpriseMovementRow(
      'cf18',
      '偿还债务支付的现金',
      amountBy(currentByCode, 'CF18'),
      amountBy(previousByCode, 'CF18')
    ),
    createEnterpriseMovementRow(
      'cf19',
      '分配股利、利润或偿付利息支付的现金',
      amountBy(currentByCode, 'CF19'),
      amountBy(previousByCode, 'CF19')
    ),
    createEnterpriseMovementRow(
      'cf20',
      '支付其他与筹资活动有关的现金',
      amountBy(currentByCode, 'CF20'),
      amountBy(previousByCode, 'CF20')
    ),
    createEnterpriseMovementRow(
      'financing_out',
      '筹资活动现金流出小计',
      currentFinancingOut,
      previousFinancingOut
    ),
    createEnterpriseMovementRow(
      'financing_net',
      '筹资活动产生的现金流量净额',
      currentFinancingIn - currentFinancingOut,
      previousFinancingIn - previousFinancingOut
    ),
    createEnterpriseMovementRow('exchange_effect', '四、汇率变动对现金及现金等价物的影响', 0, 0),
    createEnterpriseMovementRow(
      'net_cash',
      '五、现金及现金等价物净增加额',
      currentNetCash,
      previousNetCash
    ),
    createEnterpriseMovementRow(
      'beginning_cash',
      '加：期初现金及现金等价物余额',
      currentBeginningCash,
      previousBeginningCash
    ),
    createEnterpriseMovementRow(
      'ending_cash',
      '六、期末现金及现金等价物余额',
      currentEndingCash,
      previousEndingCash
    )
  ]

  return {
    title: CASHFLOW_STATEMENT_TITLE,
    reportType: 'cashflow_statement',
    period: scope.periodLabel,
    ledgerName: ledger.name,
    standardType: ledger.standard_type,
    generatedAt,
    scope,
    formCode: '会企03表',
    tables: [
      {
        key: 'enterprise-cashflow-statement',
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
      {
        key: 'operating_net',
        label: '经营活动现金流量净额',
        amountCents: currentOperatingIn - currentOperatingOut
      },
      {
        key: 'investing_net',
        label: '投资活动现金流量净额',
        amountCents: currentInvestingIn - currentInvestingOut
      },
      {
        key: 'financing_net',
        label: '筹资活动现金流量净额',
        amountCents: currentFinancingIn - currentFinancingOut
      },
      { key: 'net_cash_flow', label: '现金及现金等价物净增加额', amountCents: currentNetCash }
    ]
  }
}

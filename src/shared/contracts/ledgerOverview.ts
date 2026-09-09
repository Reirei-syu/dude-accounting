export interface LedgerYearOverviewQuery {
  ledgerId: number
  year: number
}

export interface LedgerYearOverview {
  ledger: {
    id: number
    name: string
    standard_type: 'enterprise' | 'npo'
    start_period: string
    current_period: string
  }
  year: number
  months: Array<{
    period: string
    status: 'not_started' | 'open' | 'closed'
    voucherCount: number
  }>
}

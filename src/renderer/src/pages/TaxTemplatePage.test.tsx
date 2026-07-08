import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaxTemplatePage from './TaxTemplatePage'

const ledger = {
  id: 5,
  name: '上海静安千千结婚恋服务中心',
  standard_type: 'npo' as const,
  taxpayer_identification_number: '91310000TEST001',
  start_period: '2026-01',
  current_period: '2026-06',
  created_at: '2026-01-01 00:00:00'
}

const ledgerStoreState = {
  ledgers: [ledger],
  currentLedger: ledger,
  currentPeriod: '2026-06',
  setLedgers: vi.fn(),
  setCurrentLedger: vi.fn()
}

vi.mock('../stores/ledgerStore', () => ({
  useLedgerStore: () => ledgerStoreState
}))

describe('TaxTemplatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders taxpayer identification number as an editable field', () => {
    const html = renderToStaticMarkup(<TaxTemplatePage title="税务模板" />)
    const match = html.match(/<input[^>]+name="taxpayerIdentificationNumber"[^>]*>/)

    expect(match?.[0]).toBeDefined()
    expect(match?.[0]).not.toContain('disabled')
    expect(match?.[0]).not.toContain('readOnly')
    expect(match?.[0]).toContain('value="91310000TEST001"')
  })
})

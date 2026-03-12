import { describe, expect, it } from 'vitest'
import * as ledgerStore from './ledgerStore'

describe('ledger preference helpers', () => {
  it('picks the preferred ledger when it is still accessible and falls back to the first ledger otherwise', () => {
    const pickInitialLedger = (
      ledgerStore as unknown as {
        pickInitialLedger?: (
          ledgers: Array<{
            id: number
            name: string
            standard_type: 'enterprise' | 'npo'
            start_period: string
            current_period: string
            created_at: string
          }>,
          preferredLedgerId?: number | null
        ) => {
          id: number
          name: string
          standard_type: 'enterprise' | 'npo'
          start_period: string
          current_period: string
          created_at: string
        } | null
      }
    ).pickInitialLedger

    expect(typeof pickInitialLedger).toBe('function')

    const ledgers = [
      {
        id: 11,
        name: '账套 A',
        standard_type: 'enterprise' as const,
        start_period: '2026-01',
        current_period: '2026-03',
        created_at: '2026-03-12T00:00:00.000Z'
      },
      {
        id: 12,
        name: '账套 B',
        standard_type: 'enterprise' as const,
        start_period: '2026-01',
        current_period: '2026-03',
        created_at: '2026-03-12T00:00:00.000Z'
      }
    ]

    expect(pickInitialLedger?.(ledgers, 12)?.id).toBe(12)
    expect(pickInitialLedger?.(ledgers, 99)?.id).toBe(11)
    expect(pickInitialLedger?.([], 12)).toBeNull()
  })
})

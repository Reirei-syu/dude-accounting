import { create } from 'zustand'

interface Ledger {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  created_at: string
}

interface LedgerState {
  ledgers: Ledger[]
  currentLedger: Ledger | null
  currentPeriod: string
  setLedgers: (ledgers: Ledger[]) => void
  setCurrentLedger: (ledger: Ledger | null) => void
  setCurrentPeriod: (period: string) => void
}

export const useLedgerStore = create<LedgerState>((set) => ({
  ledgers: [],
  currentLedger: null,
  currentPeriod: '',
  setLedgers: (ledgers) => set({ ledgers }),
  setCurrentLedger: (ledger) =>
    set({ currentLedger: ledger, currentPeriod: ledger?.current_period || '' }),
  setCurrentPeriod: (period) => set({ currentPeriod: period })
}))

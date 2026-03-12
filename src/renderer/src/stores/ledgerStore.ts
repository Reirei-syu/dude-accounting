import { create } from 'zustand'

export interface Ledger {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  created_at: string
}

export function pickInitialLedger(
  ledgers: Ledger[],
  preferredLedgerId?: number | null
): Ledger | null {
  if (ledgers.length === 0) {
    return null
  }
  if (typeof preferredLedgerId === 'number') {
    const matched = ledgers.find((ledger) => ledger.id === preferredLedgerId)
    if (matched) {
      return matched
    }
  }
  return ledgers[0]
}

interface LedgerState {
  ledgers: Ledger[]
  currentLedger: Ledger | null
  currentPeriod: string
  setLedgers: (ledgers: Ledger[]) => void
  setCurrentLedger: (ledger: Ledger | null) => void
  setCurrentPeriod: (period: string) => void
  updateCurrentLedgerPeriod: (period: string) => void
  reset: () => void
}

export const useLedgerStore = create<LedgerState>((set) => ({
  ledgers: [],
  currentLedger: null,
  currentPeriod: '',
  setLedgers: (ledgers) => set({ ledgers }),
  setCurrentLedger: (ledger) =>
    set({ currentLedger: ledger, currentPeriod: ledger?.current_period || '' }),
  setCurrentPeriod: (period) => set({ currentPeriod: period }),
  updateCurrentLedgerPeriod: (period) =>
    set((state) => {
      if (!state.currentLedger) {
        return { currentPeriod: period }
      }

      const currentLedger = { ...state.currentLedger, current_period: period }
      return {
        currentPeriod: period,
        currentLedger,
        ledgers: state.ledgers.map((ledger) =>
          ledger.id === currentLedger.id ? { ...ledger, current_period: period } : ledger
        )
      }
    }),
  reset: () =>
    set({
      ledgers: [],
      currentLedger: null,
      currentPeriod: ''
    })
}))

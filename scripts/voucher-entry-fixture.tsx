import { createRoot } from 'react-dom/client'
import { useEffect, type JSX } from 'react'
import VoucherEntry from '../src/renderer/src/pages/VoucherEntry'
import { useVoucherEntryController } from '../src/renderer/src/pages/voucher-entry/useVoucherEntryController'
import type {
  VoucherEntryProps,
  VoucherListItem
} from '../src/renderer/src/pages/voucher-entry/voucherEntryModel'
import { useLedgerStore } from '../src/renderer/src/stores/ledgerStore'
import '../src/renderer/src/assets/main.css'

const subjects = [
  {
    id: 1,
    code: '1001',
    name: '库存现金',
    parent_code: null,
    category: 'asset',
    level: 1,
    is_cash_flow: 1
  },
  {
    id: 2,
    code: '1002',
    name: '银行存款',
    parent_code: null,
    category: 'asset',
    level: 1,
    is_cash_flow: 1
  }
]
const calls: unknown[] = []
let failSave = false
let deferSave = false
const pendingSaves: Array<() => void> = []
let vouchers: VoucherListItem[] = []
let closed = false
let deferEntries = false
const pendingEntries = new Map<number, () => void>()
const entriesFor = (id: number): unknown[] => [
  {
    id: id * 2,
    voucher_id: id,
    row_order: 1,
    summary: `凭证${id}`,
    subject_code: '1001',
    subject_name: '库存现金',
    debit_amount: 1234,
    credit_amount: 0,
    cash_flow_item_id: null
  },
  {
    id: id * 2 + 1,
    voucher_id: id,
    row_order: 2,
    summary: `凭证${id}`,
    subject_code: '1002',
    subject_name: '银行存款',
    debit_amount: 0,
    credit_amount: 1234,
    cash_flow_item_id: null
  }
]
const save = async (
  payload: unknown
): Promise<{ success: boolean; error?: string; voucherNumber?: number }> => {
  calls.push(payload)
  if (deferSave) await new Promise<void>((resolve) => pendingSaves.push(resolve))
  return failSave
    ? { success: false, error: '隔离测试保存失败' }
    : { success: true, voucherNumber: 1 }
}
const fakeApi = {
  subject: { getAll: async () => subjects },
  cashflow: { getItems: async () => [{ id: 1, code: '01', name: '测试现金流项目' }] },
  settings: { getRuntimeDefaults: async () => ({}), getUserPreferences: async () => ({}) },
  period: { getStatus: async () => ({ is_closed: closed ? 1 : 0 }) },
  voucher: {
    list: async () => vouchers,
    getEntries: async (id: number) => {
      if (deferEntries) await new Promise<void>((resolve) => pendingEntries.set(id, resolve))
      return entriesFor(id)
    },
    getNextNumber: async () => 1,
    save,
    update: save
  }
}
Object.assign(window, {
  api: fakeApi,
  electron: {},
  fixture: {
    calls,
    switchPeriod: (period: string) => useLedgerStore.getState().updateCurrentLedgerPeriod(period),
    pendingSaves,
    pendingEntries,
    setDeferredSave: (value: boolean) => {
      deferSave = value
    },
    setDeferredEntries: (value: boolean) => {
      deferEntries = value
    },
    setVouchers: (value: VoucherListItem[]) => {
      vouchers = value
    },
    setClosed: (value: boolean) => {
      closed = value
    },
    render: (props: VoucherEntryProps = {}) => root.render(<VoucherEntry {...props} />),
    probe: (props: VoucherEntryProps = {}) => root.render(<ControllerProbe {...props} />),
    unmount: () => root.render(null),
    failSave: (value: boolean) => {
      failSave = value
    },
    switchLedger: (id: number) =>
      useLedgerStore.getState().setCurrentLedger({
        id,
        name: `测试账套${id}`,
        standard_type: 'npo',
        current_period: '2026-09',
        start_period: '2026-09',
        created_at: '',
        taxpayer_identification_number: ''
      })
  }
})
useLedgerStore.getState().setCurrentLedger({
  id: 1,
  name: '测试账套1',
  standard_type: 'npo',
  current_period: '2026-09',
  start_period: '2026-09',
  created_at: '',
  taxpayer_identification_number: ''
})
export function ControllerProbe(props: VoucherEntryProps): JSX.Element {
  const controller = useVoucherEntryController(props)
  useEffect(() => {
    Object.assign(window, { fixtureController: controller })
  })
  return <div>controller 隔离测试</div>
}

const root = createRoot(document.getElementById('root')!)
root.render(<VoucherEntry />)

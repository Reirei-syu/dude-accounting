import type { JSX } from 'react'
import type { VoucherEntryController } from './useVoucherEntryController'

type Props = Pick<
  VoucherEntryController,
  | 'canEditFields'
  | 'cashFlowCandidateRows'
  | 'currentLedger'
  | 'date'
  | 'handleDateChange'
  | 'handleDateInputKeyDown'
  | 'loadingVoucher'
  | 'openCashFlowDialog'
  | 'periodDateRange'
  | 'voucherNumber'
>

export default function VoucherEntryHeader({
  canEditFields,
  cashFlowCandidateRows,
  currentLedger,
  date,
  handleDateChange,
  handleDateInputKeyDown,
  loadingVoucher,
  openCashFlowDialog,
  periodDateRange,
  voucherNumber
}: Props): JSX.Element {
  return (
    <>
      <div
        className="flex justify-between items-center mb-2 px-2 gap-2 flex-wrap"
        style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}
      >
        <span>单位：{currentLedger?.name || ''}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="voucher-date-input">日期：</label>
          <input
            id="voucher-date-input"
            type="date"
            className="glass-input px-2 py-1 bg-transparent border-none shadow-none text-sm"
            value={date}
            min={periodDateRange?.min}
            max={periodDateRange?.max}
            onChange={(e) => handleDateChange(e.target.value)}
            onKeyDown={handleDateInputKeyDown}
            disabled={!canEditFields}
          />
        </div>
        <button
          type="button"
          className="glass-btn-secondary text-sm px-3 py-1.5"
          onClick={openCashFlowDialog}
          disabled={loadingVoucher || cashFlowCandidateRows.length === 0}
        >
          现金流量分配
        </button>
        <span>字号：记-{String(voucherNumber).padStart(4, '0')}</span>
      </div>
    </>
  )
}

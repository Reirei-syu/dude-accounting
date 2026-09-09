import type { JSX } from 'react'
import type { VoucherEntryController } from './useVoucherEntryController'
import { CASH_FLOW_DIALOG_GRID_TEMPLATE } from './voucherEntryModel'

type Props = Pick<
  VoucherEntryController,
  | 'applyCashFlowAllocation'
  | 'canEditFields'
  | 'cashFlowCandidateRows'
  | 'cashFlowDialogOpen'
  | 'cashFlowDraft'
  | 'cashFlowItems'
  | 'changeCashFlowDraftItem'
  | 'closeCashFlowDialog'
  | 'toggleCashFlowRow'
>

export default function VoucherCashFlowDialog({
  applyCashFlowAllocation,
  canEditFields,
  cashFlowCandidateRows,
  cashFlowDialogOpen,
  cashFlowDraft,
  cashFlowItems,
  changeCashFlowDraftItem,
  closeCashFlowDialog,
  toggleCashFlowRow
}: Props): JSX.Element {
  return (
    <>
      {cashFlowDialogOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4"
          onClick={() => closeCashFlowDialog()}
        >
          <div
            className="glass-panel w-full max-w-5xl max-h-[80vh] flex flex-col p-4 gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {canEditFields ? '现金流量分配' : '现金流量分配查看'}
              </h3>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                内容过宽时可左右滚动查看
              </span>
              <button
                type="button"
                className="glass-btn-secondary text-sm px-3 py-1.5"
                onClick={() => closeCashFlowDialog()}
              >
                关闭
              </button>
            </div>

            <div
              className="overflow-x-auto overflow-y-auto rounded-md border"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div className="min-w-[1180px]">
                <div
                  className="grid py-2 text-xs font-semibold border-b"
                  style={{
                    gridTemplateColumns: CASH_FLOW_DIALOG_GRID_TEMPLATE,
                    color: 'var(--color-text-secondary)',
                    borderColor: 'var(--color-glass-border-light)'
                  }}
                >
                  <div className="text-center">选择</div>
                  <div className="text-center">行号</div>
                  <div className="px-2">摘要</div>
                  <div className="px-2">会计科目</div>
                  <div className="text-right pr-2">金额</div>
                  <div className="px-2">现金流量项目</div>
                </div>

                {cashFlowCandidateRows.map(({ row, index }) => {
                  const draft = cashFlowDraft[row.id] ?? {
                    selected: false,
                    cashFlowItemId: null
                  }
                  const amount = row.debit || row.credit || '0.00'
                  const direction = row.debit ? '借' : '贷'
                  return (
                    <div
                      key={row.id}
                      className="grid items-center py-2 border-b last:border-b-0"
                      style={{
                        gridTemplateColumns: CASH_FLOW_DIALOG_GRID_TEMPLATE,
                        borderColor: 'var(--color-glass-border-light)'
                      }}
                    >
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          disabled={!canEditFields}
                          onChange={(e) => toggleCashFlowRow(row.id, e.target.checked)}
                          aria-label="cashflow-allocation-row-toggle"
                        />
                      </div>
                      <div
                        className="text-center text-sm"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {index + 1}
                      </div>
                      <div
                        className="px-2 text-sm truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {row.summary || '-'}
                      </div>
                      <div
                        className="px-2 text-sm truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {row.subjectCode} {row.subjectName}
                      </div>
                      <div className="pr-2 text-sm" style={{ color: 'var(--color-text-primary)' }}>
                        <span className="inline-flex w-full items-center justify-end">
                          <span>{direction}</span>
                          <span className="inline-block w-[2ch]" aria-hidden="true" />
                          <span>{amount}</span>
                        </span>
                      </div>
                      <div className="px-2">
                        <select
                          className="glass-input w-full text-sm"
                          value={draft.cashFlowItemId ?? ''}
                          disabled={!canEditFields || !draft.selected}
                          onChange={(e) => changeCashFlowDraftItem(row.id, e.target.value)}
                          aria-label="cashflow-allocation-item-select"
                        >
                          <option value="">选择现金流量项目</option>
                          {cashFlowItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={() => closeCashFlowDialog()}
              >
                {canEditFields ? '取消' : '关闭'}
              </button>
              {canEditFields && (
                <button
                  type="button"
                  className="glass-btn-secondary"
                  onClick={applyCashFlowAllocation}
                >
                  确认分配
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

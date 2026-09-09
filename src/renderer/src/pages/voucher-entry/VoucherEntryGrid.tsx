import type { JSX } from 'react'
import type { VoucherEntryController } from './useVoucherEntryController'
import { renderSubjectIndent, shouldShowPendingCashFlowHint } from './voucherEntryModel'

type Props = Pick<
  VoucherEntryController,
  | 'activeSubjectRowId'
  | 'canEditFields'
  | 'carrySummaryToRow'
  | 'handleKeyDown'
  | 'handleSubjectInput'
  | 'handleSubjectInputKeyDown'
  | 'lastFocusedCellRef'
  | 'openManualSubjectDialog'
  | 'rows'
  | 'selectSubject'
  | 'setActiveSubjectRowId'
  | 'setRef'
  | 'updateAmount'
  | 'subjectHierarchy'
  | 'subjectOptions'
  | 'subjectPathByCode'
  | 'totalCredit'
  | 'totalDebit'
  | 'updateRow'
  | 'updateSubjectOptions'
>

export default function VoucherEntryGrid({
  activeSubjectRowId,
  canEditFields,
  carrySummaryToRow,
  handleKeyDown,
  handleSubjectInput,
  handleSubjectInputKeyDown,
  lastFocusedCellRef,
  openManualSubjectDialog,
  rows,
  selectSubject,
  setActiveSubjectRowId,
  setRef,
  updateAmount,
  subjectHierarchy,
  subjectOptions,
  subjectPathByCode,
  totalCredit,
  totalDebit,
  updateRow,
  updateSubjectOptions
}: Props): JSX.Element {
  return (
    <>
      <div className="glass-panel overflow-auto flex-1 flex flex-col">
        {/* 表头 */}
        <div
          className="grid grid-cols-12 text-center py-3 border-b"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div
            className="col-span-3 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            摘要
          </div>
          <div
            className="col-span-5 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            会计科目
          </div>
          <div
            className="col-span-2 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            借方金额
          </div>
          <div className="col-span-2">贷方金额</div>
        </div>

        {/* 表格行 */}
        <div className="flex-1 overflow-y-auto">
          {rows.map((row, rIdx) => {
            const showAssignedCashFlowHint = row.isCashFlow && row.cashFlowItemId !== null
            const showPendingCashFlowHint = shouldShowPendingCashFlowHint(rows, rIdx, row)
            return (
              <div
                key={row.id}
                className="grid grid-cols-12 border-b group relative"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <div
                  className="col-span-3 border-r"
                  style={{ borderColor: 'var(--color-glass-border-light)' }}
                >
                  <input
                    ref={setRef(rIdx, 0)}
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none transition-colors"
                    value={row.summary}
                    onChange={(e) => updateRow(rIdx, 'summary', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, 0)}
                    onFocus={() => {
                      lastFocusedCellRef.current = { rowIdx: rIdx, colIdx: 0 }
                      carrySummaryToRow(rIdx)
                    }}
                    placeholder="摘要"
                    disabled={!canEditFields}
                    aria-label="voucher-row-summary"
                  />
                </div>
                <div
                  className="col-span-5 border-r relative"
                  style={{ borderColor: 'var(--color-glass-border-light)' }}
                >
                  <input
                    ref={setRef(rIdx, 1)}
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 pr-14 outline-none transition-colors"
                    value={row.subjectInput}
                    onChange={(e) => handleSubjectInput(rIdx, e.target.value)}
                    onKeyDown={(e) => handleSubjectInputKeyDown(e, rIdx)}
                    onFocus={() => {
                      lastFocusedCellRef.current = { rowIdx: rIdx, colIdx: 1 }
                      carrySummaryToRow(rIdx)
                      setActiveSubjectRowId(row.id)
                      if (row.subjectInput.trim()) {
                        updateSubjectOptions(row.id, row.subjectInput)
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setActiveSubjectRowId((prev) => (prev === row.id ? null : prev))
                      }, 100)
                    }}
                    placeholder="输入末级科目代码或名称"
                    disabled={!canEditFields}
                    aria-label="voucher-row-subject"
                    title={row.subjectCode ? (subjectPathByCode.get(row.subjectCode) ?? '') : ''}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold cursor-pointer transition-colors hover:bg-white/95"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.84)',
                      border: '1px solid rgba(148, 163, 184, 0.28)',
                      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
                      color: 'var(--color-text-primary)',
                      backdropFilter: 'blur(10px)'
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openManualSubjectDialog(row.id)}
                    disabled={!canEditFields}
                    aria-label="voucher-row-subject-picker"
                    title="手动选择科目"
                  >
                    +
                  </button>
                  {activeSubjectRowId === row.id && (subjectOptions[row.id] || []).length > 0 && (
                    <div className="absolute z-30 left-0 right-0 top-full mt-1 glass-panel-light max-h-48 overflow-y-auto">
                      {(subjectOptions[row.id] || []).map((subject) => {
                        const subjectLogicalLevel =
                          subjectHierarchy.logicalLevelByCode.get(subject.code) ?? 1
                        const isLeafSubject = !subjectHierarchy.hasChildrenCodes.has(subject.code)

                        return (
                          <button
                            key={subject.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-sm ${
                              isLeafSubject
                                ? 'hover:bg-white/20 cursor-pointer'
                                : 'cursor-not-allowed bg-white/5'
                            }`}
                            style={{
                              color: isLeafSubject
                                ? 'var(--color-text-primary)'
                                : 'var(--color-text-secondary)'
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              if (!isLeafSubject) {
                                return
                              }
                              selectSubject(rIdx, subject, true)
                            }}
                            disabled={!isLeafSubject}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {renderSubjectIndent(subjectLogicalLevel)}
                              <span className="truncate flex-1">
                                {subject.code} {subject.name}
                              </span>
                              <span className="shrink-0 text-[11px]">
                                {isLeafSubject ? '末级' : '上级'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div
                  className="col-span-2 border-r"
                  style={{ borderColor: 'var(--color-glass-border-light)' }}
                >
                  <input
                    ref={setRef(rIdx, 2)}
                    type="text"
                    inputMode="decimal"
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none text-right transition-colors"
                    value={row.debit}
                    onChange={(e) => updateAmount(rIdx, 'debit', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, 2)}
                    onFocus={() => {
                      lastFocusedCellRef.current = { rowIdx: rIdx, colIdx: 2 }
                      carrySummaryToRow(rIdx)
                    }}
                    disabled={!canEditFields}
                    aria-label="voucher-row-debit"
                  />
                </div>
                <div className="col-span-2 relative">
                  <input
                    ref={setRef(rIdx, 3)}
                    type="text"
                    inputMode="decimal"
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none text-right transition-colors"
                    value={row.credit}
                    onChange={(e) => updateAmount(rIdx, 'credit', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, 3)}
                    onFocus={() => {
                      lastFocusedCellRef.current = { rowIdx: rIdx, colIdx: 3 }
                      carrySummaryToRow(rIdx)
                    }}
                    disabled={!canEditFields}
                    aria-label="voucher-row-credit"
                  />
                  {(showAssignedCashFlowHint || showPendingCashFlowHint) && (
                    <span
                      className="absolute left-2 bottom-1 text-[11px] pointer-events-none"
                      style={{
                        color: showAssignedCashFlowHint
                          ? 'var(--color-success)'
                          : 'var(--color-danger)'
                      }}
                    >
                      {showAssignedCashFlowHint ? '已分配现金流' : '待分配现金流'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 合计行 */}
        <div
          className="grid grid-cols-12 text-center py-3 border-t bg-white/5"
          style={{ borderColor: 'var(--color-glass-border)', color: 'var(--color-text-primary)' }}
        >
          <div className="col-span-8 text-right pr-4 font-bold">合计：</div>
          <div
            className="col-span-2 border-r text-right pr-3 font-bold"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            {totalDebit}
          </div>
          <div className="col-span-2 text-right pr-3 font-bold">{totalCredit}</div>
        </div>
      </div>
    </>
  )
}

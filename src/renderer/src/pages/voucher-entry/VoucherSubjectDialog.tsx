import * as Dialog from '@radix-ui/react-dialog'
import type { JSX } from 'react'
import type { VoucherEntryController } from './useVoucherEntryController'
import { ChevronDown, ChevronRight } from './VoucherSubjectIcons'
import { renderSubjectIndent } from './voucherEntryModel'

type Props = Pick<
  VoucherEntryController,
  | 'closeManualSubjectDialog'
  | 'manualSearchResults'
  | 'manualSubjectRowId'
  | 'manualSubjectSearchKeyword'
  | 'manualTreeExpandedCodes'
  | 'manualTreeHasChildren'
  | 'manualVisibleTreeRows'
  | 'restoreEditorInteraction'
  | 'selectSubjectFromDialog'
  | 'setManualSubjectSearchKeyword'
  | 'subjectPathByCode'
  | 'toggleManualTreeNode'
>

export default function VoucherSubjectDialog({
  closeManualSubjectDialog,
  manualSearchResults,
  manualSubjectRowId,
  manualSubjectSearchKeyword,
  manualTreeExpandedCodes,
  manualTreeHasChildren,
  manualVisibleTreeRows,
  restoreEditorInteraction,
  selectSubjectFromDialog,
  setManualSubjectSearchKeyword,
  subjectPathByCode,
  toggleManualTreeNode
}: Props): JSX.Element {
  return (
    <>
      <Dialog.Root
        open={manualSubjectRowId !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeManualSubjectDialog()
            restoreEditorInteraction()
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(820px,calc(100vw-32px))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title
                  className="text-lg font-bold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  手动选择会计科目
                </Dialog.Title>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  仅允许选择末级科目。科目树默认收起，可按层级展开后选择。
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary text-sm px-3 py-1.5"
                onClick={() => {
                  closeManualSubjectDialog()
                  restoreEditorInteraction()
                }}
              >
                关闭
              </button>
            </div>

            <div className="mt-4">
              <input
                type="text"
                className="glass-input w-full px-3 py-2 text-sm"
                value={manualSubjectSearchKeyword}
                onChange={(event) => setManualSubjectSearchKeyword(event.target.value)}
                placeholder="搜索科目代码或名称，仅显示末级科目结果"
              />
            </div>

            <div
              className="mt-4 overflow-auto rounded-md border max-h-[60vh]"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div
                className="grid grid-cols-[140px_minmax(0,1fr)_88px] gap-3 px-4 py-3 text-sm font-semibold border-b"
                style={{
                  borderColor: 'var(--color-glass-border-light)',
                  color: 'var(--color-text-primary)'
                }}
              >
                <div>科目编码</div>
                <div>科目名称</div>
                <div className="text-right">类型</div>
              </div>

              {manualSubjectSearchKeyword.trim() !== '' ? (
                manualSearchResults.length === 0 ? (
                  <div
                    className="py-10 text-center text-sm"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    未找到匹配的末级科目
                  </div>
                ) : (
                  manualSearchResults.map((subject) => (
                    <button
                      key={subject.id}
                      type="button"
                      className="grid w-full grid-cols-[140px_minmax(0,1fr)_88px] gap-3 px-3 py-2 text-left text-sm items-start border-b last:border-b-0 hover:bg-black/5"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                      onClick={() => selectSubjectFromDialog(subject)}
                      title={subjectPathByCode.get(subject.code) ?? ''}
                    >
                      <div className="truncate">{subject.code}</div>
                      <div className="min-w-0">
                        <div className="truncate">{subject.name}</div>
                        <div
                          className="mt-1 truncate text-xs"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {subjectPathByCode.get(subject.code) ?? ''}
                        </div>
                      </div>
                      <div
                        className="text-right text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        末级
                      </div>
                    </button>
                  ))
                )
              ) : manualVisibleTreeRows.length === 0 ? (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前账套暂无可选科目
                </div>
              ) : (
                manualVisibleTreeRows.map((treeRow) => {
                  const hasChildren = manualTreeHasChildren.has(treeRow.code)
                  const isLeaf = treeRow.kind === 'subject' && !hasChildren
                  const isCategory = treeRow.kind === 'category'
                  const subjectLogicalLevel = treeRow.kind === 'subject' ? treeRow.logicalLevel : 0

                  return (
                    <div
                      key={treeRow.id}
                      className="grid grid-cols-[140px_minmax(0,1fr)_88px] gap-3 px-3 py-2 text-sm items-center border-b last:border-b-0"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      <div className="flex min-w-0 items-center">
                        {!isCategory && renderSubjectIndent(subjectLogicalLevel)}
                        <span className="truncate">{isCategory ? '' : treeRow.row.code}</span>
                      </div>
                      <div className="flex items-center gap-1 min-w-0">
                        {!isCategory && renderSubjectIndent(subjectLogicalLevel)}
                        {hasChildren ? (
                          <button
                            type="button"
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 hover:bg-black/5 shrink-0"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                            aria-label={manualTreeExpandedCodes.has(treeRow.code) ? '折叠' : '展开'}
                          >
                            {manualTreeExpandedCodes.has(treeRow.code) ? (
                              <ChevronDown />
                            ) : (
                              <ChevronRight />
                            )}
                          </button>
                        ) : (
                          <span className="w-5 h-5 shrink-0" />
                        )}

                        {isCategory ? (
                          <button
                            type="button"
                            className="truncate text-left font-semibold"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                          >
                            {treeRow.name}
                          </button>
                        ) : isLeaf ? (
                          <button
                            type="button"
                            className="truncate text-left hover:text-slate-950"
                            onClick={() => selectSubjectFromDialog(treeRow.row)}
                          >
                            {treeRow.row.name}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="truncate text-left text-slate-600 hover:text-slate-950"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                          >
                            {treeRow.row.name}
                          </button>
                        )}
                      </div>
                      <div
                        className="text-right text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {isCategory ? '' : isLeaf ? '末级' : '上级'}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

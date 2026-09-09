import type { JSX } from 'react'
import type { VoucherEntryController } from './useVoucherEntryController'

type Props = Pick<
  VoucherEntryController,
  | 'balanced'
  | 'editingVoucherId'
  | 'handleEnableEdit'
  | 'handleNewVoucher'
  | 'handleOpenPrintDialog'
  | 'handleSave'
  | 'handleSwitchVoucher'
  | 'hasNextVoucher'
  | 'hasPrevVoucher'
  | 'isClosedPeriod'
  | 'isEditMode'
  | 'isEditableSavedVoucher'
  | 'isReadonlyVoucher'
  | 'isSavedVoucher'
  | 'loadingVoucher'
  | 'printSubmitting'
  | 'saving'
>

export default function VoucherEntryToolbar({
  balanced,
  editingVoucherId,
  handleEnableEdit,
  handleNewVoucher,
  handleOpenPrintDialog,
  handleSave,
  handleSwitchVoucher,
  hasNextVoucher,
  hasPrevVoucher,
  isClosedPeriod,
  isEditMode,
  isEditableSavedVoucher,
  isReadonlyVoucher,
  isSavedVoucher,
  loadingVoucher,
  printSubmitting,
  saving
}: Props): JSX.Element {
  return (
    <>
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {editingVoucherId ? (isEditMode ? '记账凭证（修改）' : '记账凭证（查看）') : '记账凭证'}
          </h2>
          <span
            className="px-2 py-1 rounded-md text-xs border"
            style={{
              color: isReadonlyVoucher ? 'var(--color-text-secondary)' : 'var(--color-success)',
              borderColor: isReadonlyVoucher
                ? 'var(--color-glass-border-light)'
                : 'rgba(22, 163, 74, 0.35)'
            }}
          >
            {isClosedPeriod ? '闭账只读' : isReadonlyVoucher ? '查看中' : '编辑中'}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSwitchVoucher('prev')}
            disabled={!hasPrevVoucher || loadingVoucher || saving}
          >
            上一张
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSwitchVoucher('next')}
            disabled={!hasNextVoucher || loadingVoucher || saving}
          >
            下一张
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void handleNewVoucher()}
            disabled={isClosedPeriod || saving || loadingVoucher}
            title={isClosedPeriod ? '当前期间已结账，不能新建凭证' : '新建凭证'}
          >
            新建
          </button>
          {isSavedVoucher && (
            <button
              className="glass-btn-secondary"
              onClick={handleEnableEdit}
              disabled={!isEditableSavedVoucher || isEditMode || saving || loadingVoucher}
              title={
                isClosedPeriod
                  ? '当前期间已结账，如需编辑请先反结账'
                  : !isEditableSavedVoucher
                    ? '仅未审核凭证可修改'
                    : isEditMode
                      ? '当前凭证已处于修改状态'
                      : '进入修改状态'
              }
            >
              修改
            </button>
          )}
          <button
            className="glass-btn-secondary"
            style={{ borderColor: balanced ? 'var(--color-success)' : '' }}
            onClick={() => void handleSave()}
            disabled={saving || loadingVoucher || isReadonlyVoucher}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            className="glass-btn-secondary"
            onClick={handleOpenPrintDialog}
            disabled={editingVoucherId === null || loadingVoucher || printSubmitting}
            title={editingVoucherId === null ? '请先保存当前凭证后再打印' : '打印当前凭证'}
          >
            打印
          </button>
        </div>
      </div>
    </>
  )
}

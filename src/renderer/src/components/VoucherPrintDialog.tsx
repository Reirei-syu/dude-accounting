import type { JSX } from 'react'

interface Props {
  open: boolean
  voucherCount: number
  layout: 'single' | 'double'
  doubleGapPx: string
  submitting: boolean
  onClose: () => void
  onConfirm: () => void
  onLayoutChange: (layout: 'single' | 'double') => void
  onGapChange: (value: string) => void
}

export default function VoucherPrintDialog({
  open,
  voucherCount,
  layout,
  doubleGapPx,
  submitting,
  onClose,
  onConfirm,
  onLayoutChange,
  onGapChange
}: Props): JSX.Element {
  if (!open) {
    return <></>
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{ background: 'rgba(15, 23, 42, 0.28)' }}
    >
      <div className="glass-panel w-full max-w-xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              凭证打印设置
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              当前将打印 {voucherCount} 张凭证。支持单张整页和 A4 一页两张（上下结构）两种版式。
            </p>
          </div>
          <button
            type="button"
            className="glass-btn-secondary px-3 py-1 text-xs"
            onClick={onClose}
            disabled={submitting}
          >
            关闭
          </button>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          <span style={{ color: 'var(--color-text-secondary)' }}>打印版式</span>
          <select
            className="glass-input"
            value={layout}
            onChange={(event) => onLayoutChange(event.target.value as 'single' | 'double')}
            disabled={submitting}
          >
            <option value="single">单张整页</option>
            <option value="double">A4 一页两张（上下结构）</option>
          </select>
        </label>

        {layout === 'double' && (
          <label className="flex flex-col gap-2 text-sm">
            <span style={{ color: 'var(--color-text-secondary)' }}>上下间距（像素）</span>
            <input
              className="glass-input"
              type="number"
              min="0"
              max="500"
              value={doubleGapPx}
              onChange={(event) => onGapChange(event.target.value)}
              disabled={submitting}
            />
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="glass-btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="button"
            className="glass-btn-secondary"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? '生成中...' : '打开打印预览'}
          </button>
        </div>
      </div>
    </div>
  )
}

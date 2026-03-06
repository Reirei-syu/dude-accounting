import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type PreviewEntry = {
  summary: string
  subjectCode: string
  subjectName: string
  debitAmount: number
  creditAmount: number
}

type ExistingVoucher = {
  id: number
  voucherNumber: number
  voucherDate: string
  status: number
}

type PreviewResult = {
  period: string
  voucherDate: string
  summary: string
  voucherWord: string
  includeUnpostedVouchers: boolean
  required: boolean
  canExecute: boolean
  blockedReason?: string
  totalDebit: number
  totalCredit: number
  entries: PreviewEntry[]
  existingVouchers: ExistingVoucher[]
  draftVoucherIds: number[]
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2)
}

function getStatusLabel(status: number): string {
  if (status === 2) return '已记账'
  if (status === 1) return '已审核'
  return '未审核'
}

export default function PLSettle(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const currentPeriod = useLedgerStore((state) => state.currentPeriod)

  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [includeUnpostedVouchers, setIncludeUnpostedVouchers] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const canLoad = Boolean(window.electron && currentLedger && currentPeriod)

  const loadPreview = useCallback(async (): Promise<void> => {
    if (!currentLedger || !currentPeriod || !window.electron) {
      setPreview(null)
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      const result = await window.api.plCarryForward.preview({
        ledgerId: currentLedger.id,
        period: currentPeriod,
        includeUnpostedVouchers
      })
      setPreview(result)
    } catch (error) {
      setPreview(null)
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载损益结转预览失败'
      })
    } finally {
      setLoading(false)
    }
  }, [currentLedger, currentPeriod, includeUnpostedVouchers])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  const totalAmount = useMemo(() => {
    if (!preview) return '0.00'
    const total = Math.max(preview.totalDebit, preview.totalCredit)
    return formatAmount(total)
  }, [preview])

  const handleExecute = async (): Promise<void> => {
    if (!currentLedger || !currentPeriod || !preview) return

    const rangeLabel = includeUnpostedVouchers ? '当前勾选范围' : '当前已记账范围'
    const confirmText =
      preview.draftVoucherIds.length > 0
        ? `当前期间存在 ${preview.draftVoucherIds.length} 张未审核的损益结转凭证，系统将先删除旧草稿并按${rangeLabel}重建。是否继续？`
        : `将按 ${preview.entries.length} 条分录执行期末损益结转，结转金额 ${totalAmount}。是否继续？`

    if (!window.confirm(confirmText)) return

    setExecuting(true)
    setMessage(null)
    try {
      const result = await window.api.plCarryForward.execute({
        ledgerId: currentLedger.id,
        period: currentPeriod,
        includeUnpostedVouchers
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '执行损益结转失败' })
        return
      }

      setMessage({
        type: 'success',
        text:
          result.status === 2
            ? `损益结转完成，已生成并记账第 ${result.voucherNumber} 号结转凭证。`
            : `损益结转完成，已生成第 ${result.voucherNumber} 号结转凭证，后续需审核并记账后才能结账。`
      })
      await loadPreview()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '执行损益结转失败'
      })
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            期末损益结转
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            默认仅统计当前会计期间内已记账且非结转凭证；勾选“未记账凭证”后，扩大到当前期间全部状态的非结转凭证。
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-xl border"
            style={{
              color: 'var(--color-text-primary)',
              borderColor: 'var(--color-glass-border-light)',
              background: 'var(--color-glass-bg-light)'
            }}
          >
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={includeUnpostedVouchers}
              onChange={(event) => setIncludeUnpostedVouchers(event.target.checked)}
              disabled={!canLoad || loading || executing}
            />
            <span>未记账凭证</span>
          </label>
          <button
            className="glass-btn-secondary"
            onClick={() => void loadPreview()}
            disabled={!canLoad || loading || executing}
          >
            {loading ? '刷新中...' : '刷新预览'}
          </button>
          <button
            className="glass-btn-primary"
            onClick={() => void handleExecute()}
            disabled={!preview?.required || !preview?.canExecute || executing || loading}
          >
            {executing ? '执行中...' : '执行结转'}
          </button>
        </div>
      </div>

      {!currentLedger || !currentPeriod ? (
        <div
          className="glass-panel-light px-4 py-6 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          请先选择账套和会计期间。
        </div>
      ) : null}

      {message && (
        <div
          className="text-sm px-1"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      {currentLedger && currentPeriod && preview && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="glass-panel-light px-4 py-3 text-sm space-y-2">
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>当前账套：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {currentLedger.name}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>会计期间：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {currentPeriod}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>结转凭证日期：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {preview.voucherDate}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>凭证摘要/字：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {preview.summary} / {preview.voucherWord}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>结转范围：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {includeUnpostedVouchers ? '全部状态凭证' : '仅已记账凭证'}
                </span>
              </div>
            </div>

            <div className="glass-panel-light px-4 py-3 text-sm space-y-2">
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>是否需要结转：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {preview.required ? '需要' : '无需'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>预览分录数：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {preview.entries.length}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>结转金额：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {totalAmount}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>执行状态：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {preview.required
                    ? preview.canExecute
                      ? '可执行'
                      : '不可重跑'
                    : '当前期间无须结转'}
                </span>
              </div>
            </div>
          </div>

          {preview.blockedReason && (
            <div
              className="glass-panel-light px-4 py-3 text-sm"
              style={{ color: 'var(--color-danger)' }}
            >
              {preview.blockedReason}
            </div>
          )}

          {!preview.required && (
            <div
              className="glass-panel-light px-4 py-3 text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {includeUnpostedVouchers
                ? '当前期间全部状态凭证中无可结转的损益金额。'
                : '当前期间已记账凭证中无可结转的损益金额，可直接进行期间结账。'}
            </div>
          )}

          {preview.draftVoucherIds.length > 0 && preview.canExecute && (
            <div
              className="glass-panel-light px-4 py-3 text-sm"
              style={{ color: 'var(--color-warning)' }}
            >
              当前期间存在 {preview.draftVoucherIds.length}{' '}
              张未审核损益结转凭证，再次执行时将自动删除旧草稿并按当前所选范围重建。
            </div>
          )}

          {preview.existingVouchers.length > 0 && (
            <div className="glass-panel flex flex-col overflow-hidden">
              <div
                className="px-4 py-3 border-b text-sm"
                style={{
                  borderColor: 'var(--color-glass-border-light)',
                  color: 'var(--color-text-muted)'
                }}
              >
                当前期间已存在的损益结转凭证
              </div>
              <div className="overflow-x-auto p-2">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr
                      className="border-b"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      <th className="py-2 px-3 font-semibold">凭证号</th>
                      <th className="py-2 px-3 font-semibold">日期</th>
                      <th className="py-2 px-3 font-semibold">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.existingVouchers.map((voucher) => (
                      <tr
                        key={voucher.id}
                        className="border-b last:border-0"
                        style={{
                          borderColor: 'var(--color-glass-border-light)',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <td className="py-2 px-3">{voucher.voucherNumber}</td>
                        <td className="py-2 px-3">{voucher.voucherDate}</td>
                        <td className="py-2 px-3">{getStatusLabel(voucher.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="glass-panel flex flex-col overflow-hidden">
            <div
              className="px-4 py-3 border-b text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-muted)'
              }}
            >
              结转预览分录
            </div>
            <div className="overflow-x-auto p-2">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr
                    className="border-b"
                    style={{
                      borderColor: 'var(--color-glass-border-light)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <th className="py-2 px-3 font-semibold">摘要</th>
                    <th className="py-2 px-3 font-semibold">科目</th>
                    <th className="py-2 px-3 font-semibold text-right">借方</th>
                    <th className="py-2 px-3 font-semibold text-right">贷方</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.entries.map((entry, index) => (
                    <tr
                      key={`${entry.subjectCode}-${entry.debitAmount}-${entry.creditAmount}-${index}`}
                      className="border-b last:border-0"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      <td className="py-2 px-3">{entry.summary}</td>
                      <td className="py-2 px-3">
                        {entry.subjectCode} {entry.subjectName}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {entry.debitAmount ? formatAmount(entry.debitAmount) : ''}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {entry.creditAmount ? formatAmount(entry.creditAmount) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ color: 'var(--color-text-primary)' }}>
                    <td className="py-3 px-3 font-semibold" colSpan={2}>
                      合计
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold">
                      {formatAmount(preview.totalDebit)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold">
                      {formatAmount(preview.totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

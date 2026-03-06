import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type PendingVoucher = {
  id: number
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2
  voucher_label: string
}

type PeriodStatus = {
  period: string
  is_closed: number
  closed_at: string | null
  pending_audit_vouchers: PendingVoucher[]
  pending_bookkeep_vouchers: PendingVoucher[]
}

const buildPendingVoucherMessage = (status: PeriodStatus | null): string | null => {
  if (!status || status.is_closed !== 1) return null

  const parts: string[] = []
  if (status.pending_audit_vouchers.length > 0) {
    parts.push(`未审核凭证：${status.pending_audit_vouchers.map((item) => item.voucher_label).join('、')}`)
  }
  if (status.pending_bookkeep_vouchers.length > 0) {
    parts.push(
      `已审核未记账凭证：${status.pending_bookkeep_vouchers
        .map((item) => item.voucher_label)
        .join('、')}`
    )
  }

  if (parts.length === 0) return null
  return `当前期间存在${parts.join('；')}。如需继续编辑这些凭证，必须先反结账。`
}

export default function PeriodClose(): JSX.Element {
  const { currentLedger, currentPeriod, updateCurrentLedgerPeriod } = useLedgerStore()
  const [status, setStatus] = useState<PeriodStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const canOperate = Boolean(window.electron && currentLedger && currentPeriod)
  const pendingVoucherMessage = useMemo(() => buildPendingVoucherMessage(status), [status])

  const isYearEnd = useMemo(() => {
    if (!currentPeriod || !/^\d{4}-\d{2}$/.test(currentPeriod)) return false
    return currentPeriod.endsWith('-12')
  }, [currentPeriod])

  const loadStatus = useCallback(async (): Promise<void> => {
    if (!currentLedger || !currentPeriod || !window.electron) {
      setStatus(null)
      return
    }
    try {
      const result = (await window.api.period.getStatus(
        currentLedger.id,
        currentPeriod
      )) as PeriodStatus
      setStatus(result)
    } catch (error) {
      setStatus(null)
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载结账状态失败'
      })
    }
  }, [currentLedger, currentPeriod])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleClose = async (): Promise<void> => {
    setMessage(null)
    if (!currentLedger || !currentPeriod) {
      setMessage({ type: 'error', text: '请先选择账套和会计期间' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持结账' })
      return
    }

    const confirmText = isYearEnd
      ? '当前为年末结账，系统将自动结转上一年年末数至下一年期初数。是否继续？'
      : '确认结账当前期间？'
    if (!window.confirm(confirmText)) return

    setLoading(true)
    try {
      const result = await window.api.period.close({
        ledgerId: currentLedger.id,
        period: currentPeriod
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '结账失败' })
        return
      }

      let successText = result.carriedForward
        ? `结账完成，已结转至 ${result.nextPeriod}（共 ${result.carriedCount ?? 0} 条）`
        : '结账完成'
      let switchedToNextPeriod = false

      if (result.nextPeriod && result.nextPeriod !== currentPeriod) {
        const shouldEnterNextPeriod = window.confirm(
          `结账完成，是否立即进入下一会计期间（${result.nextPeriod}）？`
        )

        if (shouldEnterNextPeriod) {
          const switchResult = await window.api.ledger.update({
            id: currentLedger.id,
            currentPeriod: result.nextPeriod
          })

          if (!switchResult.success) {
            setMessage({ type: 'error', text: switchResult.error || '切换下一会计期间失败' })
            await loadStatus()
            return
          }

          updateCurrentLedgerPeriod(result.nextPeriod)
          switchedToNextPeriod = true
          successText = `${successText}，已进入 ${result.nextPeriod}`
        }
      }

      setMessage({ type: 'success', text: successText })
      if (!switchedToNextPeriod) {
        await loadStatus()
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '结账失败'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleReopen = async (): Promise<void> => {
    setMessage(null)
    if (!currentLedger || !currentPeriod) {
      setMessage({ type: 'error', text: '请先选择账套和会计期间' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持反结账' })
      return
    }
    if (!window.confirm('确认反结账当前期间？')) return

    setLoading(true)
    try {
      const result = await window.api.period.reopen({
        ledgerId: currentLedger.id,
        period: currentPeriod
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '反结账失败' })
        return
      }

      setMessage({ type: 'success', text: '反结账完成，当前期间已恢复可编辑状态。' })
      await loadStatus()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '反结账失败'
      })
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = status?.is_closed === 1 ? '已结账' : '未结账'

  return (
    <div className="relative h-full flex flex-col gap-4 p-4 pb-28">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            结账
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            结账后当前期间凭证将进入冻结状态，若需恢复编辑必须先反结账。
          </p>
        </div>
      </div>

      <div className="glass-panel-light px-4 py-3 space-y-2 text-sm">
        <div>
          <span style={{ color: 'var(--color-text-muted)' }}>当前会计期间：</span>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            {currentPeriod || '未选择'}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--color-text-muted)' }}>结账状态：</span>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            {statusLabel}
          </span>
          {status?.closed_at && (
            <span style={{ color: 'var(--color-text-muted)' }}>（{status.closed_at}）</span>
          )}
        </div>
        {isYearEnd && (
          <div style={{ color: 'var(--color-text-muted)' }}>
            年末结账后系统会自动将上一年年末数带入下一年期初数。
          </div>
        )}
      </div>

      {pendingVoucherMessage && (
        <div
          className="glass-panel-light px-4 py-3 text-sm"
          style={{ color: 'var(--color-warning, #b45309)' }}
        >
          {pendingVoucherMessage}
        </div>
      )}

      {message && (
        <div
          className="text-sm px-2"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex flex-col gap-3 sm:flex-row">
        <button
          className="pointer-events-auto rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => void handleReopen()}
          disabled={!canOperate || status?.is_closed !== 1 || loading}
          style={{
            background: 'rgba(255, 255, 255, 0.92)',
            color: 'var(--color-text-primary)',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            backdropFilter: 'blur(14px)'
          }}
        >
          {loading && status?.is_closed === 1 ? '处理中...' : '反结账'}
        </button>
        <button
          className="pointer-events-auto rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => void handleClose()}
          disabled={!canOperate || status?.is_closed === 1 || loading}
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 41, 59, 0.9))',
            color: '#fff',
            border: '1px solid rgba(15, 23, 42, 0.22)',
            backdropFilter: 'blur(14px)'
          }}
        >
          {loading && status?.is_closed !== 1 ? '处理中...' : status?.is_closed === 1 ? '已结账' : '执行结账'}
        </button>
      </div>
    </div>
  )
}

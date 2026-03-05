import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type PeriodStatus = {
  period: string
  is_closed: number
  closed_at: string | null
}

export default function PeriodClose(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const [status, setStatus] = useState<PeriodStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const canOperate = Boolean(window.electron && currentLedger && currentPeriod)

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

      if (result.carriedForward) {
        setMessage({
          type: 'success',
          text: `结账完成，已结转至 ${result.nextPeriod}（共 ${result.carriedCount ?? 0} 条）`
        })
      } else {
        setMessage({ type: 'success', text: '结账完成' })
      }

      await loadStatus()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '结账失败'
      })
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = status?.is_closed === 1 ? '已结账' : '未结账'

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          结账
        </h2>
        <button
          className="glass-btn-secondary"
          onClick={() => void handleClose()}
          disabled={!canOperate || status?.is_closed === 1 || loading}
          style={!canOperate ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
        >
          {status?.is_closed === 1 ? '已结账' : '执行结账'}
        </button>
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
    </div>
  )
}

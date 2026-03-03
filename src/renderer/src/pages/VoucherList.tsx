import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useLedgerStore } from '../stores/ledgerStore'

interface VoucherRow {
  id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2
  total_debit: number
  total_credit: number
}

const STATUS_TEXT: Record<number, string> = {
  0: '未审核',
  1: '已审核',
  2: '已记账'
}

export default function VoucherList(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)

  const loadRows = useCallback(async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await window.api.voucher.list({
        ledgerId: currentLedger.id,
        period: currentPeriod || undefined
      })
      setRows(list as VoucherRow[])
    } catch (err) {
      setRows([])
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '加载凭证失败'
      })
    } finally {
      setLoading(false)
    }
  }, [currentLedger, currentPeriod])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void loadRows()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [loadRows])

  const totals = useMemo(() => {
    let debit = new Decimal(0)
    let credit = new Decimal(0)
    for (const row of rows) {
      debit = debit.plus(new Decimal(row.total_debit).div(100))
      credit = credit.plus(new Decimal(row.total_credit).div(100))
    }
    return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
  }, [rows])

  const toggleSelection = (voucherId: number): void => {
    setSelected((prev) =>
      prev.includes(voucherId) ? prev.filter((id) => id !== voucherId) : [...prev, voucherId]
    )
  }

  const runBatchAction = async (
    action: 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'
  ): Promise<void> => {
    setMessage(null)
    if (!canOperate) {
      setMessage({ type: 'error', text: '当前环境不支持该操作' })
      return
    }
    if (selected.length === 0) {
      setMessage({ type: 'error', text: '请先勾选凭证' })
      return
    }

    try {
      const result = await window.api.voucher.batchAction({
        action,
        voucherIds: selected
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '批量操作失败' })
        return
      }
      setMessage({ type: 'success', text: '操作成功' })
      setSelected([])
      await loadRows()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '批量操作失败' })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          凭证管理
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('audit')}>
            审核
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('bookkeep')}>
            记账
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('unbookkeep')}>
            反记账
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('unaudit')}>
            反审核
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('delete')}>
            删除
          </button>
        </div>
      </div>

      <div className="glass-panel flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[860px] h-full">
            <div
              className="grid grid-cols-12 py-2 px-3 border-b text-sm font-semibold"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div className="col-span-1">选择</div>
              <div className="col-span-2">日期</div>
              <div className="col-span-2">凭证号</div>
              <div className="col-span-2">状态</div>
              <div className="col-span-2 text-right">借方合计</div>
              <div className="col-span-2 text-right">贷方合计</div>
              <div className="col-span-1 text-right">期间</div>
            </div>
            <div className="overflow-y-auto h-[calc(100%-78px)]">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-12 py-2 px-3 border-b text-sm"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-secondary)'
                  }}
                >
                  <div className="col-span-1">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleSelection(row.id)}
                      aria-label={`选择凭证 ${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}`}
                    />
                  </div>
                  <div className="col-span-2">{row.voucher_date}</div>
                  <div className="col-span-2">
                    {row.voucher_word}-{String(row.voucher_number).padStart(4, '0')}
                  </div>
                  <div className="col-span-2">{STATUS_TEXT[row.status]}</div>
                  <div className="col-span-2 text-right">
                    {new Decimal(row.total_debit).div(100).toFixed(2)}
                  </div>
                  <div className="col-span-2 text-right">
                    {new Decimal(row.total_credit).div(100).toFixed(2)}
                  </div>
                  <div className="col-span-1 text-right">{row.period}</div>
                </div>
              ))}
              {rows.length === 0 && !loading && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前期间暂无凭证
                </div>
              )}
            </div>
            <div
              className="flex justify-end gap-6 px-4 py-2 border-t text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-secondary)'
              }}
            >
              <span>借方合计：{totals.debit}</span>
              <span>贷方合计：{totals.credit}</span>
            </div>
          </div>
        </div>
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

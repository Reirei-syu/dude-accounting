import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

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

type BatchAction = 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'

const STATUS_TEXT: Record<0 | 1 | 2, string> = {
  0: '未审核',
  1: '已审核',
  2: '已记账'
}
const STATUS_ORDER: Array<0 | 1 | 2> = [0, 1, 2]

const buildStatusCounter = (rows: VoucherRow[]): Record<0 | 1 | 2, number> => {
  const counters: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 }
  for (const row of rows) {
    counters[row.status] += 1
  }
  return counters
}

const formatSignedDelta = (value: number): string => (value > 0 ? `+${value}` : `${value}`)

const formatVoucherTag = (row: VoucherRow): string =>
  `${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}`

const formatClockTime = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(
    date.getSeconds()
  ).padStart(2, '0')}`

const buildRefreshSummary = (
  previousMap: Map<number, VoucherRow> | null,
  nextRows: VoucherRow[]
): string => {
  const nextMap = new Map<number, VoucherRow>(nextRows.map((row) => [row.id, row]))
  if (!previousMap) {
    const currentCount = buildStatusCounter(nextRows)
    return `首次刷新：共 ${nextRows.length} 张，未审核 ${currentCount[0]}，已审核 ${currentCount[1]}，已记账 ${currentCount[2]}`
  }

  const added: VoucherRow[] = []
  const removed: VoucherRow[] = []
  let statusChanged = 0

  for (const row of nextRows) {
    const previous = previousMap.get(row.id)
    if (!previous) {
      added.push(row)
      continue
    }
    if (previous.status !== row.status) {
      statusChanged += 1
    }
  }

  for (const [, previousRow] of previousMap) {
    if (!nextMap.has(previousRow.id)) {
      removed.push(previousRow)
    }
  }

  const previousCount = buildStatusCounter(Array.from(previousMap.values()))
  const currentCount = buildStatusCounter(nextRows)
  const statusDeltaText = STATUS_ORDER.map((status) => {
    const delta = currentCount[status] - previousCount[status]
    return `${STATUS_TEXT[status]} ${formatSignedDelta(delta)}`
  }).join('，')

  const addedPreview =
    added.length > 0 ? `；新增：${added.slice(0, 3).map(formatVoucherTag).join('、')}` : ''
  const removedPreview =
    removed.length > 0 ? `；减少：${removed.slice(0, 3).map(formatVoucherTag).join('、')}` : ''

  return `刷新变动：新增 ${added.length} 张，减少 ${removed.length} 张，状态变更 ${statusChanged} 张（${statusDeltaText}）${addedPreview}${removedPreview}`
}

export default function VoucherList(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const openTab = useUIStore((state) => state.openTab)
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [refreshSummary, setRefreshSummary] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState('')
  const previousRowsRef = useRef<Map<number, VoucherRow> | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)

  const loadRows = useCallback(
    async (options?: { trackDiff?: boolean }): Promise<void> => {
      if (!currentLedger || !window.electron) {
        setRows([])
        setSelected([])
        setLoading(false)
        setRefreshSummary('')
        setLastRefreshAt('')
        previousRowsRef.current = null
        return
      }

      setLoading(true)
      try {
        const list = await window.api.voucher.list({
          ledgerId: currentLedger.id,
          period: currentPeriod || undefined
        })
        const nextRows = list as VoucherRow[]
        setRows(nextRows)
        setSelected((prev) => prev.filter((id) => nextRows.some((row) => row.id === id)))

        if (options?.trackDiff) {
          setRefreshSummary(buildRefreshSummary(previousRowsRef.current, nextRows))
          setLastRefreshAt(formatClockTime(new Date()))
        }

        previousRowsRef.current = new Map(nextRows.map((row) => [row.id, row]))
      } catch (err) {
        setRows([])
        setMessage({
          type: 'error',
          text: err instanceof Error ? err.message : '加载凭证失败'
        })
      } finally {
        setLoading(false)
      }
    },
    [currentLedger, currentPeriod]
  )

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

  const runBatchAction = async (action: BatchAction): Promise<void> => {
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

  const openVoucherForEdit = (voucherId: number): void => {
    const row = rows.find((item) => item.id === voucherId)
    if (!row) {
      setMessage({ type: 'error', text: '凭证不存在' })
      return
    }

    openTab({
      id: 'voucher-entry',
      title: '凭证录入',
      componentType: 'VoucherEntry',
      params: {
        editVoucherId: row.id,
        editRequestKey: Date.now()
      }
    })
  }

  const handleEditSelected = (): void => {
    setMessage(null)
    if (selected.length === 0) {
      setMessage({ type: 'error', text: '请先勾选一张凭证' })
      return
    }
    if (selected.length > 1) {
      setMessage({ type: 'error', text: '一次只能修改一张凭证' })
      return
    }
    openVoucherForEdit(selected[0])
  }

  const handleRefresh = async (): Promise<void> => {
    setMessage(null)
    await loadRows({ trackDiff: true })
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          凭证管理
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button className="glass-btn-secondary" onClick={() => void handleRefresh()}>
            刷新
          </button>
          <button className="glass-btn-secondary" onClick={handleEditSelected}>
            修改
          </button>
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

      {refreshSummary && (
        <div className="text-xs px-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{lastRefreshAt ? `最近刷新 ${lastRefreshAt}：` : ''}</span>
          <span>{refreshSummary}</span>
        </div>
      )}

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
                  className="grid grid-cols-12 py-2 px-3 border-b text-sm cursor-pointer"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-secondary)'
                  }}
                  onDoubleClick={() => openVoucherForEdit(row.id)}
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

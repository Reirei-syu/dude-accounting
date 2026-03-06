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

interface PeriodStatusSummary {
  period: string
  is_closed: number
  closed_at: string | null
  pending_audit_vouchers: Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: 0 | 1 | 2
    voucher_label: string
  }>
  pending_bookkeep_vouchers: Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: 0 | 1 | 2
    voucher_label: string
  }>
}

type BatchAction = 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'

const STATUS_TEXT: Record<0 | 1 | 2, string> = {
  0: '\u672a\u5ba1\u6838',
  1: '\u5df2\u5ba1\u6838',
  2: '\u5df2\u8bb0\u8d26'
}

const STATUS_ORDER: Array<0 | 1 | 2> = [0, 1, 2]

const BATCH_ACTION_TEXT: Record<BatchAction, { completed: string; available: string }> = {
  audit: { completed: '\u5df2\u5ba1\u6838', available: '\u53ef\u5ba1\u6838' },
  bookkeep: { completed: '\u5df2\u8bb0\u8d26', available: '\u53ef\u8bb0\u8d26' },
  unbookkeep: { completed: '\u5df2\u53cd\u8bb0\u8d26', available: '\u53ef\u53cd\u8bb0\u8d26' },
  unaudit: { completed: '\u5df2\u53cd\u5ba1\u6838', available: '\u53ef\u53cd\u5ba1\u6838' },
  delete: { completed: '\u5df2\u5220\u9664', available: '\u53ef\u5220\u9664' }
}

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

const buildClosedPeriodEditMessage = (period: string): string =>
  `当前会计期间（${period}）已结账，本期凭证不能新增或编辑；未审核、未记账凭证仅可删除，如需继续编辑请先反结账。`

const buildBatchActionMessage = (
  action: BatchAction,
  processedCount: number,
  skippedCount: number
): string => {
  if (action === 'delete') {
    return `${BATCH_ACTION_TEXT[action].completed} ${processedCount} \u5f20\u51ed\u8bc1`
  }
  if (processedCount === 0 && skippedCount > 0) {
    return `\u6ca1\u6709${BATCH_ACTION_TEXT[action].available}\u7684\u51ed\u8bc1\uff0c\u5df2\u8df3\u8fc7 ${skippedCount} \u5f20`
  }
  if (skippedCount > 0) {
    return `${BATCH_ACTION_TEXT[action].completed} ${processedCount} \u5f20\u51ed\u8bc1\uff0c\u8df3\u8fc7 ${skippedCount} \u5f20\u4e0d\u7b26\u5408\u6761\u4ef6\u7684\u51ed\u8bc1`
  }
  return `${BATCH_ACTION_TEXT[action].completed} ${processedCount} \u5f20\u51ed\u8bc1`
}

const buildRefreshSummary = (
  previousMap: Map<number, VoucherRow> | null,
  nextRows: VoucherRow[]
): string => {
  const nextMap = new Map<number, VoucherRow>(nextRows.map((row) => [row.id, row]))

  if (!previousMap) {
    const currentCount = buildStatusCounter(nextRows)
    return `\u9996\u6b21\u5237\u65b0\uff1a\u5171 ${nextRows.length} \u5f20\uff0c${STATUS_TEXT[0]} ${currentCount[0]}\uff0c${STATUS_TEXT[1]} ${currentCount[1]}\uff0c${STATUS_TEXT[2]} ${currentCount[2]}`
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
  }).join('\uff0c')

  const addedPreview =
    added.length > 0
      ? `\uff1b\u65b0\u589e\uff1a${added.slice(0, 3).map(formatVoucherTag).join('\u3001')}`
      : ''
  const removedPreview =
    removed.length > 0
      ? `\uff1b\u51cf\u5c11\uff1a${removed.slice(0, 3).map(formatVoucherTag).join('\u3001')}`
      : ''

  return `\u5237\u65b0\u53d8\u52a8\uff1a\u65b0\u589e ${added.length} \u5f20\uff0c\u51cf\u5c11 ${removed.length} \u5f20\uff0c\u72b6\u6001\u53d8\u66f4 ${statusChanged} \u5f20\uff08${statusDeltaText}\uff09${addedPreview}${removedPreview}`
}

export default function VoucherList(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const openTab = useUIStore((state) => state.openTab)
  const activeTabId = useUIStore((state) => state.activeTabId)
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [periodStatus, setPeriodStatus] = useState<PeriodStatusSummary | null>(null)
  const [refreshSummary, setRefreshSummary] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState('')
  const previousRowsRef = useRef<Map<number, VoucherRow> | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)
  const isClosedPeriod = periodStatus?.is_closed === 1
  const closedPeriodMessage =
    currentPeriod && currentPeriod.trim() !== '' ? buildClosedPeriodEditMessage(currentPeriod) : ''

  const loadPeriodStatus = useCallback(async (): Promise<void> => {
    if (!currentLedger || !currentPeriod || !window.electron) {
      setPeriodStatus(null)
      return
    }

    const result = (await window.api.period.getStatus(
      currentLedger.id,
      currentPeriod
    )) as PeriodStatusSummary
    setPeriodStatus(result)
  }, [currentLedger, currentPeriod])

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
          text: err instanceof Error ? err.message : '\u52a0\u8f7d\u51ed\u8bc1\u5931\u8d25'
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
  }, [activeTabId, loadRows])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadPeriodStatus()
        if (!cancelled) {
          // no-op, state updated in callback
        }
      } catch (error) {
        if (!cancelled) {
          console.error('load voucher list period status failed', error)
          setPeriodStatus(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTabId, loadPeriodStatus])

  const totals = useMemo(() => {
    let debit = new Decimal(0)
    let credit = new Decimal(0)

    for (const row of rows) {
      debit = debit.plus(new Decimal(row.total_debit).div(100))
      credit = credit.plus(new Decimal(row.total_credit).div(100))
    }

    return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
  }, [rows])

  const visibleVoucherIds = useMemo(() => rows.map((row) => row.id), [rows])
  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  const canSwapSelected = selected.length === 2
  const allVisibleSelected =
    visibleVoucherIds.length > 0 &&
    visibleVoucherIds.every((voucherId) => selectedIdSet.has(voucherId))
  const partiallyVisibleSelected =
    visibleVoucherIds.some((voucherId) => selectedIdSet.has(voucherId)) && !allVisibleSelected

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallyVisibleSelected
    }
  }, [partiallyVisibleSelected])

  const toggleSelection = (voucherId: number): void => {
    setSelected((prev) =>
      prev.includes(voucherId) ? prev.filter((id) => id !== voucherId) : [...prev, voucherId]
    )
  }

  const toggleSelectAll = (): void => {
    setSelected(allVisibleSelected ? [] : visibleVoucherIds)
  }

  const runBatchAction = async (action: BatchAction): Promise<void> => {
    setMessage(null)

    if (!canOperate) {
      setMessage({
        type: 'error',
        text: '\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8be5\u64cd\u4f5c'
      })
      return
    }

    if (selected.length === 0) {
      setMessage({ type: 'error', text: '\u8bf7\u5148\u52fe\u9009\u51ed\u8bc1' })
      return
    }

    try {
      const result = await window.api.voucher.batchAction({
        action,
        voucherIds: selected
      })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '\u6279\u91cf\u64cd\u4f5c\u5931\u8d25' })
        return
      }

      setMessage({
        type: 'success',
        text: buildBatchActionMessage(action, result.processedCount ?? 0, result.skippedCount ?? 0)
      })
      await loadRows()
      await loadPeriodStatus()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '\u6279\u91cf\u64cd\u4f5c\u5931\u8d25'
      })
    }
  }

  const handleSwapPositions = async (): Promise<void> => {
    setMessage(null)

    if (!canOperate) {
      setMessage({
        type: 'error',
        text: '\u5f53\u524d\u73af\u5883\u4e0d\u652f\u6301\u8be5\u64cd\u4f5c'
      })
      return
    }

    if (!canSwapSelected) {
      setMessage({
        type: 'error',
        text: '\u4ec5\u9009\u62e9 2 \u5f20\u51ed\u8bc1\u65f6\u624d\u53ef\u4ea4\u6362\u4f4d\u7f6e'
      })
      return
    }

    try {
      const result = await window.api.voucher.swapPositions({
        voucherIds: [selected[0], selected[1]]
      })

      if (!result.success) {
        setMessage({
          type: 'error',
          text: result.error || '\u4ea4\u6362\u51ed\u8bc1\u4f4d\u7f6e\u5931\u8d25'
        })
        return
      }

      setMessage({
        type: 'success',
        text: '\u5df2\u4ea4\u6362 2 \u5f20\u51ed\u8bc1\u7684\u4f4d\u7f6e'
      })
      await loadRows()
    } catch (err) {
      setMessage({
        type: 'error',
        text:
          err instanceof Error ? err.message : '\u4ea4\u6362\u51ed\u8bc1\u4f4d\u7f6e\u5931\u8d25'
      })
    }
  }

  const openVoucherForEdit = (voucherId: number): void => {
    const row = rows.find((item) => item.id === voucherId)
    if (!row) {
      setMessage({ type: 'error', text: '\u51ed\u8bc1\u4e0d\u5b58\u5728' })
      return
    }

    openTab({
      id: 'voucher-entry',
      title: '\u51ed\u8bc1\u5f55\u5165',
      componentType: 'VoucherEntry',
      params: {
        editVoucherId: row.id,
        editRequestKey: Date.now()
      }
    })
  }

  const handleEditSelected = (): void => {
    setMessage(null)

    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }

    if (selected.length === 0) {
      setMessage({ type: 'error', text: '\u8bf7\u5148\u52fe\u9009\u4e00\u5f20\u51ed\u8bc1' })
      return
    }

    if (selected.length > 1) {
      setMessage({
        type: 'error',
        text: '\u4e00\u6b21\u53ea\u80fd\u4fee\u6539\u4e00\u5f20\u51ed\u8bc1'
      })
      return
    }

    openVoucherForEdit(selected[0])
  }

  const handleRefresh = async (): Promise<void> => {
    setMessage(null)
    await loadRows({ trackDiff: true })
    await loadPeriodStatus()
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {'\u51ed\u8bc1\u7ba1\u7406'}
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button className="glass-btn-secondary" onClick={() => void handleRefresh()}>
            {'\u5237\u65b0'}
          </button>
          <button
            className="glass-btn-secondary"
            onClick={handleEditSelected}
            disabled={isClosedPeriod}
            title={isClosedPeriod ? '当前期间已结账，如需编辑请先反结账' : '修改选中凭证'}
          >
            {'\u4fee\u6539'}
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSwapPositions()}
            disabled={!canSwapSelected || !canOperate}
          >
            {'\u4ea4\u6362\u4f4d\u7f6e'}
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('audit')}>
            {'\u5ba1\u6838'}
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('bookkeep')}>
            {'\u8bb0\u8d26'}
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('unbookkeep')}>
            {'\u53cd\u8bb0\u8d26'}
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('unaudit')}>
            {'\u53cd\u5ba1\u6838'}
          </button>
          <button className="glass-btn-secondary" onClick={() => void runBatchAction('delete')}>
            {'\u5220\u9664'}
          </button>
        </div>
      </div>

      {isClosedPeriod && (
        <div
          className="glass-panel-light px-4 py-3 text-sm"
          style={{ color: 'var(--color-danger)' }}
        >
          {closedPeriodMessage}
        </div>
      )}

      {refreshSummary && (
        <div className="text-xs px-1" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{lastRefreshAt ? `\u6700\u8fd1\u5237\u65b0\uff1a${lastRefreshAt}\uff1b` : ''}</span>
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
              <div className="col-span-1 flex items-center gap-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  disabled={rows.length === 0}
                  aria-label="\u5168\u9009\u5f53\u524d\u5217\u8868\u51ed\u8bc1"
                />
                <span>{'\u9009\u62e9'}</span>
              </div>
              <div className="col-span-2">{'\u65e5\u671f'}</div>
              <div className="col-span-2">{'\u51ed\u8bc1\u53f7'}</div>
              <div className="col-span-2">{'\u72b6\u6001'}</div>
              <div className="col-span-2 text-right">{'\u501f\u65b9\u5408\u8ba1'}</div>
              <div className="col-span-2 text-right">{'\u8d37\u65b9\u5408\u8ba1'}</div>
              <div className="col-span-1 text-right">{'\u671f\u95f4'}</div>
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
                  <div className="col-span-1 flex items-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleSelection(row.id)}
                      aria-label={`\u9009\u62e9\u51ed\u8bc1 ${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}`}
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
                  {'\u5f53\u524d\u671f\u95f4\u6682\u65e0\u51ed\u8bc1'}
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
              <span>{`\u501f\u65b9\u5408\u8ba1\uff1a${totals.debit}`}</span>
              <span>{`\u8d37\u65b9\u5408\u8ba1\uff1a${totals.credit}`}</span>
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

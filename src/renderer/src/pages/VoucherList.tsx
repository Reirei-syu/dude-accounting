import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useAuthStore } from '../stores/authStore'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

type VoucherStatus = 0 | 1 | 2 | 3
type VoucherStatusTab = 'all' | 'pending' | 'audited' | 'posted' | 'deleted'
type BatchAction =
  | 'audit'
  | 'bookkeep'
  | 'unbookkeep'
  | 'unaudit'
  | 'delete'
  | 'restoreDelete'
  | 'purgeDelete'

interface VoucherRow {
  id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: VoucherStatus
  first_summary: string
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

interface ActionButtonConfig {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

interface ReverseBookkeepFormState {
  open: boolean
  reason: string
  approvalTag: string
  submitting: boolean
}

const STATUS_TEXT: Record<VoucherStatus, string> = {
  0: '未审核',
  1: '已审核',
  2: '已记账',
  3: '已删除'
}

const STATUS_ORDER: VoucherStatus[] = [0, 1, 2, 3]

const STATUS_BADGE_STYLE: Record<
  VoucherStatus,
  { borderColor: string; background: string; color: string }
> = {
  0: {
    borderColor: 'rgba(245, 158, 11, 0.35)',
    background: 'rgba(245, 158, 11, 0.12)',
    color: '#B45309'
  },
  1: {
    borderColor: 'rgba(37, 99, 235, 0.28)',
    background: 'rgba(37, 99, 235, 0.12)',
    color: '#1D4ED8'
  },
  2: {
    borderColor: 'rgba(22, 163, 74, 0.3)',
    background: 'rgba(22, 163, 74, 0.12)',
    color: '#15803D'
  },
  3: {
    borderColor: 'rgba(220, 38, 38, 0.28)',
    background: 'rgba(220, 38, 38, 0.1)',
    color: '#B91C1C'
  }
}

const TAB_CONFIG: Array<{
  id: VoucherStatusTab
  label: string
  count: (rows: VoucherRow[]) => number
}> = [
  { id: 'all', label: '全部', count: (rows) => rows.length },
  { id: 'pending', label: '未审核', count: (rows) => rows.filter((row) => row.status === 0).length },
  { id: 'audited', label: '已审核', count: (rows) => rows.filter((row) => row.status === 1).length },
  { id: 'posted', label: '已记账', count: (rows) => rows.filter((row) => row.status === 2).length },
  { id: 'deleted', label: '已删除', count: (rows) => rows.filter((row) => row.status === 3).length }
]

const BATCH_ACTION_TEXT: Record<BatchAction, { completed: string; available: string }> = {
  audit: { completed: '已审核', available: '可审核' },
  bookkeep: { completed: '已记账', available: '可记账' },
  unbookkeep: { completed: '已反记账', available: '可反记账' },
  unaudit: { completed: '已反审核', available: '可反审核' },
  delete: { completed: '已删除', available: '可删除' },
  restoreDelete: { completed: '已撤回删除', available: '可撤回删除' },
  purgeDelete: { completed: '已彻底删除', available: '可彻底删除' }
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

const VOUCHER_GRID_TEMPLATE = '72px 1.05fr 1.05fr 0.9fr 1.7fr 1fr 1fr 0.8fr'

const filterRowsByTab = (rows: VoucherRow[], activeTab: VoucherStatusTab): VoucherRow[] => {
  switch (activeTab) {
    case 'pending':
      return rows.filter((row) => row.status === 0)
    case 'audited':
      return rows.filter((row) => row.status === 1)
    case 'posted':
      return rows.filter((row) => row.status === 2)
    case 'deleted':
      return rows.filter((row) => row.status === 3)
    case 'all':
    default:
      return rows
  }
}

const buildStatusCounter = (rows: VoucherRow[]): Record<VoucherStatus, number> => {
  const counters: Record<VoucherStatus, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const row of rows) {
    counters[row.status] += 1
  }
  return counters
}

const buildBatchActionMessage = (
  action: BatchAction,
  processedCount: number,
  skippedCount: number
): string => {
  if (processedCount === 0 && skippedCount > 0) {
    return `没有${BATCH_ACTION_TEXT[action].available}的凭证，已跳过 ${skippedCount} 张`
  }
  if (skippedCount > 0) {
    return `${BATCH_ACTION_TEXT[action].completed} ${processedCount} 张凭证，跳过 ${skippedCount} 张不符合条件的凭证`
  }
  return `${BATCH_ACTION_TEXT[action].completed} ${processedCount} 张凭证`
}

const buildRefreshSummary = (
  previousMap: Map<number, VoucherRow> | null,
  nextRows: VoucherRow[]
): string => {
  const nextMap = new Map<number, VoucherRow>(nextRows.map((row) => [row.id, row]))

  if (!previousMap) {
    const currentCount = buildStatusCounter(nextRows)
    return `首次刷新：共 ${nextRows.length} 张，未审核 ${currentCount[0]}，已审核 ${currentCount[1]}，已记账 ${currentCount[2]}，已删除 ${currentCount[3]}`
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
  const currentUser = useAuthStore((state) => state.user)
  const openTab = useUIStore((state) => state.openTab)
  const activeTabId = useUIStore((state) => state.activeTabId)
  const [allRows, setAllRows] = useState<VoucherRow[]>([])
  const [activeStatusTab, setActiveStatusTab] = useState<VoucherStatusTab>('all')
  const [selected, setSelected] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [reverseBookkeepForm, setReverseBookkeepForm] = useState<ReverseBookkeepFormState>({
    open: false,
    reason: '',
    approvalTag: '',
    submitting: false
  })
  const [periodStatus, setPeriodStatus] = useState<PeriodStatusSummary | null>(null)
  const [refreshSummary, setRefreshSummary] = useState('')
  const [lastRefreshAt, setLastRefreshAt] = useState('')
  const previousRowsRef = useRef<Map<number, VoucherRow> | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)
  const canReverseBookkeep =
    currentUser?.isAdmin === true || currentUser?.permissions?.unbookkeep === true
  const isClosedPeriod = periodStatus?.is_closed === 1
  const closedPeriodMessage =
    currentPeriod && currentPeriod.trim() !== '' ? buildClosedPeriodEditMessage(currentPeriod) : ''

  const displayRows = useMemo(
    () => filterRowsByTab(allRows, activeStatusTab),
    [activeStatusTab, allRows]
  )

  const selectedIdSet = useMemo(() => new Set(selected), [selected])
  const selectedRows = useMemo(
    () => displayRows.filter((row) => selectedIdSet.has(row.id)),
    [displayRows, selectedIdSet]
  )
  const visibleVoucherIds = useMemo(() => displayRows.map((row) => row.id), [displayRows])
  const canSwapSelected = selected.length === 2
  const allVisibleSelected =
    visibleVoucherIds.length > 0 &&
    visibleVoucherIds.every((voucherId) => selectedIdSet.has(voucherId))
  const partiallyVisibleSelected =
    visibleVoucherIds.some((voucherId) => selectedIdSet.has(voucherId)) && !allVisibleSelected

  const tabMetrics = useMemo(
    () =>
      TAB_CONFIG.map((tab) => ({
        ...tab,
        total: tab.count(allRows)
      })),
    [allRows]
  )

  const totals = useMemo(() => {
    let debit = new Decimal(0)
    let credit = new Decimal(0)

    for (const row of displayRows) {
      debit = debit.plus(new Decimal(row.total_debit).div(100))
      credit = credit.plus(new Decimal(row.total_credit).div(100))
    }

    return { debit: debit.toFixed(2), credit: credit.toFixed(2) }
  }, [displayRows])

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partiallyVisibleSelected
    }
  }, [partiallyVisibleSelected])

  useEffect(() => {
    const visibleIdSet = new Set(visibleVoucherIds)
    setSelected((prev) => prev.filter((id) => visibleIdSet.has(id)))
  }, [visibleVoucherIds])

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
        setAllRows([])
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
          period: currentPeriod || undefined,
          status: 'all'
        })
        const nextRows = list as VoucherRow[]
        setAllRows(nextRows)
        setSelected((prev) => prev.filter((id) => nextRows.some((row) => row.id === id)))

        if (options?.trackDiff) {
          setRefreshSummary(buildRefreshSummary(previousRowsRef.current, nextRows))
          setLastRefreshAt(formatClockTime(new Date()))
        }

        previousRowsRef.current = new Map(nextRows.map((row) => [row.id, row]))
      } catch (err) {
        setAllRows([])
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
  }, [activeTabId, loadRows])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadPeriodStatus()
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

  const toggleSelection = (voucherId: number): void => {
    setSelected((prev) =>
      prev.includes(voucherId) ? prev.filter((id) => id !== voucherId) : [...prev, voucherId]
    )
  }

  const toggleSelectAll = (): void => {
    setSelected(allVisibleSelected ? [] : visibleVoucherIds)
  }

  const shouldConfirmAction = (action: BatchAction, count: number): string | null => {
    if (action === 'restoreDelete') {
      return `确定撤回删除选中的 ${count} 张凭证吗？`
    }
    if (action === 'purgeDelete') {
      return `确定彻底删除选中的 ${count} 张凭证吗？该操作不可撤销。`
    }
    return null
  }

  const executeBatchAction = async (
    action: BatchAction,
    options?: { reason?: string; approvalTag?: string }
  ): Promise<boolean> => {
    setMessage(null)

    if (!canOperate) {
      setMessage({
        type: 'error',
        text: '当前环境不支持该操作'
      })
      return false
    }

    if (selected.length === 0) {
      setMessage({ type: 'error', text: '请先勾选凭证' })
      return false
    }

    const confirmationMessage = shouldConfirmAction(action, selected.length)
    if (confirmationMessage && !window.confirm(confirmationMessage)) {
      return false
    }

    try {
      const result = await window.api.voucher.batchAction({
        action,
        voucherIds: selected,
        reason: options?.reason,
        approvalTag: options?.approvalTag
      })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '批量操作失败' })
        return false
      }

      setMessage({
        type: 'success',
        text: buildBatchActionMessage(action, result.processedCount ?? 0, result.skippedCount ?? 0)
      })
      await loadRows()
      await loadPeriodStatus()
      return true
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '批量操作失败'
      })
      return false
    }
  }

  const runBatchAction = async (action: BatchAction): Promise<void> => {
    if (action === 'unbookkeep') {
      setMessage(null)
      if (!canOperate) {
        setMessage({ type: 'error', text: '当前环境不支持该操作' })
        return
      }
      if (selected.length === 0) {
        setMessage({ type: 'error', text: '请先勾选凭证' })
        return
      }
      setReverseBookkeepForm({
        open: true,
        reason: '',
        approvalTag: '',
        submitting: false
      })
      return
    }

    await executeBatchAction(action)
  }

  const closeReverseBookkeepDialog = (): void => {
    if (reverseBookkeepForm.submitting) return
    setReverseBookkeepForm({
      open: false,
      reason: '',
      approvalTag: '',
      submitting: false
    })
  }

  const submitReverseBookkeep = async (): Promise<void> => {
    const reason = reverseBookkeepForm.reason.trim()
    const approvalTag = reverseBookkeepForm.approvalTag.trim()

    if (!reason) {
      setMessage({ type: 'error', text: '反记账必须填写原因' })
      return
    }
    if (!approvalTag) {
      setMessage({ type: 'error', text: '反记账必须填写审批标记' })
      return
    }

    setReverseBookkeepForm((prev) => ({ ...prev, submitting: true }))
    const success = await executeBatchAction('unbookkeep', { reason, approvalTag })
    setReverseBookkeepForm((prev) =>
      success
        ? {
            open: false,
            reason: '',
            approvalTag: '',
            submitting: false
          }
        : { ...prev, submitting: false }
    )
  }

  const handleSwapPositions = async (): Promise<void> => {
    setMessage(null)

    if (!canOperate) {
      setMessage({
        type: 'error',
        text: '当前环境不支持该操作'
      })
      return
    }

    if (!canSwapSelected) {
      setMessage({
        type: 'error',
        text: '仅选择 2 张凭证时才可交换位置'
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
          text: result.error || '交换凭证位置失败'
        })
        return
      }

      setMessage({
        type: 'success',
        text: '已交换 2 张凭证的位置'
      })
      await loadRows()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '交换凭证位置失败'
      })
    }
  }

  const openVoucherForEdit = (voucherId: number): void => {
    const row = allRows.find((item) => item.id === voucherId)
    if (!row) {
      setMessage({ type: 'error', text: '凭证不存在' })
      return
    }

    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }

    if (row.status === 3) {
      setMessage({ type: 'error', text: '已删除凭证仅支持撤回删除或彻底删除。' })
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

    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }

    if (selected.length === 0) {
      setMessage({ type: 'error', text: '请先勾选一张凭证' })
      return
    }

    if (selected.length > 1) {
      setMessage({
        type: 'error',
        text: '一次只能修改一张凭证'
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

  const actionButtons: ActionButtonConfig[] = (() => {
    if (activeStatusTab === 'pending') {
      return [{ key: 'audit', label: '审核', onClick: () => void runBatchAction('audit') }]
    }

    if (activeStatusTab === 'audited') {
      return [
        { key: 'bookkeep', label: '记账', onClick: () => void runBatchAction('bookkeep') },
        { key: 'unaudit', label: '反审核', onClick: () => void runBatchAction('unaudit') }
      ]
    }

    if (activeStatusTab === 'posted' && !canReverseBookkeep) {
      return []
    }

    if (activeStatusTab === 'posted') {
      return [{ key: 'unbookkeep', label: '反记账', onClick: () => void runBatchAction('unbookkeep') }]
    }

    if (activeStatusTab === 'deleted') {
      return [
        {
          key: 'restoreDelete',
          label: '撤回删除',
          onClick: () => void runBatchAction('restoreDelete')
        },
        {
          key: 'purgeDelete',
          label: '彻底删除',
          onClick: () => void runBatchAction('purgeDelete'),
          title: '彻底删除后无法恢复'
        }
      ]
    }

    const buttons: ActionButtonConfig[] = [
      { key: 'refresh', label: '刷新', onClick: () => void handleRefresh() },
      {
        key: 'edit',
        label: '修改',
        onClick: handleEditSelected,
        disabled: isClosedPeriod,
        title: isClosedPeriod ? '当前期间已结账，如需编辑请先反结账' : '修改选中凭证'
      },
      {
        key: 'swap',
        label: '交换位置',
        onClick: () => void handleSwapPositions(),
        disabled: !canSwapSelected || !canOperate
      },
      { key: 'audit', label: '审核', onClick: () => void runBatchAction('audit') },
      { key: 'bookkeep', label: '记账', onClick: () => void runBatchAction('bookkeep') },
      { key: 'unaudit', label: '反审核', onClick: () => void runBatchAction('unaudit') },
      { key: 'delete', label: '删除', onClick: () => void runBatchAction('delete') }
    ]

    if (canReverseBookkeep) {
      buttons.splice(5, 0, {
        key: 'unbookkeep',
        label: '反记账',
        onClick: () => void runBatchAction('unbookkeep')
      })
    }

    return buttons
  })()

  const emptyText = useMemo(() => {
    if (activeStatusTab === 'deleted') {
      return '当前期间暂无已删除凭证'
    }
    if (activeStatusTab === 'pending') {
      return '当前期间暂无未审核凭证'
    }
    if (activeStatusTab === 'audited') {
      return '当前期间暂无已审核凭证'
    }
    if (activeStatusTab === 'posted') {
      return '当前期间暂无已记账凭证'
    }
    return '当前期间暂无凭证'
  }, [activeStatusTab])

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          凭证管理
        </h2>
        <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          当前筛选共 {displayRows.length} 张，已勾选 {selectedRows.length} 张
        </div>
      </div>

      <div className="glass-panel-light p-3">
        <div className="flex gap-2 flex-wrap">
          {actionButtons.map((button) => (
            <button
              key={button.key}
              className="glass-btn-secondary"
              onClick={button.onClick}
              disabled={button.disabled}
              title={button.title}
            >
              {button.label}
            </button>
          ))}
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
          <span>{lastRefreshAt ? `最近刷新：${lastRefreshAt}；` : ''}</span>
          <span>{refreshSummary}</span>
        </div>
      )}

      <div className="glass-panel flex-1 overflow-hidden flex flex-col">
        <div
          className="border-b px-4 py-3"
          style={{ borderColor: 'var(--color-glass-border-light)' }}
        >
          <div className="flex flex-wrap gap-2">
            {tabMetrics.map((tab) => {
              const isActive = activeStatusTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  className="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors duration-200"
                  style={{
                    borderColor: isActive
                      ? 'var(--color-primary)'
                      : 'var(--color-glass-border-light)',
                    background: isActive ? 'rgba(59, 130, 246, 0.12)' : 'rgba(255, 255, 255, 0.45)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)'
                  }}
                  onClick={() => {
                    setActiveStatusTab(tab.id)
                    setMessage(null)
                  }}
                >
                  {tab.label}
                  <span className="ml-1 opacity-80">{tab.total}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[1120px] h-full flex flex-col">
            <div
              className="grid py-2 px-3 border-b text-sm font-semibold"
              style={{
                gridTemplateColumns: VOUCHER_GRID_TEMPLATE,
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-5 w-5 shrink-0"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  disabled={displayRows.length === 0}
                  aria-label="全选当前列表凭证"
                />
                <span>选择</span>
              </div>
              <div>日期</div>
              <div>凭证号</div>
              <div>状态</div>
              <div>摘要</div>
              <div className="text-right">借方合计</div>
              <div className="text-right">贷方合计</div>
              <div className="text-right">期间</div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {displayRows.map((row) => (
                <div
                  key={row.id}
                  className="grid py-2 px-3 border-b text-sm cursor-pointer transition-colors duration-200"
                  style={{
                    gridTemplateColumns: VOUCHER_GRID_TEMPLATE,
                    borderColor: 'var(--color-glass-border-light)',
                    color:
                      row.status === 3
                        ? 'var(--color-text-muted)'
                        : 'var(--color-text-secondary)',
                    background:
                      row.status === 3 ? 'rgba(220, 38, 38, 0.035)' : 'transparent'
                  }}
                  onDoubleClick={() => openVoucherForEdit(row.id)}
                >
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleSelection(row.id)}
                      aria-label={`选择凭证 ${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}`}
                    />
                  </div>
                  <div>{row.voucher_date}</div>
                  <div>
                    {row.voucher_word}-{String(row.voucher_number).padStart(4, '0')}
                  </div>
                  <div>
                    <span
                      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold"
                      style={STATUS_BADGE_STYLE[row.status]}
                    >
                      {STATUS_TEXT[row.status]}
                    </span>
                  </div>
                  <div className="truncate pr-4" title={row.first_summary || '无摘要'}>
                    {row.first_summary || '-'}
                  </div>
                  <div className="text-right">
                    {new Decimal(row.total_debit).div(100).toFixed(2)}
                  </div>
                  <div className="text-right">
                    {new Decimal(row.total_credit).div(100).toFixed(2)}
                  </div>
                  <div className="text-right">{row.period}</div>
                </div>
              ))}

              {displayRows.length === 0 && !loading && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {emptyText}
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
              <span>{`借方合计：${totals.debit}`}</span>
              <span>{`贷方合计：${totals.credit}`}</span>
            </div>
          </div>
        </div>
      </div>

      {reverseBookkeepForm.open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.28)' }}
        >
          <div className="glass-panel w-full max-w-xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  反记账
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  已选 {selected.length} 张已记账凭证。请填写反记账原因和审批标记，系统将写入操作日志。
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-3 py-1 text-xs"
                onClick={closeReverseBookkeepDialog}
                disabled={reverseBookkeepForm.submitting}
              >
                关闭
              </button>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span style={{ color: 'var(--color-text-secondary)' }}>反记账原因</span>
              <textarea
                className="glass-input min-h-[112px] resize-y"
                value={reverseBookkeepForm.reason}
                onChange={(event) =>
                  setReverseBookkeepForm((prev) => ({ ...prev, reason: event.target.value }))
                }
                placeholder="请输入本次反记账的业务原因"
                disabled={reverseBookkeepForm.submitting}
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span style={{ color: 'var(--color-text-secondary)' }}>审批标记</span>
              <input
                className="glass-input"
                value={reverseBookkeepForm.approvalTag}
                onChange={(event) =>
                  setReverseBookkeepForm((prev) => ({
                    ...prev,
                    approvalTag: event.target.value
                  }))
                }
                placeholder="例如：负责人同意 / 工单号 / 审批单号"
                disabled={reverseBookkeepForm.submitting}
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={closeReverseBookkeepDialog}
                disabled={reverseBookkeepForm.submitting}
              >
                取消
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={() => void submitReverseBookkeep()}
                disabled={reverseBookkeepForm.submitting}
              >
                {reverseBookkeepForm.submitting ? '提交中...' : '确认反记账'}
              </button>
            </div>
          </div>
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
    </div>
  )
}

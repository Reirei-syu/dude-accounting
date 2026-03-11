import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import Decimal from 'decimal.js'
import { createPortal } from 'react-dom'
import { getCurrentYearDateRange, resolveAuxiliaryItemsForSubject } from './bookQueryUtils'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

interface ReturnTabTarget {
  id: string
  title: string
  componentType: string
  params?: Record<string, unknown>
}

interface AuxiliaryBalanceProps {
  presetStartDate?: string
  presetEndDate?: string
  presetSubjectCodeStart?: string
  presetSubjectCodeEnd?: string
  presetIncludeUnpostedVouchers?: boolean
  presetOpenPreview?: boolean
  returnTabOnPreviewClose?: ReturnTabTarget
  autoQuery?: boolean
  queryRequestKey?: number
}

interface AuxiliaryBalanceRow {
  subject_code: string
  subject_name: string
  auxiliary_item_id: number
  auxiliary_category: string
  auxiliary_code: string
  auxiliary_name: string
  opening_debit_amount: number
  opening_credit_amount: number
  period_debit_amount: number
  period_credit_amount: number
  ending_debit_amount: number
  ending_credit_amount: number
}

interface AuxiliaryBalanceContextMenuState {
  x: number
  y: number
  row: AuxiliaryBalanceRow
}

function formatAmount(amountCents: number): string {
  return new Decimal(amountCents).div(100).toFixed(2)
}

function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 180
  const menuHeight = 60
  const padding = 12

  const maxX = Math.max(padding, window.innerWidth - menuWidth - padding)
  const maxY = Math.max(padding, window.innerHeight - menuHeight - padding)

  return {
    x: Math.min(x, maxX),
    y: Math.min(y, maxY)
  }
}

function rowHasDetail(row: AuxiliaryBalanceRow): boolean {
  return (
    row.opening_debit_amount !== 0 ||
    row.opening_credit_amount !== 0 ||
    row.period_debit_amount !== 0 ||
    row.period_credit_amount !== 0 ||
    row.ending_debit_amount !== 0 ||
    row.ending_credit_amount !== 0
  )
}

export default function AuxiliaryBalance(props: AuxiliaryBalanceProps): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const openTab = useUIStore((state) => state.openTab)
  const defaultRange = useMemo(() => getCurrentYearDateRange(), [])

  const [dateFrom, setDateFrom] = useState(props.presetStartDate ?? defaultRange.startDate)
  const [dateTo, setDateTo] = useState(props.presetEndDate ?? defaultRange.endDate)
  const [subjectCodeStart, setSubjectCodeStart] = useState(props.presetSubjectCodeStart ?? '')
  const [subjectCodeEnd, setSubjectCodeEnd] = useState(props.presetSubjectCodeEnd ?? '')
  const [includeUnpostedVouchers, setIncludeUnpostedVouchers] = useState(
    props.presetIncludeUnpostedVouchers ?? false
  )
  const [subjectOptions, setSubjectOptions] = useState<Array<{ code: string; name: string }>>([])
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<AuxiliaryBalanceContextMenuState | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [rows, setRows] = useState<AuxiliaryBalanceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const executeQuery = async (overrides?: {
    dateFrom?: string
    dateTo?: string
    subjectCodeStart?: string
    subjectCodeEnd?: string
    includeUnpostedVouchers?: boolean
    openPreview?: boolean
  }): Promise<void> => {
    setError('')

    if (!currentLedger) {
      setRows([])
      setError('请先选择账套')
      return
    }

    if (currentLedger.standard_type !== 'npo') {
      setRows([])
      setError('当前开发阶段仅支持民非账套进行账簿查询测试')
      return
    }

    if (!window.electron) {
      setRows([])
      setError('浏览器预览模式不支持账簿查询')
      return
    }

    const nextDateFrom = overrides?.dateFrom ?? dateFrom
    const nextDateTo = overrides?.dateTo ?? dateTo
    const nextSubjectCodeStart = overrides?.subjectCodeStart ?? subjectCodeStart
    const nextSubjectCodeEnd = overrides?.subjectCodeEnd ?? subjectCodeEnd
    const nextIncludeUnposted = overrides?.includeUnpostedVouchers ?? includeUnpostedVouchers

    setLoading(true)
    try {
      const list = await window.api.bookQuery.getAuxiliaryBalances({
        ledgerId: currentLedger.id,
        startDate: nextDateFrom,
        endDate: nextDateTo,
        subjectCodeStart: nextSubjectCodeStart,
        subjectCodeEnd: nextSubjectCodeEnd,
        includeUnpostedVouchers: nextIncludeUnposted
      })

      setRows(list as AuxiliaryBalanceRow[])
      setActiveRowKey(null)
      setContextMenu(null)

      if (overrides?.openPreview) {
        setIsPreviewOpen(true)
      }
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : '加载辅助余额表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      const nextRange = getCurrentYearDateRange()
      const nextDateFrom = props.presetStartDate ?? nextRange.startDate
      const nextDateTo = props.presetEndDate ?? nextRange.endDate
      const nextSubjectCodeStart = props.presetSubjectCodeStart ?? ''
      const nextSubjectCodeEnd = props.presetSubjectCodeEnd ?? ''
      const nextIncludeUnposted = props.presetIncludeUnpostedVouchers ?? false
      const nextOpenPreview = props.presetOpenPreview ?? false

      setDateFrom(nextDateFrom)
      setDateTo(nextDateTo)
      setSubjectCodeStart(nextSubjectCodeStart)
      setSubjectCodeEnd(nextSubjectCodeEnd)
      setIncludeUnpostedVouchers(nextIncludeUnposted)
      setRows([])
      setActiveRowKey(null)
      setContextMenu(null)
      setIsPreviewOpen(false)
      setError('')

      if (!currentLedger || !window.electron || currentLedger.standard_type !== 'npo') {
        if (!cancelled) {
          setSubjectOptions([])
        }
        return
      }

      try {
        const [rawSubjects, rawAuxiliaryItems] = await Promise.all([
          window.api.subject.getAll(currentLedger.id),
          window.api.auxiliary.getAll(currentLedger.id)
        ])

        if (cancelled) {
          return
        }

        const nextSubjects = rawSubjects.map((subject) => ({
          code: subject.code,
          name: subject.name,
          has_auxiliary: subject.has_auxiliary,
          auxiliary_categories: subject.auxiliary_categories ?? [],
          auxiliary_custom_items: (subject.auxiliary_custom_items ?? []).map((item) => ({
            id: item.id,
            category: 'custom',
            code: item.code,
            name: item.name
          }))
        }))
        const nextAuxiliaryItems = rawAuxiliaryItems.map((item) => ({
          id: item.id,
          category: item.category,
          code: item.code,
          name: item.name
        }))
        const nextSubjectOptions = nextSubjects
          .filter(
            (subject) => resolveAuxiliaryItemsForSubject(subject, nextAuxiliaryItems).length > 0
          )
          .map((subject) => ({
            code: subject.code,
            name: subject.name
          }))
          .sort((left, right) => left.code.localeCompare(right.code))

        setSubjectOptions(nextSubjectOptions)

        if (props.autoQuery) {
          void executeQuery({
            dateFrom: nextDateFrom,
            dateTo: nextDateTo,
            subjectCodeStart: nextSubjectCodeStart,
            subjectCodeEnd: nextSubjectCodeEnd,
            includeUnpostedVouchers: nextIncludeUnposted,
            openPreview: nextOpenPreview
          })
        }
      } catch (err) {
        if (!cancelled) {
          setSubjectOptions([])
          setError(err instanceof Error ? err.message : '加载辅助项目失败')
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [
    currentLedger?.id,
    currentLedger?.current_period,
    props.autoQuery,
    props.presetEndDate,
    props.presetIncludeUnpostedVouchers,
    props.presetOpenPreview,
    props.presetStartDate,
    props.presetSubjectCodeEnd,
    props.presetSubjectCodeStart,
    props.queryRequestKey
  ])

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeMenu = (): void => setContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void executeQuery()
  }

  const handleOpenPreview = (): void => {
    void executeQuery({ openPreview: true })
  }

  const openAuxiliaryDetail = (row: AuxiliaryBalanceRow): void => {
    if (!rowHasDetail(row)) {
      return
    }

    setIsPreviewOpen(false)
    setContextMenu(null)
    openTab({
      id: 'auxiliary-detail',
      title: '辅助明细账',
      componentType: 'AuxiliaryDetail',
      params: {
        presetSubjectCode: row.subject_code,
        presetAuxiliaryItemId: row.auxiliary_item_id,
        presetStartDate: dateFrom,
        presetEndDate: dateTo,
        presetIncludeUnpostedVouchers: includeUnpostedVouchers,
        presetOpenPreview: isPreviewOpen,
        returnTabOnPreviewClose: isPreviewOpen
          ? {
              id: 'auxiliary-balance',
              title: '辅助余额表',
              componentType: 'AuxiliaryBalance',
              params: {
                presetStartDate: dateFrom,
                presetEndDate: dateTo,
                presetSubjectCodeStart: subjectCodeStart,
                presetSubjectCodeEnd: subjectCodeEnd,
                presetIncludeUnpostedVouchers: includeUnpostedVouchers,
                presetOpenPreview: true,
                autoQuery: true,
                queryRequestKey: Date.now()
              }
            }
          : undefined,
        autoQuery: true,
        queryRequestKey: Date.now()
      }
    })
  }

  const handleContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    row: AuxiliaryBalanceRow
  ): void => {
    event.preventDefault()
    const position = clampMenuPosition(event.clientX, event.clientY)
    setActiveRowKey(`${row.subject_code}:${row.auxiliary_item_id}`)
    setContextMenu({ ...position, row })
  }

  const renderTable = (tableRows: AuxiliaryBalanceRow[], fullHeight = false): JSX.Element => (
    <div className="h-full overflow-x-auto">
      <div className="min-w-[1280px] h-full">
        <div
          className="grid grid-cols-[120px_1.3fr_120px_120px_1.3fr_repeat(6,minmax(110px,1fr))] gap-3 border-b px-3 py-2 text-sm font-semibold"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div>科目编码</div>
          <div>科目名称</div>
          <div>辅助类别</div>
          <div>辅助编码</div>
          <div>辅助名称</div>
          <div className="text-right">期初借方</div>
          <div className="text-right">期初贷方</div>
          <div className="text-right">本期借方</div>
          <div className="text-right">本期贷方</div>
          <div className="text-right">期末借方</div>
          <div className="text-right">期末贷方</div>
        </div>

        <div
          className={
            fullHeight
              ? 'max-h-[calc(90vh-180px)] overflow-y-auto'
              : 'h-[calc(100%-41px)] overflow-y-auto'
          }
        >
          {tableRows.map((row) => {
            const rowKey = `${row.subject_code}:${row.auxiliary_item_id}`
            return (
              <div
                key={rowKey}
                className="grid grid-cols-[120px_1.3fr_120px_120px_1.3fr_repeat(6,minmax(110px,1fr))] gap-3 border-b px-3 py-2 text-sm transition-colors hover:bg-black/5 cursor-context-menu"
                style={{
                  borderColor: 'var(--color-glass-border-light)',
                  color: 'var(--color-text-secondary)',
                  background: activeRowKey === rowKey ? 'rgba(15, 23, 42, 0.08)' : 'transparent'
                }}
                onClick={() => {
                  setActiveRowKey(rowKey)
                  setContextMenu(null)
                }}
                onContextMenu={(event) => handleContextMenu(event, row)}
              >
                <div>{row.subject_code}</div>
                <div>{row.subject_name}</div>
                <div>{row.auxiliary_category}</div>
                <div>{row.auxiliary_code}</div>
                <div>{row.auxiliary_name}</div>
                <div className="text-right">{formatAmount(row.opening_debit_amount)}</div>
                <div className="text-right">{formatAmount(row.opening_credit_amount)}</div>
                <div className="text-right">{formatAmount(row.period_debit_amount)}</div>
                <div className="text-right">{formatAmount(row.period_credit_amount)}</div>
                <div className="text-right">{formatAmount(row.ending_debit_amount)}</div>
                <div className="text-right">{formatAmount(row.ending_credit_amount)}</div>
              </div>
            )
          })}

          {tableRows.length === 0 && !loading && (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              暂无数据
            </div>
          )}
        </div>
      </div>
    </div>
  )

  const renderInteractiveContextMenu = (): JSX.Element | null => {
    if (!contextMenu) {
      return null
    }

    return (
      <div
        className="fixed z-[260] min-w-[180px] rounded-xl border bg-white/95 p-1 shadow-xl backdrop-blur-md"
        style={{
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          borderColor: 'var(--color-glass-border-light)',
          color: 'var(--color-text-primary)'
        }}
      >
        <button
          type="button"
          className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!rowHasDetail(contextMenu.row)}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openAuxiliaryDetail(contextMenu.row)
          }}
        >
          查询辅助明细账
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          辅助余额表
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          支持按日期范围、科目范围和未记账口径查询辅助余额。辅助期初当前按历史凭证滚算，不拆分科目期初数。
        </p>
      </div>

      <form className="glass-panel-light flex flex-col gap-3 p-3" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className="text-sm"
            htmlFor="aux-balance-date-from"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            从
          </label>
          <input
            id="aux-balance-date-from"
            type="date"
            className="glass-input px-3 py-2 text-sm"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <label
            className="text-sm"
            htmlFor="aux-balance-date-to"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            到
          </label>
          <input
            id="aux-balance-date-to"
            type="date"
            className="glass-input px-3 py-2 text-sm"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
          <button className="glass-btn-secondary px-5 py-2" type="submit">
            {loading ? '查询中...' : '查询'}
          </button>
          <button
            className="glass-btn-secondary px-5 py-2"
            type="button"
            onClick={handleOpenPreview}
          >
            {loading ? '查询中...' : '全屏查看'}
          </button>
          <label
            className="inline-flex items-center gap-2 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={includeUnpostedVouchers}
              onChange={(event) => setIncludeUnpostedVouchers(event.target.checked)}
            />
            未记账凭证
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label
            className="text-sm"
            htmlFor="aux-balance-range-start"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            科目范围
          </label>
          <select
            id="aux-balance-range-start"
            className="glass-input min-w-[220px] px-3 py-2 text-sm"
            value={subjectCodeStart}
            onChange={(event) => setSubjectCodeStart(event.target.value)}
          >
            <option value="">全部辅助科目（起点）</option>
            {subjectOptions.map((subject) => (
              <option key={`aux-balance-start-${subject.code}`} value={subject.code}>
                {subject.code} {subject.name}
              </option>
            ))}
          </select>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            至
          </span>
          <select
            id="aux-balance-range-end"
            className="glass-input min-w-[220px] px-3 py-2 text-sm"
            value={subjectCodeEnd}
            onChange={(event) => setSubjectCodeEnd(event.target.value)}
          >
            <option value="">全部辅助科目（终点）</option>
            {subjectOptions.map((subject) => (
              <option key={`aux-balance-end-${subject.code}`} value={subject.code}>
                {subject.code} {subject.name}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className="glass-panel flex-1 overflow-hidden">{renderTable(rows)}</div>

      {contextMenu && !isPreviewOpen && createPortal(renderInteractiveContextMenu(), document.body)}

      {error && (
        <div style={{ color: 'var(--color-danger)' }} aria-live="polite">
          {error}
        </div>
      )}

      <Dialog.Root
        open={isPreviewOpen}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setIsPreviewOpen(true)
            return
          }

          setContextMenu(null)
          setIsPreviewOpen(false)
          if (props.returnTabOnPreviewClose) {
            openTab(props.returnTabOnPreviewClose)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[180] bg-black/35 backdrop-blur-sm" />
          <Dialog.Content
            className="glass-panel-light fixed inset-[24px] z-[190] overflow-hidden p-4 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.92)' }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Dialog.Title
                  className="text-lg font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  辅助余额表
                </Dialog.Title>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {dateFrom} 至 {dateTo}
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                onClick={() => setIsPreviewOpen(false)}
              >
                关闭
              </button>
            </div>

            {contextMenu && isPreviewOpen && renderInteractiveContextMenu()}
            <div className="h-[calc(100%-64px)]">{renderTable(rows, true)}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

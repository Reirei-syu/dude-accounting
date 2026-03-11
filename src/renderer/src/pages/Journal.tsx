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
import { getPeriodDateRange, type SubjectOption } from './bookQueryUtils'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

interface JournalProps {
  presetStartDate?: string
  presetEndDate?: string
  presetSubjectCodeStart?: string
  presetSubjectCodeEnd?: string
  presetIncludeUnpostedVouchers?: boolean
  presetOpenPreview?: boolean
  autoQuery?: boolean
  queryRequestKey?: number
}

interface JournalRow {
  entry_id: number
  voucher_id: number
  voucher_date: string
  voucher_number: number
  voucher_word: string
  summary: string
  subject_code: string
  subject_name: string
  debit_amount: number
  credit_amount: number
}

interface JournalContextMenuState {
  x: number
  y: number
  row: JournalRow
}

function formatAmount(amountCents: number): string {
  return new Decimal(amountCents).div(100).toFixed(2)
}

function getCurrentPeriod(): string {
  return new Date().toISOString().slice(0, 7)
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

export default function Journal(props: JournalProps): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const openTab = useUIStore((state) => state.openTab)
  const defaultPeriod = useMemo(getCurrentPeriod, [])
  const defaultRange = useMemo(
    () => getPeriodDateRange(currentLedger?.current_period ?? defaultPeriod),
    [currentLedger?.current_period, defaultPeriod]
  )

  const [dateFrom, setDateFrom] = useState(props.presetStartDate ?? defaultRange.startDate)
  const [dateTo, setDateTo] = useState(props.presetEndDate ?? defaultRange.endDate)
  const [subjectCodeStart, setSubjectCodeStart] = useState(props.presetSubjectCodeStart ?? '')
  const [subjectCodeEnd, setSubjectCodeEnd] = useState(props.presetSubjectCodeEnd ?? '')
  const [includeUnpostedVouchers, setIncludeUnpostedVouchers] = useState(
    props.presetIncludeUnpostedVouchers ?? false
  )
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([])
  const [activeEntryId, setActiveEntryId] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<JournalContextMenuState | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [rows, setRows] = useState<JournalRow[]>([])
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
      const list = await window.api.bookQuery.getJournal({
        ledgerId: currentLedger.id,
        startDate: nextDateFrom,
        endDate: nextDateTo,
        subjectCodeStart: nextSubjectCodeStart,
        subjectCodeEnd: nextSubjectCodeEnd,
        includeUnpostedVouchers: nextIncludeUnposted
      })

      setRows(list as JournalRow[])
      setActiveEntryId(null)
      setContextMenu(null)

      if (overrides?.openPreview) {
        setIsPreviewOpen(true)
      }
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : '加载序时账失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      const nextRange = getPeriodDateRange(currentLedger?.current_period ?? defaultPeriod)
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
      setActiveEntryId(null)
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
        const rawSubjects = (await window.api.subject.getAll(currentLedger.id)) as SubjectOption[]
        const nextSubjectOptions = rawSubjects
          .map((subject) => ({
            code: subject.code,
            name: subject.name
          }))
          .sort((left, right) => left.code.localeCompare(right.code))

        if (cancelled) {
          return
        }

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
          setError(err instanceof Error ? err.message : '加载科目失败')
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
    defaultPeriod,
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

  const openVoucherEntry = (row: JournalRow): void => {
    setIsPreviewOpen(false)
    setContextMenu(null)
    openTab({
      id: 'voucher-entry',
      title: '凭证录入',
      componentType: 'VoucherEntry',
      params: {
        editVoucherId: row.voucher_id,
        editRequestKey: Date.now()
      }
    })
  }

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>, row: JournalRow): void => {
    event.preventDefault()
    const position = clampMenuPosition(event.clientX, event.clientY)
    setActiveEntryId(row.entry_id)
    setContextMenu({ ...position, row })
  }

  const renderTable = (tableRows: JournalRow[], fullHeight = false): JSX.Element => (
    <div className="h-full overflow-x-auto">
      <div className="min-w-[1120px] h-full">
        <div
          className="grid grid-cols-[120px_130px_2fr_120px_1.4fr_120px_120px] gap-3 py-2 px-3 border-b text-sm font-semibold"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div>日期</div>
          <div>凭证号</div>
          <div>摘要</div>
          <div>科目编码</div>
          <div>科目名称</div>
          <div className="text-right">借方</div>
          <div className="text-right">贷方</div>
        </div>

        <div
          className={
            fullHeight
              ? 'max-h-[calc(90vh-180px)] overflow-y-auto'
              : 'h-[calc(100%-41px)] overflow-y-auto'
          }
        >
          {tableRows.map((row) => (
            <div
              key={row.entry_id}
              className="grid grid-cols-[120px_130px_2fr_120px_1.4fr_120px_120px] gap-3 py-2 px-3 border-b text-sm cursor-context-menu transition-colors hover:bg-black/5"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-secondary)',
                background:
                  activeEntryId === row.entry_id ? 'rgba(15, 23, 42, 0.08)' : 'transparent'
              }}
              onClick={() => {
                setActiveEntryId(row.entry_id)
                setContextMenu(null)
              }}
              onContextMenu={(event) => handleContextMenu(event, row)}
            >
              <div>{row.voucher_date}</div>
              <div>
                {row.voucher_word}-{String(row.voucher_number).padStart(4, '0')}
              </div>
              <div>{row.summary}</div>
              <div>{row.subject_code}</div>
              <div>{row.subject_name}</div>
              <div className="text-right">{formatAmount(row.debit_amount)}</div>
              <div className="text-right">{formatAmount(row.credit_amount)}</div>
            </div>
          ))}

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
          className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-black/5"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openVoucherEntry(contextMenu.row)
          }}
        >
          查询凭证
        </button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          序时账
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          支持按日期范围、科目范围和未记账口径查询序时账。右键明细行可直接查询凭证。
        </p>
      </div>

      <form className="glass-panel-light p-3 flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="flex items-center gap-3 flex-wrap">
          <label
            className="text-sm"
            htmlFor="journal-date-from"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            从
          </label>
          <input
            id="journal-date-from"
            type="date"
            className="glass-input px-3 py-2 text-sm"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <label
            className="text-sm"
            htmlFor="journal-date-to"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            到
          </label>
          <input
            id="journal-date-to"
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

        <div className="flex items-center gap-3 flex-wrap">
          <label
            className="text-sm"
            htmlFor="journal-range-start"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            科目范围
          </label>
          <select
            id="journal-range-start"
            className="glass-input px-3 py-2 text-sm min-w-[220px]"
            value={subjectCodeStart}
            onChange={(event) => setSubjectCodeStart(event.target.value)}
          >
            <option value="">全部科目（起点）</option>
            {subjectOptions.map((subject) => (
              <option key={`journal-start-${subject.code}`} value={subject.code}>
                {subject.code} {subject.name}
              </option>
            ))}
          </select>
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            至
          </span>
          <select
            id="journal-range-end"
            className="glass-input px-3 py-2 text-sm min-w-[220px]"
            value={subjectCodeEnd}
            onChange={(event) => setSubjectCodeEnd(event.target.value)}
          >
            <option value="">全部科目（终点）</option>
            {subjectOptions.map((subject) => (
              <option key={`journal-end-${subject.code}`} value={subject.code}>
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

      <Dialog.Root open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
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
                  序时账
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

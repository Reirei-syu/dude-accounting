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
import { getBalanceSideLabel, getPeriodDateRange, type SubjectOption } from './bookQueryUtils'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

interface ReturnTabTarget {
  id: string
  title: string
  componentType: string
  params?: Record<string, unknown>
}

interface DetailLedgerProps {
  presetStartDate?: string
  presetEndDate?: string
  presetSubjectCode?: string
  presetIncludeUnpostedVouchers?: boolean
  presetOpenPreview?: boolean
  returnTabOnPreviewClose?: ReturnTabTarget
  autoQuery?: boolean
  queryRequestKey?: number
}

interface DetailLedgerRow {
  row_type: 'opening' | 'entry'
  voucher_id: number | null
  voucher_date: string
  voucher_number: number | null
  voucher_word: string | null
  summary: string
  debit_amount: number
  credit_amount: number
  balance_amount: number
  balance_side: 'debit' | 'credit' | 'flat'
}

interface DetailContextMenuState {
  x: number
  y: number
  row: DetailLedgerRow
  rowKey: string
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

export default function DetailLedger(props: DetailLedgerProps): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const openTab = useUIStore((state) => state.openTab)
  const defaultPeriod = useMemo(getCurrentPeriod, [])
  const defaultRange = useMemo(
    () => getPeriodDateRange(currentLedger?.current_period ?? defaultPeriod),
    [currentLedger?.current_period, defaultPeriod]
  )

  const [dateFrom, setDateFrom] = useState(props.presetStartDate ?? defaultRange.startDate)
  const [dateTo, setDateTo] = useState(props.presetEndDate ?? defaultRange.endDate)
  const [subjectCode, setSubjectCode] = useState(props.presetSubjectCode ?? '')
  const [includeUnpostedVouchers, setIncludeUnpostedVouchers] = useState(
    props.presetIncludeUnpostedVouchers ?? false
  )
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [rows, setRows] = useState<DetailLedgerRow[]>([])
  const [subjectName, setSubjectName] = useState('')
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<DetailContextMenuState | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selectedSubject = subjects.find((item) => item.code === subjectCode)

  const executeQuery = async (overrides?: {
    subjectCode?: string
    dateFrom?: string
    dateTo?: string
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

    const nextSubjectCode = overrides?.subjectCode ?? subjectCode
    const nextDateFrom = overrides?.dateFrom ?? dateFrom
    const nextDateTo = overrides?.dateTo ?? dateTo
    const nextIncludeUnposted = overrides?.includeUnpostedVouchers ?? includeUnpostedVouchers

    if (!nextSubjectCode) {
      setRows([])
      setError('请选择科目')
      return
    }

    setLoading(true)
    try {
      const detail = await window.api.bookQuery.getDetailLedger({
        ledgerId: currentLedger.id,
        subjectCode: nextSubjectCode,
        startDate: nextDateFrom,
        endDate: nextDateTo,
        includeUnpostedVouchers: nextIncludeUnposted
      })

      setRows(detail.rows as DetailLedgerRow[])
      setSubjectName(detail.subject.name)
      setSelectedRowKey(null)
      setContextMenu(null)

      if (overrides?.openPreview) {
        setIsPreviewOpen(true)
      }
    } catch (err) {
      setRows([])
      setSubjectName('')
      setError(err instanceof Error ? err.message : '加载科目明细账失败')
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
      const nextIncludeUnposted = props.presetIncludeUnpostedVouchers ?? false
      const nextOpenPreview = props.presetOpenPreview ?? false

      setDateFrom(nextDateFrom)
      setDateTo(nextDateTo)
      setIncludeUnpostedVouchers(nextIncludeUnposted)
      setRows([])
      setSubjectName('')
      setSelectedRowKey(null)
      setContextMenu(null)
      setIsPreviewOpen(false)
      setError('')

      if (!currentLedger || !window.electron || currentLedger.standard_type !== 'npo') {
        if (!cancelled) {
          setSubjects([])
          setSubjectCode(props.presetSubjectCode ?? '')
        }
        return
      }

      try {
        const rawSubjects = (await window.api.subject.getAll(currentLedger.id)) as SubjectOption[]
        const nextSubjects = rawSubjects
          .map((item) => ({
            code: item.code,
            name: item.name
          }))
          .sort((left, right) => left.code.localeCompare(right.code))

        if (cancelled) {
          return
        }

        setSubjects(nextSubjects)

        const nextSubjectCode =
          props.presetSubjectCode ??
          nextSubjects.find((item) => item.code === subjectCode)?.code ??
          nextSubjects[0]?.code ??
          ''

        setSubjectCode(nextSubjectCode)

        if (props.autoQuery && nextSubjectCode) {
          void executeQuery({
            subjectCode: nextSubjectCode,
            dateFrom: nextDateFrom,
            dateTo: nextDateTo,
            includeUnpostedVouchers: nextIncludeUnposted,
            openPreview: nextOpenPreview
          })
        }
      } catch (err) {
        if (!cancelled) {
          setSubjects([])
          setSubjectCode('')
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
    props.presetSubjectCode,
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

  const handlePreviewOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setIsPreviewOpen(true)
      return
    }

    setContextMenu(null)
    setIsPreviewOpen(false)

    if (props.returnTabOnPreviewClose) {
      openTab(props.returnTabOnPreviewClose)
    }
  }

  const openVoucherQuery = (row: DetailLedgerRow): void => {
    if (!row.voucher_id || !row.voucher_date) {
      return
    }

    setIsPreviewOpen(false)
    setContextMenu(null)
    openTab({
      id: 'voucher-query',
      title: '凭证查询',
      componentType: 'VoucherQuery',
      params: {
        presetVoucherId: row.voucher_id,
        presetDateFrom: row.voucher_date,
        presetDateTo: row.voucher_date,
        autoQuery: true,
        queryRequestKey: Date.now()
      }
    })
  }

  const handleContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    row: DetailLedgerRow,
    rowKey: string
  ): void => {
    event.preventDefault()
    const position = clampMenuPosition(event.clientX, event.clientY)
    setSelectedRowKey(rowKey)
    setContextMenu({ ...position, row, rowKey })
  }

  const renderTable = (tableRows: DetailLedgerRow[], fullHeight = false): JSX.Element => (
    <div className="h-full overflow-x-auto">
      <div className="min-w-[980px] h-full">
        <div
          className="grid grid-cols-[120px_130px_2fr_120px_120px_90px_120px] gap-3 py-2 px-3 border-b text-sm font-semibold"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div>日期</div>
          <div>凭证号</div>
          <div>摘要</div>
          <div className="text-right">借方</div>
          <div className="text-right">贷方</div>
          <div className="text-center">方向</div>
          <div className="text-right">余额</div>
        </div>

        <div
          className={
            fullHeight
              ? 'max-h-[calc(90vh-180px)] overflow-y-auto'
              : 'h-[calc(100%-41px)] overflow-y-auto'
          }
        >
          {tableRows.map((row, index) => {
            const rowKey =
              row.row_type === 'opening'
                ? 'opening'
                : `${row.voucher_id ?? 'voucher'}-${row.voucher_date}-${index}`

            return (
              <div
                key={rowKey}
                className={`grid grid-cols-[120px_130px_2fr_120px_120px_90px_120px] gap-3 py-2 px-3 border-b text-sm transition-colors ${
                  row.row_type === 'entry'
                    ? 'cursor-context-menu hover:bg-black/5'
                    : 'cursor-default'
                }`}
                style={{
                  borderColor: 'var(--color-glass-border-light)',
                  color: 'var(--color-text-secondary)',
                  background: selectedRowKey === rowKey ? 'rgba(15, 23, 42, 0.08)' : 'transparent'
                }}
                onClick={() => {
                  setSelectedRowKey(rowKey)
                  setContextMenu(null)
                }}
                onContextMenu={(event) => handleContextMenu(event, row, rowKey)}
              >
                <div>{row.voucher_date || '-'}</div>
                <div>
                  {row.voucher_word && row.voucher_number !== null
                    ? `${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}`
                    : '-'}
                </div>
                <div>{row.summary}</div>
                <div className="text-right">{formatAmount(row.debit_amount)}</div>
                <div className="text-right">{formatAmount(row.credit_amount)}</div>
                <div className="text-center">{getBalanceSideLabel(row.balance_side)}</div>
                <div className="text-right">{formatAmount(row.balance_amount)}</div>
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
          className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={contextMenu.row.row_type !== 'entry' || !contextMenu.row.voucher_id}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openVoucherQuery(contextMenu.row)
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
          科目明细账
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          当前支持按区间查看科目明细账。右键业务行可查询凭证。
        </p>
      </div>

      <form className="glass-panel-light p-3 flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="flex items-center gap-3 flex-wrap">
          <label
            className="text-sm"
            htmlFor="detail-ledger-date-from"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            从
          </label>
          <input
            id="detail-ledger-date-from"
            type="date"
            className="glass-input px-3 py-2 text-sm"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
          <label
            className="text-sm"
            htmlFor="detail-ledger-date-to"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            到
          </label>
          <input
            id="detail-ledger-date-to"
            type="date"
            className="glass-input px-3 py-2 text-sm"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
          <label
            className="text-sm"
            htmlFor="detail-ledger-subject"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            科目
          </label>
          <select
            id="detail-ledger-subject"
            className="glass-input px-3 py-2 text-sm min-w-[260px]"
            value={subjectCode}
            onChange={(event) => {
              setSubjectCode(event.target.value)
              setSubjectName(subjects.find((item) => item.code === event.target.value)?.name ?? '')
            }}
          >
            {subjects.length === 0 && <option value="">暂无科目</option>}
            {subjects.map((subject) => (
              <option key={subject.code} value={subject.code}>
                {subject.code} {subject.name}
              </option>
            ))}
          </select>
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
        </div>

        <div className="flex items-center gap-6 flex-wrap">
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
      </form>

      <div
        className="glass-panel-light p-3 text-sm"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        当前科目：
        {subjectCode ? `${subjectCode} ${subjectName || selectedSubject?.name || ''}` : '未选择'}
      </div>

      <div className="glass-panel flex-1 overflow-hidden">{renderTable(rows)}</div>

      {contextMenu && !isPreviewOpen && createPortal(renderInteractiveContextMenu(), document.body)}
      {false &&
        contextMenu &&
        createPortal(
          <div
            className="fixed z-[260] min-w-[180px] rounded-xl border bg-white/95 p-1 shadow-xl backdrop-blur-md"
            style={{
              left: `${contextMenu!.x}px`,
              top: `${contextMenu!.y}px`,
              borderColor: 'var(--color-glass-border-light)',
              color: 'var(--color-text-primary)'
            }}
          >
            <button
              type="button"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/5 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={contextMenu!.row.row_type !== 'entry' || !contextMenu!.row.voucher_id}
              onClick={() => openVoucherQuery(contextMenu!.row)}
            >
              查询凭证
            </button>
          </div>,
          document.body
        )}

      {error && (
        <div style={{ color: 'var(--color-danger)' }} aria-live="polite">
          {error}
        </div>
      )}

      <Dialog.Root open={isPreviewOpen} onOpenChange={handlePreviewOpenChange}>
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
                  科目明细账
                </Dialog.Title>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {subjectCode
                    ? `${subjectCode} ${subjectName || selectedSubject?.name || ''}`
                    : '未选择科目'}
                  {' · '}
                  {dateFrom} 至 {dateTo}
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                onClick={() => handlePreviewOpenChange(false)}
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

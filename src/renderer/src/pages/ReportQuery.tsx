import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type SetStateAction
} from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import { buildReportFilterOptions, filterReportSnapshots } from './reportingQueryUtils'
import {
  ReportSnapshotViewer,
  formatGeneratedAt,
  getReportTypeLabel,
  type ReportSnapshotDetail,
  type ReportSnapshotSummary,
  type ReportType
} from './reportingShared'
import { prepareAndOpenPrintPreview } from './printUtils'

function toggleValue<T extends string | number>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

interface DateParts {
  year: string
  month: string
  day: string
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getLastDay(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function toDateString(parts: DateParts): string | null {
  if (!parts.year || !parts.month || !parts.day) {
    return null
  }
  return `${parts.year}-${parts.month}-${parts.day}`
}

function clampDay(parts: DateParts): DateParts {
  if (!parts.year || !parts.month || !parts.day) {
    return parts
  }
  const lastDay = getLastDay(Number(parts.year), Number(parts.month))
  return {
    ...parts,
    day: pad2(Math.min(Number(parts.day), lastDay))
  }
}

function buildYearOptions(minDate: string | null, maxDate: string | null, currentYear: number): string[] {
  const minYear = minDate ? Number(minDate.slice(0, 4)) : currentYear
  const maxYear = maxDate ? Number(maxDate.slice(0, 4)) : currentYear
  const startYear = Math.min(minYear, currentYear)
  const endYear = Math.max(maxYear, currentYear)
  const years: string[] = []
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(String(year))
  }
  return years
}

export default function ReportQuery(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const now = useMemo(() => new Date(), [])
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const currentMonthLastDay = getLastDay(currentYear, currentMonth)
  const [rows, setRows] = useState<ReportSnapshotSummary[]>([])
  const [selectedReportTypes, setSelectedReportTypes] = useState<ReportType[]>([])
  const [startDateParts, setStartDateParts] = useState<DateParts>({
    year: String(currentYear),
    month: '01',
    day: '01'
  })
  const [endDateParts, setEndDateParts] = useState<DateParts>({
    year: String(currentYear),
    month: pad2(currentMonth),
    day: pad2(currentMonthLastDay)
  })
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null)
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<number[]>([])
  const [detail, setDetail] = useState<ReportSnapshotDetail | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'pdf' | null>(null)
  const [queryHeaderFade, setQueryHeaderFade] = useState(0)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const selectedStartDate = toDateString(startDateParts)
  const selectedEndDate = toDateString(endDateParts)
  const filteredRows = filterReportSnapshots(rows, {
    reportTypes: selectedReportTypes,
    startDate: selectedStartDate,
    endDate: selectedEndDate
  })
  const filterOptions = buildReportFilterOptions(rows)
  const yearOptions = buildYearOptions(filterOptions.minDate, filterOptions.maxDate, currentYear)
  const monthOptions = Array.from({ length: 12 }, (_, index) => pad2(index + 1))
  const startDayOptions = Array.from(
    { length: startDateParts.year && startDateParts.month ? getLastDay(Number(startDateParts.year), Number(startDateParts.month)) : 31 },
    (_, index) => pad2(index + 1)
  )
  const endDayOptions = Array.from(
    { length: endDateParts.year && endDateParts.month ? getLastDay(Number(endDateParts.year), Number(endDateParts.month)) : 31 },
    (_, index) => pad2(index + 1)
  )
  const exportTargetIds =
    selectedSnapshotIds.length > 0
      ? selectedSnapshotIds
      : selectedSnapshotId !== null
        ? [selectedSnapshotId]
        : []
  const deleteTargetIds =
    selectedSnapshotIds.length > 0
      ? selectedSnapshotIds
      : selectedSnapshotId !== null
        ? [selectedSnapshotId]
        : []
  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedSnapshotIds.includes(row.id))
  const compactToolbarOpacity = queryHeaderFade
  const compactToolbarTranslateY = `${(1 - queryHeaderFade) * -10}px`
  const queryHeaderOpacity = 1 - queryHeaderFade
  const queryHeaderTranslateY = `${queryHeaderFade * -14}px`

  const renderActionButtons = (compact = false): JSX.Element => (
    <div className={`flex flex-wrap ${compact ? 'gap-2' : 'gap-3'}`}>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void loadRows()}
        disabled={loadingList}
      >
        {loadingList ? '刷新中...' : '刷新清单'}
      </button>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void loadDetail(selectedSnapshotId)}
        disabled={loadingDetail || selectedSnapshotId === null}
      >
        {loadingDetail ? '查询中...' : '查询详情'}
      </button>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void handleDelete()}
        disabled={deleting || deleteTargetIds.length === 0}
      >
        {deleting
          ? deleteTargetIds.length > 1
            ? '批量删除中...'
            : '删除中...'
          : deleteTargetIds.length > 1
            ? '批量删除'
            : '删除报表'}
      </button>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void handleBatchPrint()}
        disabled={exportTargetIds.length === 0}
      >
        {exportTargetIds.length > 1 ? '批量打印预览' : '打印预览'}
      </button>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void handleBatchExport('xlsx')}
        disabled={exportingFormat !== null || exportTargetIds.length === 0}
      >
        {exportingFormat === 'xlsx'
          ? exportTargetIds.length > 1
            ? '批量导出中...'
            : '导出中...'
          : exportTargetIds.length > 1
            ? '批量导出 Excel'
            : '导出 Excel'}
      </button>
      <button
        type="button"
        className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
        onClick={() => void handleBatchExport('pdf')}
        disabled={exportingFormat !== null || exportTargetIds.length === 0}
      >
        {exportingFormat === 'pdf'
          ? exportTargetIds.length > 1
            ? '批量导出中...'
            : '导出中...'
          : exportTargetIds.length > 1
            ? '批量导出 PDF'
            : '导出 PDF'}
      </button>
    </div>
  )

  const loadRows = async (): Promise<void> => {
    setError('')
    setSuccessMessage('')
    setDetail(null)
    setIsDetailOpen(false)
    setSelectedSnapshotId(null)
    setSelectedSnapshotIds([])

    if (!currentLedger) {
      setRows([])
      return
    }
    if (!window.electron) {
      setRows([])
      setError('浏览器预览模式不支持报表查询')
      return
    }

    setLoadingList(true)
    try {
      const summaries = await window.api.reporting.list({ ledgerId: currentLedger.id })
      setRows(summaries)
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : '加载报表清单失败')
    } finally {
      setLoadingList(false)
    }
  }

  const loadDetail = async (snapshotId: number | null): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!snapshotId || !currentLedger) {
      setError('请先从清单中选择一张报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表查询')
      return
    }

    setLoadingDetail(true)
    try {
      const nextDetail = await window.api.reporting.getDetail({
        snapshotId,
        ledgerId: currentLedger.id
      })
      setDetail(nextDetail)
      setIsDetailOpen(true)
    } catch (err) {
      setDetail(null)
      setError(err instanceof Error ? err.message : '加载报表详情失败')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (deleteTargetIds.length === 0 || !currentLedger) {
      setError('请先勾选至少一张报表，或先单击选中一张报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表删除')
      return
    }
    const confirmed =
      deleteTargetIds.length === 1
        ? window.confirm(
            `确定要删除报表【${rows.find((row) => row.id === deleteTargetIds[0])?.report_name || '未命名报表'}】吗？`
          )
        : window.confirm(`确定要批量删除已勾选的 ${deleteTargetIds.length} 张报表吗？`)
    if (!confirmed) {
      return
    }

    setDeleting(true)
    try {
      const deletedIds: number[] = []
      for (const snapshotId of deleteTargetIds) {
        const result = await window.api.reporting.delete({
          snapshotId,
          ledgerId: currentLedger.id
        })
        if (!result.success) {
          setError(result.error || '删除报表失败')
          return
        }
        deletedIds.push(snapshotId)
      }

      setRows((current) => current.filter((row) => !deletedIds.includes(row.id)))
      setSelectedSnapshotIds((current) => current.filter((id) => !deletedIds.includes(id)))
      if (detail && deletedIds.includes(detail.id)) {
        setDetail(null)
        setIsDetailOpen(false)
      }
      if (selectedSnapshotId !== null && deletedIds.includes(selectedSnapshotId)) {
        setSelectedSnapshotId(null)
      }
      setSuccessMessage(
        deletedIds.length > 1 ? `已批量删除 ${deletedIds.length} 张报表` : '报表已删除'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除报表失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleSingleExport = async (
    snapshotId: number,
    format: 'xlsx' | 'pdf'
  ): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!snapshotId || !currentLedger) {
      setError('请先从清单中选择一张报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表导出')
      return
    }

    setExportingFormat(format)
    try {
      const result = await window.api.reporting.export({
        snapshotId,
        ledgerId: currentLedger.id,
        format
      })
      if (result.cancelled) {
        return
      }
      if (!result.success) {
        setError(result.error || '导出报表失败')
        return
      }
      setSuccessMessage(`报表已导出：${result.filePath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出报表失败')
    } finally {
      setExportingFormat(null)
    }
  }

  const handleBatchExport = async (format: 'xlsx' | 'pdf'): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!currentLedger) {
      setError('请先选择账套')
      return
    }
    if (exportTargetIds.length === 0) {
      setError('请先勾选至少一张报表，或先单击选中一张报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表导出')
      return
    }

    if (exportTargetIds.length === 1) {
      await handleSingleExport(exportTargetIds[0], format)
      return
    }

    setExportingFormat(format)
    try {
      const result = await window.api.reporting.exportBatch({
        snapshotIds: exportTargetIds,
        ledgerId: currentLedger.id,
        format
      })
      if (result.cancelled) {
        return
      }
      if (!result.success) {
        setError(result.error || '批量导出报表失败')
        return
      }
      setSuccessMessage(`已批量导出 ${result.filePaths?.length ?? 0} 份报表：${result.directoryPath}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量导出报表失败')
    } finally {
      setExportingFormat(null)
    }
  }

  const handleSinglePrint = async (snapshotId: number): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!currentLedger) {
      setError('请先选择账套')
      return
    }

    const result = await prepareAndOpenPrintPreview({
      type: 'report',
      snapshotId,
      ledgerId: currentLedger.id
    })
    if (!result.success) {
      setError(result.error || '打开打印预览失败')
      return
    }
    setSuccessMessage('已打开报表打印预览')
  }

  const handleBatchPrint = async (): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!currentLedger) {
      setError('请先选择账套')
      return
    }
    if (exportTargetIds.length === 0) {
      setError('请先勾选至少一张报表，或先单击选中一张报表')
      return
    }

    const result = await prepareAndOpenPrintPreview(
      exportTargetIds.length === 1
        ? {
            type: 'report',
            snapshotId: exportTargetIds[0],
            ledgerId: currentLedger.id
          }
        : {
            type: 'batch',
            batchType: 'report',
            snapshotIds: exportTargetIds,
            ledgerId: currentLedger.id
          }
    )
    if (!result.success) {
      setError(result.error || '打开打印预览失败')
      return
    }
    setSuccessMessage(
      exportTargetIds.length > 1 ? `已打开 ${exportTargetIds.length} 份报表的批量打印预览` : '已打开报表打印预览'
    )
  }

  useEffect(() => {
    void loadRows()
  }, [currentLedger?.id])

  useEffect(() => {
    setSelectedReportTypes([])
    setStartDateParts({
      year: String(currentYear),
      month: '01',
      day: '01'
    })
    setEndDateParts({
      year: String(currentYear),
      month: pad2(currentMonth),
      day: pad2(currentMonthLastDay)
    })
  }, [currentLedger?.id])

  useEffect(() => {
    if (
      selectedSnapshotId !== null &&
      !filteredRows.some((row) => row.id === selectedSnapshotId)
    ) {
      setSelectedSnapshotId(null)
      setDetail(null)
      setIsDetailOpen(false)
    }
  }, [filteredRows, selectedSnapshotId])

  useEffect(() => {
    setSelectedSnapshotIds((current) =>
      current.filter((snapshotId) => filteredRows.some((row) => row.id === snapshotId))
    )
  }, [filteredRows])

  useEffect(() => {
    setStartDateParts((current) => clampDay(current))
  }, [startDateParts.year, startDateParts.month])

  useEffect(() => {
    setEndDateParts((current) => clampDay(current))
  }, [endDateParts.year, endDateParts.month])

  const updateDateParts = (
    setter: Dispatch<SetStateAction<DateParts>>,
    key: keyof DateParts,
    value: string
  ): void => {
    setter((current) => clampDay({ ...current, [key]: value }))
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto overflow-x-hidden pr-2"
      onScroll={(event) => {
        const nextFade = Math.max(
          0,
          Math.min(event.currentTarget.scrollTop / 120, 1)
        )
        setQueryHeaderFade(nextFade)
      }}
    >
      <div className="min-h-full flex flex-col gap-4 p-4">
        <div
          className="sticky top-0 z-[90]"
          style={{
            opacity: compactToolbarOpacity,
            transform: `translateY(${compactToolbarTranslateY})`,
            pointerEvents: compactToolbarOpacity > 0.05 ? 'auto' : 'none',
            transition: 'opacity 180ms ease, transform 180ms ease'
          }}
        >
          <div
            className="w-full p-4 flex flex-wrap items-start justify-start gap-4 rounded-b-2xl border-b"
            style={{
              backdropFilter: 'blur(24px) saturate(160%)',
              WebkitBackdropFilter: 'blur(24px) saturate(160%)',
              background:
                'linear-gradient(180deg, rgba(248, 250, 252, 0.96) 0%, rgba(248, 250, 252, 0.9) 72%, rgba(248, 250, 252, 0.82) 100%)',
              borderColor: 'rgba(148, 163, 184, 0.18)',
              boxShadow: '0 18px 42px rgba(15, 23, 42, 0.16)'
            }}
          >
            {renderActionButtons()}
          </div>
        </div>

        <div
          className="glass-panel-light shrink-0 p-4 flex flex-wrap items-start justify-between gap-4"
          style={{
            opacity: queryHeaderOpacity,
            transform: `translateY(${queryHeaderTranslateY})`,
            transition: 'opacity 180ms ease, transform 180ms ease'
          }}
        >
          <div className="space-y-2">
            <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
              报表查询
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              已生成报表清单支持多选筛选。双击清单行，或先单击选中再点击“查询详情”均可查看报表内容。
            </p>
          </div>

          {renderActionButtons()}
        </div>

        <div className="glass-panel-light shrink-0 p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                报表类型筛选
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {filterOptions.reportTypes.length > 0 ? (
                  filterOptions.reportTypes.map((reportType) => {
                    const selected = selectedReportTypes.includes(reportType)
                    return (
                      <button
                        key={reportType}
                        type="button"
                        className="rounded-full px-3 py-1.5 text-sm font-medium border transition"
                        style={{
                          borderColor: selected
                            ? 'rgba(15, 23, 42, 0.35)'
                            : 'var(--color-glass-border-light)',
                          background: selected ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.72)',
                          color: 'var(--color-text-secondary)'
                        }}
                        aria-pressed={selected}
                        onClick={() =>
                          setSelectedReportTypes((current) => toggleValue(current, reportType))
                        }
                      >
                        {getReportTypeLabel(reportType)}
                      </button>
                    )
                  })
                ) : (
                  <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    暂无可筛选的报表类型
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                会计期间筛选
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <select
                  className="glass-input px-3 py-2"
                  value={startDateParts.year}
                  onChange={(event) => updateDateParts(setStartDateParts, 'year', event.target.value)}
                >
                  {yearOptions.map((year) => (
                    <option key={`start-year-${year}`} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
                <select
                  className="glass-input px-3 py-2"
                  value={startDateParts.month}
                  onChange={(event) => updateDateParts(setStartDateParts, 'month', event.target.value)}
                >
                  {monthOptions.map((month) => (
                    <option key={`start-month-${month}`} value={month}>
                      {Number(month)}月
                    </option>
                  ))}
                </select>
                <select
                  className="glass-input px-3 py-2"
                  value={startDateParts.day}
                  onChange={(event) => updateDateParts(setStartDateParts, 'day', event.target.value)}
                >
                  {startDayOptions.map((day) => (
                    <option key={`start-day-${day}`} value={day}>
                      {Number(day)}日
                    </option>
                  ))}
                </select>
                <span>-</span>
                <select
                  className="glass-input px-3 py-2"
                  value={endDateParts.year}
                  onChange={(event) => updateDateParts(setEndDateParts, 'year', event.target.value)}
                >
                  {yearOptions.map((year) => (
                    <option key={`end-year-${year}`} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
                <select
                  className="glass-input px-3 py-2"
                  value={endDateParts.month}
                  onChange={(event) => updateDateParts(setEndDateParts, 'month', event.target.value)}
                >
                  {monthOptions.map((month) => (
                    <option key={`end-month-${month}`} value={month}>
                      {Number(month)}月
                    </option>
                  ))}
                </select>
                <select
                  className="glass-input px-3 py-2"
                  value={endDateParts.day}
                  onChange={(event) => updateDateParts(setEndDateParts, 'day', event.target.value)}
                >
                  {endDayOptions.map((day) => (
                    <option key={`end-day-${day}`} value={day}>
                      {Number(day)}日
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel min-h-[360px] shrink-0 overflow-hidden">
          <div
            className="grid grid-cols-[52px_2fr_1.1fr_1fr_1.4fr] gap-3 border-b px-4 py-3 text-sm font-semibold"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              color: 'var(--color-text-primary)'
            }}
          >
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={() =>
                  setSelectedSnapshotIds(allFilteredSelected ? [] : filteredRows.map((row) => row.id))
                }
                aria-label="全选当前筛选结果"
                disabled={filteredRows.length === 0}
              />
            </div>
            <div>报表名称</div>
            <div>报表类型</div>
            <div>会计期间</div>
            <div>生成时间</div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {filteredRows.map((row) => {
              const selected = row.id === selectedSnapshotId
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-[52px_2fr_1.1fr_1fr_1.4fr] gap-3 border-b px-4 py-3 text-left text-sm transition"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    background: selected ? 'rgba(15, 23, 42, 0.08)' : 'transparent',
                    color: 'var(--color-text-secondary)'
                  }}
                  onClick={() => setSelectedSnapshotId(row.id)}
                  onDoubleClick={() => {
                    setSelectedSnapshotId(row.id)
                    void loadDetail(row.id)
                  }}
                >
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedSnapshotIds.includes(row.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => setSelectedSnapshotIds((current) => toggleValue(current, row.id))}
                      aria-label={`勾选报表 ${row.report_name}`}
                    />
                  </div>
                  <div>{row.report_name}</div>
                  <div>{getReportTypeLabel(row.report_type)}</div>
                  <div>{row.period}</div>
                  <div>{formatGeneratedAt(row.generated_at)}</div>
                </div>
              )
            })}

            {filteredRows.length === 0 && !loadingList && (
              <div
                className="px-4 py-8 text-center text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                暂无匹配的报表记录
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="shrink-0 text-sm" style={{ color: 'var(--color-danger)' }} aria-live="polite">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="shrink-0 text-sm" style={{ color: 'var(--color-success)' }} aria-live="polite">
            {successMessage}
          </div>
        )}

        <div
          className="glass-panel min-h-[96px] shrink-0 flex items-center justify-center text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          双击清单行，或单击选中后点击“查询详情”，将在悬浮交互框中显示完整报表。
        </div>
      </div>

      {isDetailOpen && detail && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-sm"
          onClick={() => setIsDetailOpen(false)}
        >
          <div
            className="glass-panel-light max-h-[88vh] w-[min(1200px,92vw)] overflow-y-auto p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  报表详情
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  双击清单进入的完整报表悬浮查看框
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                  onClick={() => void handleSinglePrint(detail.id)}
                >
                  打印预览
                </button>
                <button
                  type="button"
                  className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                  onClick={() => void handleSingleExport(detail.id, 'xlsx')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'xlsx' ? '导出中...' : '导出 Excel'}
                </button>
                <button
                  type="button"
                  className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                  onClick={() => void handleSingleExport(detail.id, 'pdf')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'pdf' ? '导出中...' : '导出 PDF'}
                </button>
                <button
                  type="button"
                  className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                  onClick={() => setIsDetailOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
            <ReportSnapshotViewer detail={detail} />
          </div>
        </div>
      )}
    </div>
  )
}

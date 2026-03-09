import { useEffect, useState, type JSX } from 'react'
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

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export default function ReportQuery(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const [rows, setRows] = useState<ReportSnapshotSummary[]>([])
  const [selectedReportTypes, setSelectedReportTypes] = useState<ReportType[]>([])
  const [selectedPeriods, setSelectedPeriods] = useState<string[]>([])
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ReportSnapshotDetail | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'pdf' | null>(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const filteredRows = filterReportSnapshots(rows, {
    reportTypes: selectedReportTypes,
    periods: selectedPeriods
  })
  const filterOptions = buildReportFilterOptions(rows)

  const loadRows = async (): Promise<void> => {
    setError('')
    setSuccessMessage('')
    setDetail(null)
    setIsDetailOpen(false)
    setSelectedSnapshotId(null)

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
    if (!selectedSnapshotId || !currentLedger) {
      setError('请先从清单中选择一张报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表删除')
      return
    }
    const selectedRow = rows.find((row) => row.id === selectedSnapshotId)
    const confirmed = window.confirm(
      `确定要删除报表【${selectedRow?.report_name || '未命名报表'}】吗？`
    )
    if (!confirmed) {
      return
    }

    setDeleting(true)
    try {
      const result = await window.api.reporting.delete({
        snapshotId: selectedSnapshotId,
        ledgerId: currentLedger.id
      })
      if (!result.success) {
        setError(result.error || '删除报表失败')
        return
      }

      setRows((current) => current.filter((row) => row.id !== selectedSnapshotId))
      if (detail?.id === selectedSnapshotId) {
        setDetail(null)
        setIsDetailOpen(false)
      }
      setSelectedSnapshotId(null)
      setSuccessMessage('报表已删除')
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除报表失败')
    } finally {
      setDeleting(false)
    }
  }

  const handleExport = async (format: 'xlsx' | 'pdf'): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!selectedSnapshotId || !currentLedger) {
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
        snapshotId: selectedSnapshotId,
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

  useEffect(() => {
    void loadRows()
  }, [currentLedger?.id])

  useEffect(() => {
    setSelectedReportTypes([])
    setSelectedPeriods([])
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

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden pr-2">
      <div className="min-h-full flex flex-col gap-4 p-4">
        <div className="glass-panel-light shrink-0 p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            报表查询
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            已生成报表清单支持多选筛选。双击清单行，或先单击选中再点击“查询详情”均可查看报表内容。
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
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
            disabled={deleting || selectedSnapshotId === null}
          >
            {deleting ? '删除中...' : '删除报表'}
          </button>
          <button
            type="button"
            className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
            onClick={() => void handleExport('xlsx')}
            disabled={exportingFormat !== null || selectedSnapshotId === null}
          >
            {exportingFormat === 'xlsx' ? '导出中...' : '导出 Excel'}
          </button>
          <button
            type="button"
            className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
            onClick={() => void handleExport('pdf')}
            disabled={exportingFormat !== null || selectedSnapshotId === null}
          >
            {exportingFormat === 'pdf' ? '导出中...' : '导出 PDF'}
          </button>
        </div>
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
              <div className="mt-2 flex flex-wrap gap-2">
                {filterOptions.periods.length > 0 ? (
                  filterOptions.periods.map((period) => {
                    const selected = selectedPeriods.includes(period)
                    return (
                      <button
                        key={period}
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
                        onClick={() => setSelectedPeriods((current) => toggleValue(current, period))}
                      >
                        {period}
                      </button>
                    )
                  })
                ) : (
                  <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    暂无可筛选的会计期间
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel min-h-[360px] shrink-0 overflow-hidden">
          <div
            className="grid grid-cols-[2fr_1.1fr_1fr_1.4fr] gap-3 border-b px-4 py-3 text-sm font-semibold"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              color: 'var(--color-text-primary)'
            }}
          >
            <div>报表名称</div>
            <div>报表类型</div>
            <div>会计期间</div>
            <div>生成时间</div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {filteredRows.map((row) => {
              const selected = row.id === selectedSnapshotId
              return (
                <button
                  key={row.id}
                  type="button"
                  className="grid w-full grid-cols-[2fr_1.1fr_1fr_1.4fr] gap-3 border-b px-4 py-3 text-left text-sm transition"
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
                  <div>{row.report_name}</div>
                  <div>{getReportTypeLabel(row.report_type)}</div>
                  <div>{row.period}</div>
                  <div>{formatGeneratedAt(row.generated_at)}</div>
                </button>
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
                  onClick={() => void handleExport('xlsx')}
                  disabled={exportingFormat !== null}
                >
                  {exportingFormat === 'xlsx' ? '导出中...' : '导出 Excel'}
                </button>
                <button
                  type="button"
                  className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                  onClick={() => void handleExport('pdf')}
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

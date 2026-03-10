import { useEffect, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import {
  ReportSnapshotViewer,
  getReportTypeByComponent,
  type ReportSnapshotDetail
} from './reportingShared'

interface Props {
  title: string
  componentType: string
}

export default function ReportWorkspacePage({ title, componentType }: Props): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const currentPeriod = useLedgerStore((state) => state.currentPeriod)
  const [detail, setDetail] = useState<ReportSnapshotDetail | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [month, setMonth] = useState('')
  const [startPeriod, setStartPeriod] = useState('')
  const [endPeriod, setEndPeriod] = useState('')
  const [includeUnposted, setIncludeUnposted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<'xlsx' | 'pdf' | null>(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const reportType = getReportTypeByComponent(componentType)
  const isDynamicReport = reportType !== 'balance_sheet'

  useEffect(() => {
    const defaultStartPeriod =
      reportType === 'equity_statement' && currentPeriod
        ? `${currentPeriod.slice(0, 4)}-01`
        : currentPeriod || ''

    setDetail(null)
    setError('')
    setSuccessMessage('')
    setIncludeUnposted(false)
    setIsDetailOpen(false)
    setMonth(currentPeriod || '')
    setStartPeriod(defaultStartPeriod)
    setEndPeriod(currentPeriod || '')
  }, [currentLedger?.id, currentPeriod, reportType])

  const handleGenerate = async (): Promise<void> => {
    setError('')
    setSuccessMessage('')

    if (!reportType) {
      setError('报表类型未识别')
      return
    }
    if (!currentLedger) {
      setError('请先选择账套')
      return
    }
    if (!currentPeriod) {
      setError('请先选择会计期间')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持生成报表')
      return
    }
    if (isDynamicReport && startPeriod && endPeriod && startPeriod > endPeriod) {
      setError('起始月份不能晚于结束月份')
      return
    }

    setLoading(true)
    try {
      const result = await window.api.reporting.generate({
        ledgerId: currentLedger.id,
        reportType,
        month: isDynamicReport ? undefined : month || currentPeriod,
        startPeriod: isDynamicReport ? startPeriod || currentPeriod : undefined,
        endPeriod: isDynamicReport ? endPeriod || currentPeriod : undefined,
        includeUnpostedVouchers: includeUnposted
      })

      if (!result.success || !result.snapshot) {
        setError(result.error || '生成报表失败')
        return
      }

      setDetail(result.snapshot)
      setIsDetailOpen(true)
      setSuccessMessage(`已生成并保存 ${result.snapshot.report_name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成报表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (format: 'xlsx' | 'pdf'): Promise<void> => {
    setError('')
    setSuccessMessage('')
    if (!detail) {
      setError('请先生成报表')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持报表导出')
      return
    }

    setExportingFormat(format)
    try {
      const result = await window.api.reporting.export({
        snapshotId: detail.id,
        ledgerId: detail.ledger_id,
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

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="glass-panel-light p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            当前账套：{currentLedger?.name || '未选择'} | 会计期间：{currentPeriod || '未选择'}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            点击“生成并保存”后，会把当前期间的报表快照写入报表查询清单，便于后续筛选和复核。
          </p>
        </div>

        <div className="flex flex-col gap-3 min-w-[320px]">
          {isDynamicReport ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                起始月份
                <input
                  type="month"
                  className="glass-input px-3 py-2"
                  value={startPeriod}
                  onChange={(event) => setStartPeriod(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                结束月份
                <input
                  type="month"
                  className="glass-input px-3 py-2"
                  value={endPeriod}
                  onChange={(event) => setEndPeriod(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              报表月份
              <input
                type="month"
                className="glass-input px-3 py-2"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
          )}

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            <input
              type="checkbox"
              checked={includeUnposted}
              onChange={(event) => setIncludeUnposted(event.target.checked)}
            />
            <span>未记账凭证</span>
          </label>

          <button
            type="button"
            className="glass-btn-secondary px-5 py-2 font-semibold"
            onClick={() => void handleGenerate()}
            disabled={loading}
          >
            {loading ? '生成中...' : '生成并保存'}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="glass-btn-secondary px-5 py-2 font-semibold"
              onClick={() => void handleExport('xlsx')}
              disabled={exportingFormat !== null || !detail}
            >
              {exportingFormat === 'xlsx' ? '导出中...' : '导出 Excel'}
            </button>
            <button
              type="button"
              className="glass-btn-secondary px-5 py-2 font-semibold"
              onClick={() => void handleExport('pdf')}
              disabled={exportingFormat !== null || !detail}
            >
              {exportingFormat === 'pdf' ? '导出中...' : '导出 PDF'}
            </button>
          </div>
        </div>
      </div>

      {successMessage && (
        <div className="text-sm" style={{ color: 'var(--color-success)' }} aria-live="polite">
          {successMessage}
        </div>
      )}

      {error && (
        <div className="text-sm" style={{ color: 'var(--color-danger)' }} aria-live="polite">
          {error}
        </div>
      )}

      <div
        className="glass-panel flex-1 flex items-center justify-center text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {isDynamicReport
          ? '按起始月份和结束月份生成动态报表；实际取数范围为起始月份 1 日至结束月份最后 1 日。生成后会弹出独立报表查看框。'
          : '按月份生成静态报表；实际取数截至所选月份最后一天。生成后会弹出独立报表查看框。'}
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
                  生成报表后弹出的独立查看框
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                onClick={() => setIsDetailOpen(false)}
              >
                关闭
              </button>
            </div>
            <ReportSnapshotViewer detail={detail} />
          </div>
        </div>
      )}
    </div>
  )
}

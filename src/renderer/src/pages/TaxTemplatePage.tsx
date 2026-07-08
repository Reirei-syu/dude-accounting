import { useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type DeclarationType = 'monthly' | 'quarterly' | 'annual'

interface Props {
  title: string
}

const declarationLabels: Record<DeclarationType, string> = {
  monthly: '月报',
  quarterly: '季报',
  annual: '年报'
}

function parsePeriod(period: string): { year: number; month: number; quarter: number } {
  const matched = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  const now = new Date()
  const year = matched ? Number(matched[1]) : now.getFullYear()
  const month = matched ? Number(matched[2]) : now.getMonth() + 1
  return {
    year,
    month,
    quarter: Math.ceil(month / 3)
  }
}

export default function TaxTemplatePage({ title }: Props): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const periodDefaults = useMemo(() => parsePeriod(currentPeriod), [currentPeriod])
  const [declarationType, setDeclarationType] = useState<DeclarationType>('monthly')
  const [year, setYear] = useState(periodDefaults.year)
  const [month, setMonth] = useState(periodDefaults.month)
  const [quarter, setQuarter] = useState(periodDefaults.quarter)
  const [outputDirectory, setOutputDirectory] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    setYear(periodDefaults.year)
    setMonth(periodDefaults.month)
    setQuarter(periodDefaults.quarter)
  }, [periodDefaults.month, periodDefaults.quarter, periodDefaults.year])

  useEffect(() => {
    setMessage(null)
  }, [currentLedger?.id])

  const isNpoLedger = currentLedger?.standard_type === 'npo'
  const savedTaxpayerIdentificationNumber =
    currentLedger?.taxpayer_identification_number?.trim() ?? ''
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1)
  const quarterOptions = [1, 2, 3, 4]

  const chooseDirectory = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持选择输出目录' })
      return
    }

    setBusy(true)
    try {
      const result = await window.api.reporting.chooseTaxTemplateOutputDirectory()
      if (result.cancelled) {
        return
      }
      if (!result.success || !result.directoryPath) {
        setMessage({ type: 'error', text: result.error || '选择输出目录失败' })
        return
      }
      setOutputDirectory(result.directoryPath)
      setMessage({ type: 'success', text: `输出目录已更新：${result.directoryPath}` })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '选择输出目录失败'
      })
    } finally {
      setBusy(false)
    }
  }

  const exportTemplate = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持导出税务模板' })
      return
    }
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!isNpoLedger) {
      setMessage({ type: 'error', text: '税务模板仅支持民间非营利组织账套' })
      return
    }
    if (!savedTaxpayerIdentificationNumber) {
      setMessage({ type: 'error', text: '请先在账套资料中维护纳税人识别号/统一社会信用代码' })
      return
    }

    setBusy(true)
    try {
      const result = await window.api.reporting.exportTaxTemplate({
        ledgerId: currentLedger.id,
        declarationType,
        year,
        month: declarationType === 'monthly' ? month : undefined,
        quarter: declarationType === 'quarterly' ? quarter : undefined,
        directoryPath: outputDirectory || undefined
      })

      if (!result.success || !result.filePath) {
        setMessage({ type: 'error', text: result.error || '导出税务模板失败' })
        return
      }

      setOutputDirectory(result.filePath.replace(/[\\/][^\\/]*$/, ''))
      setMessage({
        type: 'success',
        text: `${declarationLabels[declarationType]}税务模板已导出：${result.filePath}`
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出税务模板失败'
      })
    } finally {
      setBusy(false)
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
        </div>

        <div className="flex flex-col gap-3 min-w-[360px] max-w-[520px]">
          <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            纳税人识别号/统一社会信用代码
            <input
              className="glass-input px-3 py-2"
              value={savedTaxpayerIdentificationNumber}
              readOnly
              disabled
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            {(['monthly', 'quarterly', 'annual'] as DeclarationType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
                style={
                  declarationType === type
                    ? { background: 'rgba(15, 23, 42, 0.92)', color: '#fff' }
                    : undefined
                }
                onClick={() => setDeclarationType(type)}
                disabled={busy}
              >
                {declarationLabels[type]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              年度
              <input
                type="number"
                className="glass-input px-3 py-2"
                min={1900}
                max={9999}
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                disabled={busy}
              />
            </label>

            {declarationType === 'monthly' && (
              <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                月份
                <select
                  className="glass-input px-3 py-2"
                  value={month}
                  onChange={(event) => setMonth(Number(event.target.value))}
                  disabled={busy}
                >
                  {monthOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} 月
                    </option>
                  ))}
                </select>
              </label>
            )}

            {declarationType === 'quarterly' && (
              <label className="flex flex-col gap-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                季度
                <select
                  className="glass-input px-3 py-2"
                  value={quarter}
                  onChange={(event) => setQuarter(Number(event.target.value))}
                  disabled={busy}
                >
                  {quarterOptions.map((option) => (
                    <option key={option} value={option}>
                      第 {option} 季度
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/60 p-3 text-sm">
            <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              输出目录
            </div>
            <div className="break-all" style={{ color: 'var(--color-text-secondary)' }}>
              {outputDirectory || '使用上次选择的目录'}
            </div>
            <button
              type="button"
              className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
              onClick={() => void chooseDirectory()}
              disabled={busy}
            >
              选择目录
            </button>
          </div>

          <button
            type="button"
            className="glass-btn-secondary px-5 py-2 font-semibold"
            onClick={() => void exportTemplate()}
            disabled={busy || !isNpoLedger}
          >
            {busy ? '处理中...' : '导出税务模板'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className="text-sm"
          style={{
            color:
              message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)'
          }}
          aria-live="polite"
        >
          {message.text}
        </div>
      )}

      <div
        className="glass-panel flex-1 flex items-center justify-center text-sm"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {isNpoLedger ? '导出文件保留税务模板原有表式。' : '请切换到民间非营利组织账套。'}
      </div>
    </div>
  )
}

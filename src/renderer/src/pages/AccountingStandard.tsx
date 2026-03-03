import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type StandardType = 'enterprise' | 'npo'

interface TemplateSummary {
  standardType: StandardType
  name: string
  subjectCount: number
  topLevelCount: number
  hasRestrictedSubAccounts: boolean
}

const STANDARD_LABEL: Record<StandardType, string> = {
  enterprise: '企业会计准则（CAS）',
  npo: '民间非营利组织会计制度'
}

const TEMPLATE_HIGHLIGHTS: Record<StandardType, string[]> = {
  enterprise: ['完整企业科目体系', '企业财务报表列报口径', '标准损益结转至本年利润'],
  npo: ['双净资产（限定/非限定）', '受托代理资产与负债配套', '收入自动预置限定/非限定二级']
}

export default function AccountingStandard(): JSX.Element {
  const currentLedger = useLedgerStore((s) => s.currentLedger)
  const setCurrentLedger = useLedgerStore((s) => s.setCurrentLedger)
  const setLedgers = useLedgerStore((s) => s.setLedgers)

  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [applyingType, setApplyingType] = useState<StandardType | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const currentType = (currentLedger?.standard_type || 'enterprise') as StandardType
  const currentTypeLabel = STANDARD_LABEL[currentType]

  const loadTemplates = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setTemplates([])
      return
    }
    setLoading(true)
    try {
      const result = await window.api.ledger.getStandardTemplates()
      setTemplates(result as TemplateSummary[])
    } catch (error) {
      setTemplates([])
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载准则模板失败'
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void loadTemplates()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [loadTemplates])

  const templateMap = useMemo(() => {
    const map: Record<string, TemplateSummary> = {}
    for (const item of templates) {
      map[item.standardType] = item
    }
    return map
  }, [templates])

  const applyTemplate = async (standardType: StandardType): Promise<void> => {
    setMessage(null)
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持会计准则切换' })
      return
    }
    if (standardType === currentType) {
      setMessage({ type: 'success', text: `当前账套已是${STANDARD_LABEL[standardType]}` })
      return
    }

    const confirmed = window.confirm(
      `将当前账套切换为“${STANDARD_LABEL[standardType]}”模板。\n\n该操作会重建系统科目与系统结转规则。\n为保证账务一致性，已有业务数据的账套会被拒绝切换。\n\n是否继续？`
    )
    if (!confirmed) return

    setApplyingType(standardType)
    try {
      const result = await window.api.ledger.applyStandardTemplate({
        ledgerId: currentLedger.id,
        standardType
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '应用准则模板失败' })
        return
      }

      const ledgers = await window.api.ledger.getAll()
      setLedgers(ledgers)
      const updated = ledgers.find((item) => item.id === currentLedger.id) || null
      setCurrentLedger(updated)

      setMessage({
        type: 'success',
        text: `已应用${STANDARD_LABEL[standardType]}模板，系统科目数：${result.subjectCount ?? '-'}`
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '应用准则模板失败'
      })
    } finally {
      setApplyingType(null)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          会计准则设置
        </h2>
        <button
          className="glass-btn-secondary"
          onClick={() => void loadTemplates()}
          disabled={loading}
        >
          {loading ? '刷新中...' : '刷新模板'}
        </button>
      </div>

      <div className="glass-panel-light p-4">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          当前账套：
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {currentLedger ? ` ${currentLedger.name}` : ' 未选择'}
          </strong>
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          当前准则：
          <strong style={{ color: 'var(--color-text-primary)' }}>{currentTypeLabel}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(['enterprise', 'npo'] as StandardType[]).map((type) => {
          const template = templateMap[type]
          const disabled = !currentLedger || applyingType !== null
          const isCurrent = currentType === type

          return (
            <section key={type} className="glass-panel p-4 flex flex-col gap-3">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3
                    className="text-lg font-semibold"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {STANDARD_LABEL[type]}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {type === 'enterprise'
                      ? '一般企业会计主体'
                      : '社会团体、基金会、社会服务机构等民间非营利组织'}
                  </p>
                </div>
                {isCurrent && (
                  <span
                    className="px-2 py-1 rounded text-xs font-semibold"
                    style={{
                      color: 'var(--color-secondary)',
                      backgroundColor: 'rgba(30, 58, 138, 0.12)'
                    }}
                  >
                    当前使用
                  </span>
                )}
              </header>

              <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <p>系统科目总数：{template ? template.subjectCount : '-'}</p>
                <p>一级科目数：{template ? template.topLevelCount : '-'}</p>
                <p>
                  限定/非限定明细：
                  {template?.hasRestrictedSubAccounts ? ' 已预置' : ' 不涉及'}
                </p>
              </div>

              <ul
                className="text-sm flex flex-col gap-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {TEMPLATE_HIGHLIGHTS[type].map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>

              <div>
                <button
                  className="glass-btn-secondary"
                  disabled={disabled || isCurrent}
                  onClick={() => void applyTemplate(type)}
                >
                  {applyingType === type ? '应用中...' : isCurrent ? '当前已应用' : '应用此模板'}
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {message && (
        <div
          className="text-sm px-1"
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

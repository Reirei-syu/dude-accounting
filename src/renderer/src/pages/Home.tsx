import { useEffect, useState, type JSX } from 'react'
import type { LedgerYearOverview } from '../../../shared/contracts/ledgerOverview'
import { useAuthStore } from '../stores/authStore'
import { useLedgerStore } from '../stores/ledgerStore'
import { getHomeTabPreset, hasPermissionAccess, useUIStore } from '../stores/uiStore'
import './Home.css'

const shortcuts = [
  { id: 'voucher-entry', description: '记录本期经济业务', mark: '录' },
  { id: 'voucher-query', description: '查找已保存的凭证', mark: '查' },
  { id: 'subject-balance', description: '查看科目发生额与余额', mark: '账' },
  { id: 'report-query', description: '查看已生成的财务报表', mark: '表' }
]

const statusLabels = { not_started: '未启用', open: '未结账', closed: '已结账' }

interface LoadState {
  key: string
  data?: LedgerYearOverview
  error?: string
}

export default function Home({ isActive = true }: { isActive?: boolean }): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const user = useAuthStore((state) => state.user)
  const ledgerId = currentLedger?.id
  const openTab = useUIStore((state) => state.openTab)
  const period = currentPeriod || currentLedger?.current_period || ''
  const periodYear = Number(period.slice(0, 4)) || new Date().getFullYear()
  const contextKey = `${user?.id}:${currentLedger?.id}:${periodYear}`
  const [yearChoice, setYearChoice] = useState({ contextKey, year: periodYear })
  const year = yearChoice.contextKey === contextKey ? yearChoice.year : periodYear
  const [refresh, setRefresh] = useState(0)
  const [loadState, setLoadState] = useState<LoadState | null>(null)
  const [wasActive, setWasActive] = useState(isActive)
  // 上下文变化时重置本页选择；重新激活时丢弃旧快照，再由 effect 读取。
  if (yearChoice.contextKey !== contextKey) {
    setYearChoice({ contextKey, year: periodYear })
  }
  if (wasActive !== isActive) {
    setWasActive(isActive)
    setLoadState(null)
  }
  const requestKey = `${contextKey}:${period}:${year}:${refresh}`
  const state = loadState?.key === requestKey ? loadState : null
  const data = state?.data
  const error = window.electron
    ? state?.error
    : '浏览器预览模式不支持读取账套概览，请在桌面应用中查看。'
  const loading = Boolean(currentLedger && !data && !error)

  useEffect(() => {
    if (!isActive || !ledgerId || !window.electron) return
    let cancelled = false
    void window.api.ledger.getYearOverview({ ledgerId, year }).then(
      (result) => {
        if (!cancelled) setLoadState({ key: requestKey, data: result })
      },
      (reason: unknown) => {
        if (!cancelled) {
          setLoadState({
            key: requestKey,
            error: reason instanceof Error ? reason.message : '加载账套概览失败'
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [ledgerId, isActive, requestKey, year])

  const changeYear = (nextYear: number): void => {
    setYearChoice({ contextKey, year: nextYear })
  }

  return (
    <main className="home-page" aria-label="账套首页">
      <header className="home-heading">
        <div>
          <p className="home-eyebrow">账套概览</p>
          <h1>首页</h1>
        </div>
        <button
          type="button"
          className="glass-btn-secondary"
          disabled={!currentLedger || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      {!currentLedger ? (
        <div className="home-message glass-panel" role="status">
          请先选择账套；如暂无账套，请由有权限的用户新建或授权账套。
        </div>
      ) : (
        <>
          <section className="home-ledger glass-panel" aria-label="当前账套摘要">
            <div className="home-ledger-name">
              <span>当前账套</span>
              <h2>{data?.ledger.name ?? currentLedger.name}</h2>
            </div>
            <dl>
              <div>
                <dt>会计制度</dt>
                <dd>
                  {(data?.ledger.standard_type ?? currentLedger.standard_type) === 'npo'
                    ? '民间非营利组织会计制度'
                    : '企业会计准则'}
                </dd>
              </div>
              <div>
                <dt>启用期间</dt>
                <dd>{data?.ledger.start_period ?? currentLedger.start_period}</dd>
              </div>
              <div>
                <dt>当前账期</dt>
                <dd>{period}</dd>
              </div>
            </dl>
          </section>

          <section aria-label="快捷入口">
            <h2 className="home-section-title">快捷入口</h2>
            <div className="home-shortcuts">
              {shortcuts.map((shortcut) => {
                const preset = getHomeTabPreset(shortcut.id)
                if (!preset) return null
                const allowed =
                  shortcut.id !== 'voucher-entry' || hasPermissionAccess(user, 'voucher_entry')
                return (
                  <button
                    type="button"
                    className="home-shortcut glass-panel"
                    key={shortcut.id}
                    disabled={!allowed}
                    title={allowed ? preset.title : '无凭证录入权限'}
                    aria-label={preset.title}
                    onClick={() => openTab(preset)}
                  >
                    <span className="home-shortcut-mark" aria-hidden="true">
                      {shortcut.mark}
                    </span>
                    <span>
                      <strong>{preset.title}</strong>
                      <small>{allowed ? shortcut.description : '无凭证录入权限'}</small>
                    </span>
                    <span className="home-shortcut-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section
            className="home-year glass-panel"
            aria-label="月度结账与凭证概览"
            aria-busy={loading}
          >
            <div className="home-year-heading">
              <div>
                <h2 className="home-section-title">月度概览</h2>
                <p>每月凭证张数包含未审核、已审核和已记账凭证，不含已删除凭证及未保存草稿。</p>
              </div>
              <div className="home-year-picker" role="group" aria-label="查看年份">
                <button
                  type="button"
                  className="glass-btn-secondary"
                  disabled={year <= 1}
                  onClick={() => changeYear(year - 1)}
                >
                  上一年
                </button>
                <strong aria-live="polite">{String(year).padStart(4, '0')} 年</strong>
                <button
                  type="button"
                  className="glass-btn-secondary"
                  disabled={year >= 9999}
                  onClick={() => changeYear(year + 1)}
                >
                  下一年
                </button>
                <button
                  type="button"
                  className="glass-btn-secondary"
                  disabled={year === periodYear}
                  onClick={() => changeYear(periodYear)}
                >
                  当前账期年
                </button>
              </div>
            </div>

            {loading && (
              <div className="home-message" role="status">
                正在加载账套概览…
              </div>
            )}
            {error && (
              <div className="home-message home-error" role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  className="glass-btn-secondary"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  重试
                </button>
              </div>
            )}
            {data && (
              <div className="home-months">
                {data.months.map((month, index) => (
                  <article
                    key={month.period}
                    className={`home-month home-month-${month.status}${month.period === period ? ' home-month-current' : ''}`}
                    aria-label={`${month.period} 月度概览`}
                  >
                    <div className="home-month-top">
                      <h3>{index + 1} 月</h3>
                      {month.period === period && (
                        <span className="home-current-label">当前账期</span>
                      )}
                    </div>
                    <span className={`home-status home-status-${month.status}`}>
                      {statusLabels[month.status]}
                    </span>
                    <p className="home-voucher-count">
                      <strong>{month.voucherCount.toLocaleString('zh-CN')}</strong>
                      <span>张凭证</span>
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

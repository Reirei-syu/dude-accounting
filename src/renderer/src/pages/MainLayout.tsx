import Sidebar from '../components/Sidebar'
import TabBar from '../components/TabBar'
import Workspace from '../components/Workspace'
import SuspendedOverlay from '../components/SuspendedOverlay'
import { useUIStore } from '../stores/uiStore'
import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import { useEffect, type JSX } from 'react'
import wallpaper from '../assets/wallpaper.png'

export default function MainLayout(): JSX.Element {
  const { isMenuSuspended } = useUIStore()
  const { ledgers, currentLedger, currentPeriod, setLedgers, setCurrentLedger, setCurrentPeriod } =
    useLedgerStore()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const handleLogout = async (): Promise<void> => {
    if (window.electron) {
      try {
        await window.api.auth.logout()
      } catch {
        // ignore ipc logout errors and proceed to clear local state
      }
    }
    logout()
  }

  const handleSwitchLedger = (ledgerId: number): void => {
    const target = ledgers.find((ledger) => ledger.id === ledgerId)
    if (!target) return
    setCurrentLedger(target)
  }

  const handleSwitchPeriod = async (period: string): Promise<void> => {
    if (!currentLedger) return
    setCurrentPeriod(period)
    if (!window.electron) return
    try {
      const result = await window.api.ledger.update({ id: currentLedger.id, currentPeriod: period })
      if (!result.success) {
        console.error('switch period failed', result.error)
      }
    } catch (error) {
      console.error('switch period failed', error)
    }
  }

  const handleCreateLedger = async (): Promise<void> => {
    if (!window.electron) return

    const name = window.prompt('请输入账套名称', '新账套')
    if (!name) return
    if (!name.trim()) {
      window.alert('账套名称不能为空')
      return
    }

    const now = new Date()
    const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const startPeriod =
      window.prompt('请输入起始会计期间（YYYY-MM）', defaultPeriod)?.trim() || defaultPeriod

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startPeriod)) {
      window.alert('起始会计期间格式应为 YYYY-MM')
      return
    }

    const standardType = window.confirm(
      '是否使用民非准则？\n选择“确定”为民非，选择“取消”为企业'
    )
      ? 'npo'
      : 'enterprise'

    try {
      const result = await window.api.ledger.create({
        name: name.trim(),
        standardType,
        startPeriod
      })
      if (!result.success) {
        window.alert(result.error || '创建账套失败')
        return
      }
      const finalLedgers = await window.api.ledger.getAll()
      setLedgers(finalLedgers)
      const created = finalLedgers.find((ledger) => ledger.id === result.id)
      if (created) setCurrentLedger(created)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '创建账套失败')
    }
  }

  useEffect(() => {
    async function loadLedgers(): Promise<void> {
      try {
        if (!window.electron) {
          const mockLedger = {
            id: 0,
            name: '演示账套',
            standard_type: 'enterprise' as const,
            start_period: '2026-01',
            current_period: '2026-03',
            created_at: new Date().toISOString()
          }
          setLedgers([mockLedger])
          setCurrentLedger(mockLedger)
          return
        }

        const loadedLedgers = await window.api.ledger.getAll()
        if (loadedLedgers.length === 0) {
          const now = new Date()
          const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
          await window.api.ledger.create({
            name: '默认账套',
            standardType: 'enterprise',
            startPeriod: period
          })
        }

        const finalLedgers = await window.api.ledger.getAll()
        setLedgers(finalLedgers)
        if (finalLedgers.length > 0 && !currentLedger) {
          setCurrentLedger(finalLedgers[0])
        }
      } catch (error) {
        console.error('load ledgers failed', error)
      }
    }

    void loadLedgers()
  }, [currentLedger, setCurrentLedger, setLedgers])

  const formatPeriod = (period: string): string => {
    if (!period) return ''
    const [year, month] = period.split('-')
    return `${year}年${month}月`
  }

  return (
    <div
      className="main-shell"
      style={{
        backgroundImage: `url(${wallpaper})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="main-shell-dim" />
      <Sidebar />

      <section className="main-content">
        <header className="main-info-row">
          <div className="main-meta-group">
            <span className="main-meta-label">账套：</span>
            <select
              className="main-meta-control"
              value={currentLedger?.id ?? ''}
              onChange={(e) => handleSwitchLedger(Number(e.target.value))}
            >
              <option value="">未选择</option>
              {ledgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.name}（{ledger.standard_type === 'npo' ? '民非' : '企业'}）
                </option>
              ))}
            </select>

            {window.electron && (
              <button
                className="glass-btn-secondary main-create-ledger-btn"
                onClick={() => void handleCreateLedger()}
              >
                新建
              </button>
            )}
          </div>

          <div className="main-meta-group">
            <span className="main-meta-label">会计期间：</span>
            <input
              type="month"
              className="main-meta-control"
              value={currentPeriod || ''}
              onChange={(e) => void handleSwitchPeriod(e.target.value)}
            />
            <span className="main-period-text">{formatPeriod(currentPeriod)}</span>
          </div>

          <button type="button" className="main-logout-btn" onClick={() => void handleLogout()}>
            {user?.realName || user?.username} | 退出
          </button>
        </header>

        <TabBar />

        <div className="main-workspace-wrap">
          <div
            className={`main-workspace ${isMenuSuspended ? 'is-suspended' : ''}`}
            style={{ pointerEvents: isMenuSuspended ? 'none' : 'auto' }}
          >
            <Workspace />
          </div>
          {isMenuSuspended && <SuspendedOverlay />}
        </div>
      </section>
    </div>
  )
}

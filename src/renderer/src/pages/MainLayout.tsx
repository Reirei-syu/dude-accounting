import Sidebar from '../components/Sidebar'
import TabBar from '../components/TabBar'
import Workspace from '../components/Workspace'
import SuspendedOverlay from '../components/SuspendedOverlay'
import { getHomeTabPreset, hasPermissionAccess, useUIStore } from '../stores/uiStore'
import { pickInitialLedger, useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import wallpaper from '../assets/wallpaper.png'

const generateRandomString = (length = 10): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export default function MainLayout(): JSX.Element {
  const { isMenuSuspended, openTab, tabs, resetWorkspace } = useUIStore()
  const {
    ledgers,
    currentLedger,
    currentPeriod,
    setLedgers,
    setCurrentLedger,
    updateCurrentLedgerPeriod,
    reset: resetLedgerState
  } = useLedgerStore()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const userDisplayName = user?.realName || user?.username || '当前用户'
  const canManageLedgers = hasPermissionAccess(user, 'ledger_settings')
  const startupAppliedRef = useRef(false)
  const createLedgerNameInputRef = useRef<HTMLInputElement | null>(null)

  const handleLogout = async (): Promise<void> => {
    if (window.electron) {
      try {
        await window.api.auth.logout()
      } catch {
        // ignore ipc logout errors and proceed to clear local state
      }
    }
    resetWorkspace()
    resetLedgerState()
    logout()
  }

  const [isCreatingLedger, setIsCreatingLedger] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    startPeriod: '',
    standardType: 'enterprise' as 'enterprise' | 'npo'
  })
  const [isDeletingLedger, setIsDeletingLedger] = useState(false)
  const [deleteValidationCode, setDeleteValidationCode] = useState('')
  const [deleteInputCode, setDeleteInputCode] = useState('')

  useEffect(() => {
    startupAppliedRef.current = false
  }, [user?.id])

  useLayoutEffect(() => {
    if (!isCreatingLedger) {
      return
    }

    let frame1 = 0
    let frame2 = 0
    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        window.focus()
        createLedgerNameInputRef.current?.focus()
        createLedgerNameInputRef.current?.select()
      })
    })

    return () => {
      window.cancelAnimationFrame(frame1)
      window.cancelAnimationFrame(frame2)
    }
  }, [isCreatingLedger])

  const handleSwitchLedger = (ledgerId: number): void => {
    const target = ledgers.find((ledger) => ledger.id === ledgerId)
    if (!target) return
    setCurrentLedger(target)
  }

  const handleSwitchPeriod = async (period: string): Promise<void> => {
    if (!currentLedger) return
    updateCurrentLedgerPeriod(period)
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

  const openCreateLedger = (): void => {
    const now = new Date()
    const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    setCreateForm({ name: '', startPeriod: defaultPeriod, standardType: 'enterprise' })
    setIsCreatingLedger(true)
  }

  const submitCreateLedger = async (): Promise<void> => {
    if (!window.electron) return
    const { name, startPeriod, standardType } = createForm
    const normalizedName = name.trim()

    if (!normalizedName) {
      window.alert('账套名称不能为空')
      return
    }

    if (ledgers.some((ledger) => ledger.name === normalizedName)) {
      window.alert('已存在同名账套，请使用其他名称')
      return
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startPeriod)) {
      window.alert('起始会计期间格式应为 YYYY-MM')
      return
    }

    try {
      const result = await window.api.ledger.create({
        name: normalizedName,
        standardType,
        startPeriod
      })
      if (!result.success) {
        window.alert(result.error || '创建账套失败')
        return
      }
      setIsCreatingLedger(false)
      const finalLedgers = await window.api.ledger.getAll()
      setLedgers(finalLedgers)
      const created = finalLedgers.find((ledger) => ledger.id === result.id)
      if (created) setCurrentLedger(created)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '创建账套失败')
    }
  }

  const openDeleteLedger = (): void => {
    if (!currentLedger) {
      window.alert('请先选择要删除的账套')
      return
    }
    setDeleteValidationCode(generateRandomString(10))
    setDeleteInputCode('')
    setIsDeletingLedger(true)
  }

  const submitDeleteLedger = async (): Promise<void> => {
    if (!currentLedger) return
    if (deleteInputCode !== deleteValidationCode) {
      window.alert('验证码输入不一致，删除取消。')
      return
    }
    const confirmSecond = window.confirm(
      '删除后数据不可恢复！确实要删除【' + currentLedger.name + '】吗？'
    )
    if (!confirmSecond) return

    try {
      const result = await window.api.ledger.delete(currentLedger.id)
      if (!result.success) {
        window.alert(result.error || '删除账套失败')
        return
      }
      setIsDeletingLedger(false)
      const finalLedgers = await window.api.ledger.getAll()
      setLedgers(finalLedgers)
      if (finalLedgers.length > 0) {
        setCurrentLedger(finalLedgers[0])
      } else {
        // Fallback if deleting the last ledger
        window.location.reload()
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '删除操作失败')
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
          if (!startupAppliedRef.current && tabs.length === 0) {
            openTab({
              id: 'voucher-entry',
              title: '凭证录入',
              componentType: 'VoucherEntry'
            })
            startupAppliedRef.current = true
          }
          return
        }

        const [loadedLedgers, preferences] = await Promise.all([
          window.api.ledger.getAll(),
          window.api.settings.getUserPreferences()
        ])
        if (loadedLedgers.length === 0 && user?.isAdmin) {
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
        const preferredLedgerId = Number(preferences.default_ledger_id || 0)
        const nextLedger = pickInitialLedger(
          finalLedgers,
          Number.isInteger(preferredLedgerId) && preferredLedgerId > 0 ? preferredLedgerId : null
        )
        if (nextLedger?.id !== currentLedger?.id || (nextLedger === null && currentLedger !== null)) {
          setCurrentLedger(nextLedger)
        }

        if (!startupAppliedRef.current && tabs.length === 0) {
          const preset = getHomeTabPreset(preferences.default_home_tab || 'voucher-entry')
          if (preset) {
            openTab(preset)
          }
          startupAppliedRef.current = true
        }
      } catch (error) {
        console.error('load ledgers failed', error)
      }
    }

    void loadLedgers()
  }, [currentLedger?.id, openTab, setCurrentLedger, setLedgers, tabs.length, user?.id, user?.isAdmin])

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

      <section className="main-content" aria-label="工作区">
        <header className="main-info-row">
          <h1 className="sr-only">Dude Accounting 主界面</h1>

          <div className="main-info-primary">
            <div className="main-meta-group" role="group" aria-label="账套切换">
              <label className="main-meta-label" htmlFor="ledger-selector">
                账套：
              </label>
              <select
                id="ledger-selector"
                className="main-meta-control"
                value={currentLedger?.id ?? ''}
                onChange={(e) => handleSwitchLedger(Number(e.target.value))}
                aria-label="选择账套"
              >
                <option value="">未选择</option>
                {ledgers.map((ledger) => (
                  <option key={ledger.id} value={ledger.id}>
                    {ledger.name}（{ledger.standard_type === 'npo' ? '民非' : '企业'}）
                  </option>
                ))}
              </select>

              {window.electron && canManageLedgers && (
                <>
                  <button
                    className="glass-btn-secondary main-create-ledger-btn"
                    style={{
                      background: 'rgba(255, 255, 255, 0.98)',
                      color: '#0f172a',
                      borderColor: 'rgba(148, 163, 184, 0.85)'
                    }}
                    onClick={openCreateLedger}
                    aria-label="新建账套"
                  >
                    新建账套
                  </button>
                  <button
                    className="glass-btn-secondary main-create-ledger-btn"
                    style={{ color: 'var(--color-danger)', borderColor: 'rgba(185, 28, 28, 0.3)' }}
                    onClick={openDeleteLedger}
                    aria-label="删除当期账套"
                  >
                    删除账套
                  </button>
                </>
              )}
            </div>

            <div className="main-meta-group" role="group" aria-label="会计期间切换">
              <label className="main-meta-label" htmlFor="period-input">
                会计期间：
              </label>
              <input
                id="period-input"
                type="month"
                className="main-meta-control"
                value={currentPeriod || ''}
                onChange={(e) => void handleSwitchPeriod(e.target.value)}
                aria-label="选择会计期间"
              />
            </div>
          </div>

          <div className="main-info-actions">
            <button
              type="button"
              className="glass-btn-secondary px-4 py-2"
              onClick={() =>
                openTab({
                  id: 'my-preferences',
                  title: '我的偏好',
                  componentType: 'MyPreferences'
                })
              }
            >
              我的偏好
            </button>
            <button
              type="button"
              className="main-logout-btn"
              onClick={() => void handleLogout()}
            >
              {userDisplayName} | 退出登录
            </button>
          </div>
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

          {/* 新建账套弹窗 */}
          {isCreatingLedger && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="bg-white/90 p-6 rounded-2xl shadow-xl border border-slate-200 w-96 flex flex-col gap-4">
                <h3 className="text-lg font-bold text-slate-800">新建账套</h3>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-600">账套名称</label>
                  <input
                    ref={createLedgerNameInputRef}
                    className="glass-input"
                    placeholder="例如：杜小德科技有限公司"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-600">启用年月 (YYYY-MM)</label>
                  <input
                    type="month"
                    className="glass-input"
                    value={createForm.startPeriod}
                    onChange={(e) => setCreateForm({ ...createForm, startPeriod: e.target.value })}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-600">准则模板</label>
                  <select
                    className="glass-input"
                    value={createForm.standardType}
                    onChange={(e) =>
                      setCreateForm({
                        ...createForm,
                        standardType: e.target.value as 'enterprise' | 'npo'
                      })
                    }
                  >
                    <option value="enterprise">企业会计准则（CAS）</option>
                    <option value="npo">民间非营利组织会计制度</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 mt-4">
                  <button
                    className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition"
                    onClick={() => setIsCreatingLedger(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="glass-btn-secondary px-4 py-2"
                    style={{
                      background: 'rgba(255, 255, 255, 0.98)',
                      color: '#0f172a',
                      borderColor: 'rgba(148, 163, 184, 0.85)'
                    }}
                    onClick={() => void submitCreateLedger()}
                  >
                    确认创建
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 删除账套弹窗 */}
          {isDeletingLedger && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md">
              <div className="bg-white/95 p-6 rounded-2xl shadow-2xl border border-red-200 w-96 flex flex-col gap-4">
                <h3 className="text-lg font-bold text-red-700 flex items-center gap-2">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  高危操作：删除账套
                </h3>

                <p className="text-sm text-slate-700 leading-relaxed">
                  您正在尝试删除账套 <strong className="text-black">{currentLedger?.name}</strong>。
                  <br />
                  该操作将永久清空该账套下的所有凭证、科目和期初数据，并且
                  <strong>绝对无法恢复</strong>！
                </p>

                <div className="bg-slate-100 p-3 rounded text-center border border-slate-200">
                  <span className="text-xs text-slate-500 block mb-1">
                    请在下方输入验证码以解锁删除按钮
                  </span>
                  <div className="font-mono text-lg font-bold tracking-widest text-slate-800 select-none bg-white py-2 rounded shadow-sm border border-slate-300">
                    {deleteValidationCode}
                  </div>
                </div>

                <input
                  className="glass-input font-mono !border-red-300 focus:!border-red-500"
                  placeholder="请准确输入上方提示字符"
                  value={deleteInputCode}
                  onChange={(e) => setDeleteInputCode(e.target.value)}
                  autoComplete="off"
                />

                <div className="flex justify-end gap-3 mt-2">
                  <button
                    className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition"
                    onClick={() => setIsDeletingLedger(false)}
                  >
                    取消操作
                  </button>
                  <button
                    className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 shadow disabled:opacity-50 disabled:cursor-not-allowed transition"
                    disabled={deleteInputCode !== deleteValidationCode}
                    onClick={() => void submitDeleteLedger()}
                  >
                    确认删除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

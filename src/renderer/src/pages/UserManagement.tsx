import { useEffect, useState, type FormEvent, type JSX } from 'react'

interface LedgerRow {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
}

interface UserRow {
  id: number
  username: string
  realName: string
  permissions: Record<string, boolean>
  isAdmin: boolean
  ledgerIds: number[]
}

const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  voucher_entry: true,
  audit: false,
  bookkeeping: false,
  unbookkeep: false,
  system_settings: false,
  ledger_settings: false
}

const PERMISSION_OPTIONS: Array<{ key: keyof typeof DEFAULT_PERMISSIONS; label: string }> = [
  { key: 'voucher_entry', label: '凭证录入' },
  { key: 'audit', label: '审核' },
  { key: 'bookkeeping', label: '记账' },
  { key: 'unbookkeep', label: '反记账' },
  { key: 'system_settings', label: '系统设置' },
  { key: 'ledger_settings', label: '账套设置' }
]

function toggleLedgerId(currentIds: number[], ledgerId: number, checked: boolean): number[] {
  const next = checked ? [...currentIds, ledgerId] : currentIds.filter((id) => id !== ledgerId)
  return Array.from(new Set(next)).sort((left, right) => left - right)
}

function getPermissionSummary(user: UserRow): string {
  if (user.isAdmin) return '全部权限'
  const labels = PERMISSION_OPTIONS.filter((option) => user.permissions[option.key]).map(
    (option) => option.label
  )
  return labels.length > 0 ? labels.join('、') : '无'
}

function getLedgerSummary(user: UserRow, ledgers: LedgerRow[]): string {
  if (user.isAdmin) return '全部账套'
  const labels = ledgers
    .filter((ledger) => user.ledgerIds.includes(ledger.id))
    .map((ledger) => ledger.name)
  return labels.length > 0 ? labels.join('、') : '未分配'
}

export default function UserManagement(): JSX.Element {
  const [users, setUsers] = useState<UserRow[]>([])
  const [ledgers, setLedgers] = useState<LedgerRow[]>([])
  const [permissionDrafts, setPermissionDrafts] = useState<Record<number, Record<string, boolean>>>(
    {}
  )
  const [ledgerDrafts, setLedgerDrafts] = useState<Record<number, number[]>>({})
  const [savingUserId, setSavingUserId] = useState<number | null>(null)
  const [form, setForm] = useState({
    username: '',
    realName: '',
    password: '',
    permissions: { ...DEFAULT_PERMISSIONS },
    ledgerIds: [] as number[]
  })
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const loadUsers = async (): Promise<void> => {
    if (!window.electron) {
      setUsers([])
      setLedgers([])
      return
    }

    try {
      const [userRows, ledgerRows] = await Promise.all([
        window.api.auth.getUsers(),
        window.api.ledger.getAll()
      ])

      const nextUsers = userRows as UserRow[]
      const nextLedgers = ledgerRows as LedgerRow[]
      setUsers(nextUsers)
      setLedgers(nextLedgers)
      setPermissionDrafts(
        Object.fromEntries(
          nextUsers
            .filter((user) => !user.isAdmin)
            .map((user) => [user.id, { ...DEFAULT_PERMISSIONS, ...user.permissions }])
        )
      )
      setLedgerDrafts(
        Object.fromEntries(
          nextUsers.filter((user) => !user.isAdmin).map((user) => [user.id, [...user.ledgerIds]])
        )
      )
    } catch (error) {
      setUsers([])
      setLedgers([])
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '获取用户失败'
      })
    }
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void loadUsers()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [])

  const handleCreate = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持账号管理' })
      return
    }
    if (!form.username.trim()) {
      setMessage({ type: 'error', text: '登录名不能为空' })
      return
    }

    try {
      const result = await window.api.auth.createUser({
        username: form.username.trim(),
        realName: form.realName.trim(),
        password: form.password,
        permissions: form.permissions,
        ledgerIds: form.ledgerIds
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '创建用户失败' })
        return
      }

      setForm({
        username: '',
        realName: '',
        password: '',
        permissions: { ...DEFAULT_PERMISSIONS },
        ledgerIds: []
      })
      setMessage({ type: 'success', text: '用户创建成功' })
      await loadUsers()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '创建用户失败' })
    }
  }

  const handleDelete = async (userId: number): Promise<void> => {
    setMessage(null)
    if (!window.electron) return

    try {
      const result = await window.api.auth.deleteUser(userId)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '删除失败' })
        return
      }
      setMessage({ type: 'success', text: '用户删除成功' })
      await loadUsers()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除失败' })
    }
  }

  const handlePermissionToggle = (
    userId: number,
    permissionKey: keyof typeof DEFAULT_PERMISSIONS,
    checked: boolean
  ): void => {
    setPermissionDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...DEFAULT_PERMISSIONS,
        ...(prev[userId] ?? users.find((user) => user.id === userId)?.permissions ?? {}),
        [permissionKey]: checked
      }
    }))
  }

  const handleLedgerToggle = (userId: number, ledgerId: number, checked: boolean): void => {
    setLedgerDrafts((prev) => ({
      ...prev,
      [userId]: toggleLedgerId(
        prev[userId] ?? users.find((user) => user.id === userId)?.ledgerIds ?? [],
        ledgerId,
        checked
      )
    }))
  }

  const handleCreateLedgerToggle = (ledgerId: number, checked: boolean): void => {
    setForm((prev) => ({
      ...prev,
      ledgerIds: toggleLedgerId(prev.ledgerIds, ledgerId, checked)
    }))
  }

  const handleSavePermissions = async (userId: number): Promise<void> => {
    if (!window.electron) return

    const permissions = permissionDrafts[userId]
    const ledgerIds = ledgerDrafts[userId]
    if (!permissions) return

    setMessage(null)
    setSavingUserId(userId)
    try {
      const result = await window.api.auth.updateUser({
        id: userId,
        permissions,
        ledgerIds: ledgerIds ?? []
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存权限失败' })
        return
      }
      setMessage({ type: 'success', text: '权限已更新' })
      await loadUsers()
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存权限失败' })
    } finally {
      setSavingUserId(null)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleCreate()
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        账号管理
      </h2>

      <form className="glass-panel-light p-3 flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
          <input
            className="glass-input"
            placeholder="登录名"
            value={form.username}
            onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
            autoComplete="username"
          />
          <input
            className="glass-input"
            placeholder="真实姓名"
            value={form.realName}
            onChange={(event) => setForm((prev) => ({ ...prev, realName: event.target.value }))}
          />
          <input
            className="glass-input"
            type="password"
            placeholder="密码（可空）"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            autoComplete="new-password"
          />
          <button className="glass-btn-secondary" type="submit">
            新增用户
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            功能权限
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {PERMISSION_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={form.permissions[option.key]}
                  aria-label={`权限：${option.label}`}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      permissions: { ...prev.permissions, [option.key]: event.target.checked }
                    }))
                  }
                />{' '}
                {option.label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            账套权限
          </span>
          {ledgers.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              当前暂无可分配账套。
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ledgers.map((ledger) => (
                <label
                  key={`create-ledger-${ledger.id}`}
                  className="text-sm"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    checked={form.ledgerIds.includes(ledger.id)}
                    onChange={(event) => handleCreateLedgerToggle(ledger.id, event.target.checked)}
                  />{' '}
                  {ledger.name}
                </label>
              ))}
            </div>
          )}
        </div>
      </form>

      <div className="glass-panel flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[1180px] h-full">
            <div
              className="grid grid-cols-12 py-2 px-3 border-b text-sm font-semibold"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div className="col-span-2">登录名</div>
              <div className="col-span-2">真实姓名</div>
              <div className="col-span-1">角色</div>
              <div className="col-span-3">功能权限</div>
              <div className="col-span-2">账套权限</div>
              <div className="col-span-2 text-right">操作</div>
            </div>

            <div className="overflow-y-auto h-[calc(100%-41px)]">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="grid grid-cols-12 py-2 px-3 border-b text-sm items-start gap-y-2"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-secondary)'
                  }}
                >
                  <div className="col-span-2">{user.username}</div>
                  <div className="col-span-2">{user.realName}</div>
                  <div className="col-span-1">{user.isAdmin ? '管理员' : '普通用户'}</div>
                  <div className="col-span-3">
                    {user.isAdmin ? (
                      getPermissionSummary(user)
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {PERMISSION_OPTIONS.map((option) => (
                          <label
                            key={`${user.id}-${option.key}`}
                            className="text-xs"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(permissionDrafts[user.id]?.[option.key])}
                              onChange={(event) =>
                                handlePermissionToggle(user.id, option.key, event.target.checked)
                              }
                            />{' '}
                            {option.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2">
                    {user.isAdmin ? (
                      getLedgerSummary(user, ledgers)
                    ) : ledgers.length === 0 ? (
                      <span style={{ color: 'var(--color-text-muted)' }}>暂无账套</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {ledgers.map((ledger) => (
                          <label
                            key={`${user.id}-ledger-${ledger.id}`}
                            className="text-xs"
                            style={{ color: 'var(--color-text-secondary)' }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(ledgerDrafts[user.id]?.includes(ledger.id))}
                              onChange={(event) =>
                                handleLedgerToggle(user.id, ledger.id, event.target.checked)
                              }
                            />{' '}
                            {ledger.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 text-right">
                    {!user.isAdmin && (
                      <div className="flex justify-end gap-2">
                        <button
                          className="glass-btn-secondary px-3 py-1 text-xs"
                          onClick={() => void handleSavePermissions(user.id)}
                          disabled={savingUserId === user.id}
                        >
                          {savingUserId === user.id ? '保存中...' : '保存权限'}
                        </button>
                        <button
                          className="glass-btn-secondary px-3 py-1 text-xs"
                          onClick={() => void handleDelete(user.id)}
                          disabled={savingUserId === user.id}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {users.length === 0 && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  暂无用户
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div
          className="text-sm px-2"
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

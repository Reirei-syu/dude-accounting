import { useEffect, useState, type JSX } from 'react'

interface UserRow {
  id: number
  username: string
  realName: string
  permissions: Record<string, boolean>
  isAdmin: boolean
}

const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  voucher_entry: true,
  audit: false,
  bookkeeping: false,
  system_settings: false,
  ledger_settings: false
}

const PERMISSION_OPTIONS: Array<{ key: keyof typeof DEFAULT_PERMISSIONS; label: string }> = [
  { key: 'voucher_entry', label: '凭证录入' },
  { key: 'audit', label: '审核' },
  { key: 'bookkeeping', label: '记账' },
  { key: 'system_settings', label: '系统设置' },
  { key: 'ledger_settings', label: '账套设置' }
]

function getPermissionSummary(user: UserRow): string {
  if (user.isAdmin) return '全部权限'
  const labels = PERMISSION_OPTIONS.filter((option) => user.permissions[option.key]).map(
    (option) => option.label
  )
  return labels.length > 0 ? labels.join('、') : '无'
}

export default function UserManagement(): JSX.Element {
  const [users, setUsers] = useState<UserRow[]>([])
  const [form, setForm] = useState({
    username: '',
    realName: '',
    password: '',
    permissions: { ...DEFAULT_PERMISSIONS }
  })
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const loadUsers = async (): Promise<void> => {
    if (!window.electron) {
      setUsers([])
      return
    }
    try {
      const result = await window.api.auth.getUsers()
      setUsers(result as UserRow[])
    } catch (err) {
      setUsers([])
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '获取用户失败'
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
        permissions: form.permissions
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '创建用户失败' })
        return
      }

      setForm({
        username: '',
        realName: '',
        password: '',
        permissions: { ...DEFAULT_PERMISSIONS }
      })
      setMessage({ type: 'success', text: '用户创建成功' })
      await loadUsers()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '创建用户失败' })
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
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '删除失败' })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        账号管理
      </h2>

      <div className="glass-panel-light p-3 flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-2 items-center">
          <input
            className="glass-input"
            placeholder="登录名"
            value={form.username}
            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
          />
          <input
            className="glass-input"
            placeholder="真实姓名"
            value={form.realName}
            onChange={(e) => setForm((prev) => ({ ...prev, realName: e.target.value }))}
          />
          <input
            className="glass-input"
            placeholder="密码（可空）"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <button className="glass-btn-secondary" onClick={() => void handleCreate()}>
            新增用户
          </button>
        </div>
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
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    permissions: { ...prev.permissions, [option.key]: e.target.checked }
                  }))
                }
              />{' '}
              {option.label}
            </label>
          ))}
        </div>
      </div>

      <div className="glass-panel flex-1 overflow-hidden">
        <div
          className="grid grid-cols-12 py-2 px-3 border-b text-sm font-semibold"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div className="col-span-2">登录名</div>
          <div className="col-span-2">真实姓名</div>
          <div className="col-span-2">角色</div>
          <div className="col-span-4">权限</div>
          <div className="col-span-2 text-right">操作</div>
        </div>
        <div className="overflow-y-auto h-[calc(100%-41px)]">
          {users.map((user) => (
            <div
              key={user.id}
              className="grid grid-cols-12 py-2 px-3 border-b text-sm items-center"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-secondary)'
              }}
            >
              <div className="col-span-2">{user.username}</div>
              <div className="col-span-2">{user.realName}</div>
              <div className="col-span-2">{user.isAdmin ? '管理员' : '普通用户'}</div>
              <div className="col-span-4">{getPermissionSummary(user)}</div>
              <div className="col-span-2 text-right">
                {!user.isAdmin && (
                  <button
                    className="glass-btn-secondary px-3 py-1 text-xs"
                    onClick={() => void handleDelete(user.id)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              暂无用户
            </div>
          )}
        </div>
      </div>

      {message && (
        <div
          className="text-sm px-2"
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

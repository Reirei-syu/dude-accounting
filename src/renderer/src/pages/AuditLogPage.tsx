import { useEffect, useRef, useState, type JSX } from 'react'
import {
  AUDIT_LOG_STATES,
  type AuditLogCursor,
  type AuditLogFilters,
  type AuditLogRow,
  type AuditLogState
} from '../../../shared/contracts/auditLog'
import { useAuthStore } from '../stores/authStore'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

const PAGE_SIZE = 50
const labels: Record<AuditLogState, string> = {
  succeeded: '成功',
  failed: '失败',
  planned: '已计划',
  running: '执行中',
  recovery_required: '需要恢复'
}
const emptyForm = {
  ledgerId: '',
  userId: '',
  module: '',
  action: '',
  status: '',
  operationId: '',
  startTime: '',
  endTime: '',
  keyword: ''
}

function formatTime(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : value
}

function detailsSummary(row: AuditLogRow): string {
  const data = JSON.parse(row.details_json) as Record<string, unknown>
  const parts: string[] = []
  if (data.period) parts.push(`期间：${data.period}`)
  if (typeof data.rowCount === 'number') parts.push(`记录：${data.rowCount} 条`)
  if (typeof data.entryCount === 'number') parts.push(`分录：${data.entryCount} 条`)
  if (data.errorCode) parts.push(`错误：${data.errorCode}`)
  if (data.compensation) {
    const compensation: Record<string, string> = {
      not_needed: '无需补偿',
      pending: '待补偿',
      completed: '补偿完成',
      failed: '补偿失败'
    }
    parts.push(compensation[String(data.compensation)] ?? String(data.compensation))
  }
  if (Array.isArray(data.currentCompletedSteps) && data.currentCompletedSteps.length) {
    parts.push(`当前已完成步骤：${data.currentCompletedSteps.join('、')}`)
  }
  return parts.join('；') || '—'
}

export default function AuditLogPage(): JSX.Element {
  const user = useAuthStore((state) => state.user)
  return user?.isAdmin ? (
    <AuditLogContent key={user.id} />
  ) : (
    <p role="alert">无权限：仅管理员可查看操作日志。</p>
  )
}

function AuditLogContent(): JSX.Element {
  const ledgers = useLedgerStore((state) => state.ledgers)
  const activeTabId = useUIStore((state) => state.activeTabId)
  const [form, setForm] = useState(emptyForm)
  const [filters, setFilters] = useState<AuditLogFilters>({ endTime: new Date().toISOString() })
  const [cursors, setCursors] = useState<Array<AuditLogCursor | undefined>>([undefined])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const exportLock = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
    }
  }, [])

  useEffect(() => {
    const request = ++generation.current
    setBusy(true)
    setRows([])
    setMessage('')
    window.api.auditLog
      .list({ ...filters, cursor: cursors[page], limit: PAGE_SIZE + 1 })
      .then((result) => {
        if (request === generation.current) setRows(result)
      })
      .catch((error: unknown) => {
        if (request === generation.current)
          setMessage(error instanceof Error ? error.message : '获取操作日志失败')
      })
      .finally(() => {
        if (request === generation.current) setBusy(false)
      })
    return () => {
      generation.current += 1
    }
  }, [filters, cursors, page, activeTabId])

  const submit = (reset = false): void => {
    const values = reset ? emptyForm : form
    try {
      const next: AuditLogFilters = {
        endTime: values.endTime ? new Date(values.endTime).toISOString() : new Date().toISOString()
      }
      if (values.startTime) next.startTime = new Date(values.startTime).toISOString()
      if (next.startTime && Date.parse(next.startTime) > Date.parse(next.endTime!))
        throw new Error('开始时间不能晚于结束时间')
      for (const key of ['ledgerId', 'userId'] as const) {
        if (values[key]) {
          const id = Number(values[key])
          if (!Number.isSafeInteger(id) || id < 1) throw new Error('账套和操作人 ID 必须是正整数')
          next[key] = id
        }
      }
      for (const key of ['module', 'action', 'operationId', 'keyword'] as const)
        if (values[key].trim()) next[key] = values[key].trim()
      if (values.status) next.status = values.status as AuditLogState
      if (reset) setForm(emptyForm)
      setPage(0)
      setCursors([undefined])
      setFilters(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '筛选时间无效')
    }
  }

  const exportPage = async (): Promise<void> => {
    if (exportLock.current || busy) return
    exportLock.current = true
    setExporting(true)
    setMessage('')
    try {
      const result = await window.api.auditLog.export({
        filters: { ...filters, cursor: cursors[page], limit: PAGE_SIZE },
        operationId: crypto.randomUUID(),
        choosePath: true
      })
      if (!mounted.current) return
      if (result.cancelled) return
      if (!result.success) throw new Error(result.error || '导出操作日志失败')
      setMessage(`已导出当前筛选页 ${result.rowCount ?? 0} 条，导出动作已留痕。`)
    } catch (error) {
      if (mounted.current) {
        setRows([])
        setMessage(error instanceof Error ? error.message : '导出操作日志失败')
      }
    } finally {
      exportLock.current = false
      if (mounted.current) setExporting(false)
    }
  }

  const visibleRows = rows.slice(0, PAGE_SIZE)
  const inputClass = 'glass-input w-full px-2 py-1.5 text-sm'
  return (
    <section aria-label="操作日志页面" className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">操作日志</h1>
        <p className="text-sm text-muted-foreground">
          管理员专属 · 只读审计 · 时间按本机时区显示 · 敏感详情不对外提供
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="glass-panel p-4 rounded-xl"
      >
        <fieldset disabled={busy || exporting} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <label>
            账套
            <select
              className={inputClass}
              value={form.ledgerId}
              onChange={(e) => setForm({ ...form, ledgerId: e.target.value })}
            >
              <option value="">全部（含已删除账套）</option>
              {ledgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.name}（{ledger.id}）
                </option>
              ))}
            </select>
          </label>
          <label>
            操作人 ID
            <input
              className={inputClass}
              inputMode="numeric"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
            />
          </label>
          {(['module', 'action', 'operationId', 'keyword'] as const).map((key) => (
            <label key={key}>
              {
                {
                  module: '模块',
                  action: '动作类型',
                  operationId: 'operationId',
                  keyword: '关键词（操作人、原因、摘要）'
                }[key]
              }
              <input
                className={inputClass}
                maxLength={200}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <label>
            结果状态
            <select
              className={inputClass}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="">全部</option>
              {AUDIT_LOG_STATES.map((state) => (
                <option key={state} value={state}>
                  {labels[state]}
                </option>
              ))}
            </select>
          </label>
          <label>
            开始时间
            <input
              type="datetime-local"
              className={inputClass}
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </label>
          <label>
            结束时间
            <input
              type="datetime-local"
              className={inputClass}
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </label>
          <div className="flex gap-2 items-end">
            <button className="glass-btn-secondary px-4 py-2" type="submit">
              查询
            </button>
            <button
              className="glass-btn-secondary px-4 py-2"
              type="button"
              onClick={() => submit(true)}
            >
              重置
            </button>
          </div>
        </fieldset>
      </form>
      <div className="flex items-center justify-between gap-3">
        <p>
          第 {page + 1} 页 · 本页 {visibleRows.length} 条 · 每页最多 {PAGE_SIZE} 条
        </p>
        <button
          className="glass-btn-secondary px-3 py-2"
          disabled={busy || exporting || !rows.length}
          onClick={() => void exportPage()}
        >
          {exporting ? '正在导出…' : '导出当前页 CSV'}
        </button>
      </div>
      <p role="status" aria-live="polite">
        {busy ? '正在加载操作日志…' : message}
      </p>
      <div className="glass-panel overflow-x-auto rounded-xl">
        <table className="w-full text-sm" aria-label="操作日志列表">
          <thead>
            <tr>
              {[
                '时间 / ID',
                '账套 / 操作人',
                '模块 / 动作',
                '状态',
                '目标 / operationId',
                '原因 / 审批标记',
                '动作与恢复摘要'
              ].map((title) => (
                <th key={title} className="p-3 text-left whitespace-nowrap">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} className="border-t border-white/10 align-top">
                <td className="p-3 whitespace-nowrap">
                  {formatTime(row.created_at)}
                  <div className="text-xs opacity-60">
                    {row.id > 0 ? '业务' : '文件事件'} #{Math.abs(row.id)}
                  </div>
                </td>
                <td className="p-3">
                  {row.ledger_id === null ? '全局' : `账套 ${row.ledger_id}`}
                  <div>
                    {row.username ?? '未知操作人'}
                    {row.user_id === null ? '' : `（${row.user_id}）`}
                  </div>
                </td>
                <td className="p-3">
                  {row.module}
                  <div>{row.action}</div>
                </td>
                <td className="p-3 whitespace-nowrap">{labels[row.status]}</td>
                <td className="p-3 break-all max-w-64">
                  {row.target_type ?? '—'}
                  {row.target_id ? `：${row.target_id}` : ''}
                  {row.operation_id && <div className="text-xs">{row.operation_id}</div>}
                </td>
                <td className="p-3 break-words max-w-64">
                  {row.reason ?? '—'}
                  <div>{row.approval_tag ?? '—'}</div>
                </td>
                <td className="p-3 min-w-40">{detailsSummary(row)}</td>
              </tr>
            ))}
            {!busy && !rows.length && (
              <tr>
                <td className="p-6 text-center" colSpan={7}>
                  暂无符合条件的操作日志
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <footer className="flex justify-end gap-3">
        <button
          className="glass-btn-secondary px-3 py-2"
          disabled={busy || exporting || page === 0}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </button>
        <button
          className="glass-btn-secondary px-3 py-2"
          disabled={busy || exporting || rows.length <= PAGE_SIZE}
          onClick={() => {
            const last = visibleRows[visibleRows.length - 1]
            setCursors([...cursors.slice(0, page + 1), { createdAt: last.created_at, id: last.id }])
            setPage(page + 1)
          }}
        >
          下一页
        </button>
      </footer>
    </section>
  )
}

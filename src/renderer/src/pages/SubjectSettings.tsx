import { useCallback, useEffect, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

interface SubjectRow {
  id: number
  code: string
  name: string
  category: string
  balance_direction: number
  is_system: number
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'asset', label: '资产' },
  { value: 'liability', label: '负债' },
  { value: 'common', label: '共同' },
  { value: 'equity', label: '权益' },
  { value: 'cost', label: '成本' },
  { value: 'profit_loss', label: '损益' }
]

export default function SubjectSettings(): JSX.Element {
  const currentLedger = useLedgerStore((s) => s.currentLedger)
  const [rows, setRows] = useState<SubjectRow[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'asset',
    balanceDirection: 1
  })
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const loadRows = useCallback(async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setRows([])
      return
    }
    try {
      const subjects = await window.api.subject.getAll(currentLedger.id)
      setRows(subjects as SubjectRow[])
    } catch (err) {
      setRows([])
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '加载科目失败'
      })
    }
  }, [currentLedger])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void loadRows()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [loadRows])

  const handleCreate = async (): Promise<void> => {
    setMessage(null)
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持新增科目' })
      return
    }
    if (!form.code.trim() || !form.name.trim()) {
      setMessage({ type: 'error', text: '请完整填写科目编码和名称' })
      return
    }

    try {
      const result = await window.api.subject.create({
        ledgerId: currentLedger.id,
        code: form.code.trim(),
        name: form.name.trim(),
        parentCode: null,
        category: form.category,
        balanceDirection: form.balanceDirection,
        hasAuxiliary: false,
        isCashFlow: false
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '新增失败' })
        return
      }

      setCreating(false)
      setForm({ code: '', name: '', category: 'asset', balanceDirection: 1 })
      setMessage({ type: 'success', text: '新增科目成功' })
      await loadRows()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '新增失败' })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          会计科目设置
        </h2>
        <button className="glass-btn-secondary" onClick={() => setCreating((prev) => !prev)}>
          {creating ? '取消' : '新增科目'}
        </button>
      </div>

      {creating && (
        <div className="glass-panel-light p-3 grid grid-cols-5 gap-2 items-center">
          <input
            className="glass-input"
            placeholder="科目编码"
            value={form.code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
          />
          <input
            className="glass-input"
            placeholder="科目名称"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <select
            className="glass-input"
            value={form.category}
            onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
          >
            {CATEGORY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <select
            className="glass-input"
            value={form.balanceDirection}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, balanceDirection: Number(e.target.value) }))
            }
          >
            <option value={1}>借方</option>
            <option value={-1}>贷方</option>
          </select>
          <button className="glass-btn-secondary" onClick={() => void handleCreate()}>
            保存
          </button>
        </div>
      )}

      <div className="glass-panel flex-1 overflow-hidden">
        <div
          className="grid grid-cols-12 py-2 px-3 border-b text-sm font-semibold"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div className="col-span-2">编码</div>
          <div className="col-span-4">名称</div>
          <div className="col-span-2">类别</div>
          <div className="col-span-2">方向</div>
          <div className="col-span-2 text-right">类型</div>
        </div>
        <div className="overflow-y-auto h-[calc(100%-41px)]">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-12 py-2 px-3 border-b text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-secondary)'
              }}
            >
              <div className="col-span-2">{row.code}</div>
              <div className="col-span-4">{row.name}</div>
              <div className="col-span-2">{row.category}</div>
              <div className="col-span-2">{row.balance_direction === 1 ? '借' : '贷'}</div>
              <div className="col-span-2 text-right">{row.is_system === 1 ? '系统' : '自定义'}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="py-10 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              当前账套暂无科目
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

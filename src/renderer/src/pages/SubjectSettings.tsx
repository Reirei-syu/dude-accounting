import { useCallback, useEffect, useState, useMemo, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

interface SubjectRow {
  id: number
  code: string
  name: string
  category: string
  balance_direction: number
  is_system: number
  parent_code: string | null
  level: number
}

interface TreeRow extends Omit<SubjectRow, 'id'> {
  id: string | number
  isCategory?: boolean
  __logical_parent: string | null
  __logical_level: number
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'asset', label: '资产' },
  { value: 'liability', label: '负债' },
  { value: 'common', label: '共同' },
  { value: 'equity', label: '权益' },
  { value: 'cost', label: '成本' },
  { value: 'profit_loss', label: '损益' }
]

const ChevronRight = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
)

const ChevronDown = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
)

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

  const categoryLabels = useMemo(() => {
    const isNpo = currentLedger?.standard_type === 'npo'
    return {
      asset: '资产类',
      liability: '负债类',
      common: '共同类',
      equity: isNpo ? '净资产类' : '所有者权益类',
      cost: '成本类',
      profit_loss: '损益类'
    } as Record<string, string>
  }, [currentLedger])

  const treeNodes = useMemo(() => {
    const orderedCategories = ['asset', 'liability', 'common', 'equity', 'cost', 'profit_loss']
    const nodes: TreeRow[] = []
    const catsInDb = new Set(rows.map((r) => r.category))

    for (const cat of orderedCategories) {
      if (!catsInDb.has(cat)) continue

      nodes.push({
        id: `cat_${cat}`,
        code: `cat_${cat}`,
        name: categoryLabels[cat] || cat,
        category: cat,
        balance_direction: 0,
        is_system: 1,
        parent_code: null,
        level: 0,
        isCategory: true,
        __logical_parent: null,
        __logical_level: 0
      })

      const catRows = rows.filter((r) => r.category === cat)
      for (const r of catRows) {
        nodes.push({
          ...r,
          isCategory: false,
          __logical_parent: r.parent_code || `cat_${cat}`,
          __logical_level: r.level || 1
        })
      }
    }
    return nodes
  }, [rows, categoryLabels])

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set())

  const hasChildrenMap = useMemo(() => {
    const map = new Set<string>()
    for (const r of treeNodes) {
      if (r.__logical_parent) map.add(r.__logical_parent)
    }
    return map
  }, [treeNodes])

  const toggleExpand = (code: string): void => {
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  const nodeMap = useMemo(() => {
    const map = new Map<string, TreeRow>()
    for (const node of treeNodes) {
      map.set(node.code, node)
    }
    return map
  }, [treeNodes])

  const visibleRows = useMemo(() => {
    return treeNodes.filter((row) => {
      if (row.isCategory) return true
      let currentParent = row.__logical_parent
      while (currentParent) {
        if (!expandedCodes.has(currentParent)) return false
        const parentRow = nodeMap.get(currentParent)
        currentParent = parentRow?.__logical_parent || null
      }
      return true
    })
  }, [treeNodes, expandedCodes, nodeMap])

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
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          会计科目设置
        </h2>
        <button className="glass-btn-secondary" onClick={() => setCreating((prev) => !prev)}>
          {creating ? '取消' : '新增科目'}
        </button>
      </div>

      {creating && (
        <div className="glass-panel-light p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
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
        <div className="h-full overflow-x-auto">
          <div className="min-w-[840px] h-full">
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
              {visibleRows.map((row) => (
                <div
                  key={row.id}
                  className={`grid grid-cols-12 py-2 px-3 border-b text-sm items-center ${
                    row.isCategory ? 'font-semibold bg-white/40' : ''
                  }`}
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: row.isCategory
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-secondary)'
                  }}
                >
                  <div className="col-span-2">{row.isCategory ? '' : row.code}</div>
                  <div
                    className="col-span-4 flex items-center gap-1"
                    style={{ paddingLeft: `${row.__logical_level * 16}px` }}
                  >
                    {hasChildrenMap.has(row.code) ? (
                      <button
                        className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors rounded shrink-0"
                        onClick={() => toggleExpand(row.code)}
                        aria-label={expandedCodes.has(row.code) ? '折叠' : '展开'}
                      >
                        {expandedCodes.has(row.code) ? <ChevronDown /> : <ChevronRight />}
                      </button>
                    ) : (
                      <div className="w-5 h-5 shrink-0" />
                    )}
                    <span className="truncate">{row.name}</span>
                  </div>
                  <div className="col-span-2 text-slate-500">
                    {row.isCategory ? '' : row.category}
                  </div>
                  <div className="col-span-2">
                    {row.isCategory ? '' : row.balance_direction === 1 ? '借' : '贷'}
                  </div>
                  <div className="col-span-2 text-right">
                    {row.isCategory ? '' : row.is_system === 1 ? '系统' : '自定义'}
                  </div>
                </div>
              ))}
              {visibleRows.length === 0 && rows.length > 0 && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  暂无可见科目
                </div>
              )}
              {rows.length === 0 && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前账套暂无科目
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

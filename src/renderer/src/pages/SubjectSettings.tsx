import { useEffect, useState, type FormEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLedgerStore } from '../stores/ledgerStore'

type SubjectRow = {
  id: number
  ledger_id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  balance_direction: number
  has_auxiliary: number
  is_cash_flow: number
  level: number
  is_system: number
  auxiliary_categories: string[]
  auxiliary_custom_items: AuxiliaryItem[]
}

type AuxiliaryItem = {
  id: number
  code: string
  name: string
}

type SubjectForm = {
  parentCode: string
  code: string
  name: string
  auxiliaryCategories: string[]
  customAuxiliaryItemIds: number[]
  isCashFlow: boolean
}

type TreeRow =
  | {
      kind: 'category'
      id: string
      code: string
      name: string
      logicalParent: null
      logicalLevel: 0
    }
  | {
      kind: 'subject'
      id: number
      code: string
      name: string
      logicalParent: string
      logicalLevel: number
      row: SubjectRow
    }

function getCategoryOrder(standardType?: 'enterprise' | 'npo'): string[] {
  return standardType === 'npo'
    ? ['asset', 'liability', 'net_assets', 'income', 'expense']
    : ['asset', 'liability', 'common', 'equity', 'cost', 'profit_loss']
}

const AUXILIARY_CATEGORY_OPTIONS = [
  { value: 'customer', label: '客户' },
  { value: 'supplier', label: '供应商' },
  { value: 'employee', label: '员工' },
  { value: 'project', label: '项目' },
  { value: 'department', label: '部门' },
  { value: 'custom', label: '自定义' }
] as const

function getCategoryLabel(category: string, standardType?: 'enterprise' | 'npo'): string {
  const labels: Record<string, string> = {
    asset: '资产类',
    liability: '负债类',
    common: '共同类',
    equity: standardType === 'npo' ? '净资产类' : '所有者权益类',
    net_assets: '净资产类',
    income: '收入类',
    expense: '费用类',
    cost: '成本类',
    profit_loss: '损益类'
  }

  return labels[category] ?? category
}

function getBalanceDirectionLabel(direction: number): string {
  return direction === 1 ? '借方' : '贷方'
}

function getAuxiliaryLabel(category: string): string {
  return AUXILIARY_CATEGORY_OPTIONS.find((item) => item.value === category)?.label ?? category
}

function getCategoryNodeCode(category: string): string {
  return `__category__${category}`
}

function buildTreeRows(rows: SubjectRow[], standardType?: 'enterprise' | 'npo'): TreeRow[] {
  const treeRows: TreeRow[] = []
  const categoryOrder = getCategoryOrder(standardType)

  for (const category of categoryOrder) {
    const categoryRows = rows.filter((row) => row.category === category)
    if (categoryRows.length === 0) {
      continue
    }

    treeRows.push({
      kind: 'category',
      id: getCategoryNodeCode(category),
      code: getCategoryNodeCode(category),
      name: getCategoryLabel(category, standardType),
      logicalParent: null,
      logicalLevel: 0
    })

    for (const row of categoryRows) {
      treeRows.push({
        kind: 'subject',
        id: row.id,
        code: row.code,
        name: row.name,
        logicalParent: row.parent_code ?? getCategoryNodeCode(category),
        logicalLevel: row.level,
        row
      })
    }
  }

  return treeRows
}

function ChevronRight(): JSX.Element {
  return (
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
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function ChevronDown(): JSX.Element {
  return (
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
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export default function SubjectSettings(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const [rows, setRows] = useState<SubjectRow[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set())
  const [customAuxiliaryItems, setCustomAuxiliaryItems] = useState<AuxiliaryItem[]>([])
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null)
  const [detailSubjectId, setDetailSubjectId] = useState<number | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [form, setForm] = useState<SubjectForm>({
    parentCode: '',
    code: '',
    name: '',
    auxiliaryCategories: [],
    customAuxiliaryItemIds: [],
    isCashFlow: false
  })
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  function applyRows(subjects: SubjectRow[]): void {
    setRows(subjects)
  }

  async function reloadRows(): Promise<void> {
    if (!currentLedger || !window.electron) {
      applyRows([])
      setCustomAuxiliaryItems([])
      return
    }

    const [subjects, customItems] = await Promise.all([
      window.api.subject.getAll(currentLedger.id),
      window.api.auxiliary.getByCategory(currentLedger.id, 'custom')
    ])
    applyRows(subjects as SubjectRow[])
    setCustomAuxiliaryItems(customItems as AuxiliaryItem[])
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Switching ledgers should reopen the tree from a collapsed baseline.
    setExpandedCodes(new Set())
  }, [currentLedger?.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      if (!currentLedger || !window.electron) {
        if (!cancelled) {
          applyRows([])
          setCustomAuxiliaryItems([])
        }
        return
      }

      try {
        const [subjects, customItems] = await Promise.all([
          window.api.subject.getAll(currentLedger.id),
          window.api.auxiliary.getByCategory(currentLedger.id, 'custom')
        ])
        if (!cancelled) {
          applyRows(subjects as SubjectRow[])
          setCustomAuxiliaryItems(customItems as AuxiliaryItem[])
        }
      } catch (error) {
        if (!cancelled) {
          applyRows([])
          setCustomAuxiliaryItems([])
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '加载会计科目失败'
          })
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [currentLedger])

  const selectedSubject =
    rows.find((row) => row.id === selectedSubjectId) ?? (rows.length > 0 ? rows[0] : null)
  const detailSubject = rows.find((row) => row.id === detailSubjectId) ?? null
  const subjectByCode = new Map(rows.map((row) => [row.code, row]))
  const treeRows = buildTreeRows(rows, currentLedger?.standard_type)
  const nodeByCode = new Map(treeRows.map((row) => [row.code, row]))
  const hasChildren = new Set<string>()
  for (const row of treeRows) {
    if (row.logicalParent) {
      hasChildren.add(row.logicalParent)
    }
  }
  const visibleRows = treeRows.filter((row) => {
    if (row.kind === 'category') {
      return true
    }

    let currentParent: string | null = row.logicalParent
    while (currentParent) {
      if (!expandedCodes.has(currentParent)) {
        return false
      }
      const parentNode = nodeByCode.get(currentParent)
      currentParent = parentNode?.logicalParent ?? null
    }
    return true
  })

  const groupedParentSubjects = getCategoryOrder(currentLedger?.standard_type)
    .map((category) => ({
      category,
      label: getCategoryLabel(category, currentLedger?.standard_type),
      subjects: rows.filter((row) => row.category === category)
    }))
    .filter((group) => group.subjects.length > 0)

  const currentParent = form.parentCode ? (subjectByCode.get(form.parentCode) ?? null) : null
  const customAuxiliaryAvailable = customAuxiliaryItems.length > 0

  function toggleExpanded(code: string): void {
    setExpandedCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  function getAuxiliaryDisplayItems(subject: SubjectRow): Array<{ key: string; label: string }> {
    return subject.auxiliary_categories.flatMap((category) => {
      if (category !== 'custom') {
        return [{ key: category, label: getAuxiliaryLabel(category) }]
      }

      if (!subject.auxiliary_custom_items || subject.auxiliary_custom_items.length === 0) {
        return [{ key: 'custom', label: getAuxiliaryLabel(category) }]
      }

      return subject.auxiliary_custom_items.map((item) => ({
        key: `custom-${item.id}`,
        label: item.name
      }))
    })
  }

  function toggleAuxiliaryCategory(category: string): void {
    if (category === 'custom' && !customAuxiliaryAvailable) {
      setMessage({ type: 'error', text: '请先在辅助项中维护自定义明细' })
      return
    }

    setForm((current) => {
      const exists = current.auxiliaryCategories.includes(category)
      const nextCategories = exists
        ? current.auxiliaryCategories.filter((item) => item !== category)
        : [...current.auxiliaryCategories, category]
      const nextCustomItemIds =
        category === 'custom' && exists ? [] : current.customAuxiliaryItemIds

      return {
        ...current,
        auxiliaryCategories: nextCategories,
        customAuxiliaryItemIds: nextCustomItemIds
      }
    })
  }

  function toggleCustomAuxiliaryItem(itemId: number): void {
    setForm((current) => {
      const exists = current.customAuxiliaryItemIds.includes(itemId)
      return {
        ...current,
        customAuxiliaryItemIds: exists
          ? current.customAuxiliaryItemIds.filter((id) => id !== itemId)
          : [...current.customAuxiliaryItemIds, itemId]
      }
    })
  }

  function collapseAll(): void {
    setExpandedCodes(new Set())
  }

  function closeDialog(): void {
    setDialogMode(null)
    setMessage(null)
  }

  function openCreateDialog(): void {
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (rows.length === 0) {
      setMessage({ type: 'error', text: '当前账套暂无可用上级科目' })
      return
    }

    setForm({
      parentCode: selectedSubject?.code ?? rows[0].code,
      code: '',
      name: '',
      auxiliaryCategories: [],
      customAuxiliaryItemIds: [],
      isCashFlow: false
    })
    setDialogMode('create')
    setMessage(null)
  }

  function openEditDialog(): void {
    if (!selectedSubject) {
      setMessage({ type: 'error', text: '请先选择要编辑的科目' })
      return
    }

    setForm({
      parentCode: selectedSubject.parent_code ?? '',
      code: selectedSubject.code,
      name: selectedSubject.name,
      auxiliaryCategories: [...selectedSubject.auxiliary_categories],
      customAuxiliaryItemIds: selectedSubject.auxiliary_custom_items.map((item) => item.id),
      isCashFlow: selectedSubject.is_cash_flow === 1
    })
    setDialogMode('edit')
    setMessage(null)
  }

  function openDetailDialog(): void {
    if (!selectedSubject) {
      setMessage({ type: 'error', text: '请先选择科目查看详情' })
      return
    }

    setDetailSubjectId(selectedSubject.id)
    setIsDetailOpen(true)
    setMessage(null)
  }

  function closeDetailDialog(): void {
    setIsDetailOpen(false)
    setDetailSubjectId(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)

    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }

    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持账套设置操作' })
      return
    }

    if (form.auxiliaryCategories.includes('custom')) {
      if (!customAuxiliaryAvailable) {
        setMessage({ type: 'error', text: '自定义辅助项下暂无明细，请先维护' })
        return
      }
      if (form.customAuxiliaryItemIds.length === 0) {
        setMessage({ type: 'error', text: '自定义辅助项至少选择一个明细' })
        return
      }
    }

    try {
      if (dialogMode === 'create') {
        if (!form.parentCode.trim()) {
          setMessage({ type: 'error', text: '请选择上级科目' })
          return
        }
        if (!form.code.trim() || !form.name.trim()) {
          setMessage({ type: 'error', text: '请完整填写科目编码和科目名称' })
          return
        }

        const result = await window.api.subject.create({
          ledgerId: currentLedger.id,
          parentCode: form.parentCode.trim(),
          code: form.code.trim(),
          name: form.name.trim(),
          auxiliaryCategories: form.auxiliaryCategories,
          customAuxiliaryItemIds: form.customAuxiliaryItemIds,
          isCashFlow: form.isCashFlow
        })

        if (!result.success) {
          setMessage({ type: 'error', text: result.error || '新增科目失败' })
          return
        }
      }

      if (dialogMode === 'edit' && selectedSubject) {
        if (!selectedSubject.is_system && !form.name.trim()) {
          setMessage({ type: 'error', text: '科目名称不能为空' })
          return
        }

        const result = await window.api.subject.update({
          subjectId: selectedSubject.id,
          name: selectedSubject.is_system === 1 ? undefined : form.name.trim(),
          auxiliaryCategories: form.auxiliaryCategories,
          customAuxiliaryItemIds: form.customAuxiliaryItemIds,
          isCashFlow: form.isCashFlow
        })

        if (!result.success) {
          setMessage({ type: 'error', text: result.error || '修改科目失败' })
          return
        }
      }

      closeDialog()
      await reloadRows()
      setMessage({
        type: 'success',
        text: dialogMode === 'create' ? '科目创建成功' : '科目修改成功'
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存科目失败'
      })
    }
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          会计科目设置
        </h2>
        <div className="flex items-center gap-2">
          <button className="glass-btn-secondary" onClick={openCreateDialog}>
            新增科目
          </button>
          <button
            className="glass-btn-secondary"
            onClick={openEditDialog}
            disabled={!selectedSubject}
            style={!selectedSubject ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            编辑科目
          </button>
          <button
            className="glass-btn-secondary"
            onClick={openDetailDialog}
            disabled={!selectedSubject}
            style={!selectedSubject ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            科目详情
          </button>
          <button
            className="glass-btn-secondary"
            onClick={collapseAll}
            disabled={expandedCodes.size === 0}
            style={expandedCodes.size === 0 ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            全部收起
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="glass-panel overflow-hidden flex flex-col h-full">
          <div
            className="grid grid-cols-[140px_minmax(0,1fr)_110px_90px_88px] gap-3 px-4 py-3 text-sm font-semibold border-b"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              color: 'var(--color-text-primary)'
            }}
          >
            <div>科目编码</div>
            <div>科目名称</div>
            <div>类别</div>
            <div>方向</div>
            <div className="text-right">属性</div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {visibleRows.length === 0 ? (
              <div
                className="py-10 text-center text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                当前账套暂无科目
              </div>
            ) : (
              visibleRows.map((row) => {
                const isCategory = row.kind === 'category'
                const isSelected = row.kind === 'subject' && row.id === selectedSubjectId
                const logicalLevel = row.logicalLevel

                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-[140px_minmax(0,1fr)_110px_90px_88px] gap-3 px-2 py-2 rounded-lg text-sm items-center transition-colors ${
                      isSelected ? 'bg-slate-900/8' : ''
                    }`}
                    style={{
                      color: isCategory
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-secondary)'
                    }}
                  >
                    <div>{isCategory ? '' : row.row.code}</div>
                    <div
                      className="flex items-center gap-1 min-w-0"
                      style={{ paddingLeft: `${logicalLevel * 14}px` }}
                    >
                      {hasChildren.has(row.code) ? (
                        <button
                          type="button"
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 hover:bg-black/5 shrink-0"
                          onClick={() => toggleExpanded(row.code)}
                          aria-label={expandedCodes.has(row.code) ? '折叠' : '展开'}
                        >
                          {expandedCodes.has(row.code) ? <ChevronDown /> : <ChevronRight />}
                        </button>
                      ) : (
                        <span className="w-5 h-5 shrink-0" />
                      )}

                      {isCategory ? (
                        <span className="truncate font-semibold">{row.name}</span>
                      ) : (
                        <button
                          type="button"
                          className="truncate text-left hover:text-slate-950"
                          onClick={() => setSelectedSubjectId(row.id)}
                        >
                          {row.name}
                        </button>
                      )}
                    </div>
                    <div>
                      {isCategory
                        ? ''
                        : getCategoryLabel(row.row.category, currentLedger?.standard_type)}
                    </div>
                    <div>
                      {isCategory ? '' : getBalanceDirectionLabel(row.row.balance_direction)}
                    </div>
                    <div className="text-right">
                      {isCategory ? '' : row.row.is_system === 1 ? '系统' : '自定义'}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
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

      <Dialog.Root open={isDetailOpen} onOpenChange={(open) => !open && closeDetailDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(720px,calc(100vw-32px))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.88)' }}
          >
            <Dialog.Title
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              科目详情
            </Dialog.Title>

            {!detailSubject ? (
              <div
                className="py-8 text-center text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                请选择科目查看详情
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      科目编码
                    </div>
                    <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {detailSubject.code}
                    </div>
                  </div>
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      科目名称
                    </div>
                    <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                      {detailSubject.name}
                    </div>
                  </div>
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      科目类别
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>
                      {getCategoryLabel(detailSubject.category, currentLedger?.standard_type)}
                    </div>
                  </div>
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      余额方向
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>
                      {getBalanceDirectionLabel(detailSubject.balance_direction)}
                    </div>
                  </div>
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      科目属性
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>
                      {detailSubject.is_system === 1 ? '系统科目' : '自定义科目'}
                    </div>
                  </div>
                  <div className="glass-panel-light p-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      上级科目
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>
                      {detailSubject.parent_code
                        ? `${detailSubject.parent_code} ${subjectByCode.get(detailSubject.parent_code)?.name ?? ''}`.trim()
                        : '无'}
                    </div>
                  </div>
                </div>

                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                    辅助项
                  </div>
                  {detailSubject.auxiliary_categories.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)' }}>未启用辅助项</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {getAuxiliaryDisplayItems(detailSubject).map((item) => (
                        <span
                          key={item.key}
                          className="px-2 py-1 rounded-full text-xs font-medium bg-slate-900/8"
                          style={{ color: 'var(--color-text-primary)' }}
                        >
                          {item.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    现金流量科目
                  </div>
                  <div style={{ color: 'var(--color-text-primary)' }}>
                    {detailSubject.is_cash_flow === 1 ? '是' : '否'}
                  </div>
                </div>

                {detailSubject.is_system === 1 && (
                  <div
                    className="rounded-xl px-3 py-3 text-sm"
                    style={{
                      backgroundColor: 'rgba(15, 23, 42, 0.06)',
                      color: 'var(--color-text-secondary)'
                    }}
                  >
                    系统科目遵循当前会计准则模板，编码和名称不可修改；本页仍可为其配置辅助项和现金流量标记。
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-4">
              <button type="button" className="glass-btn-secondary" onClick={closeDetailDialog}>
                关闭
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(680px,calc(100vw-32px))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.88)' }}
          >
            <Dialog.Title
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {dialogMode === 'create' ? '新增会计科目' : '编辑会计科目'}
            </Dialog.Title>

            <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
              {dialogMode === 'create' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold text-slate-700">上级科目</label>
                    <select
                      className="glass-input"
                      value={form.parentCode}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, parentCode: event.target.value }))
                      }
                    >
                      <option value="">请选择上级科目</option>
                      {groupedParentSubjects.map((group) => (
                        <optgroup key={group.category} label={group.label}>
                          {group.subjects.map((subject) => (
                            <option key={subject.id} value={subject.code}>
                              {subject.code} {subject.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="glass-panel-light px-3 py-2">
                      <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        继承类别
                      </div>
                      <div
                        className="text-sm font-medium"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {currentParent
                          ? getCategoryLabel(currentParent.category, currentLedger?.standard_type)
                          : '-'}
                      </div>
                    </div>
                    <div className="glass-panel-light px-3 py-2">
                      <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        继承方向
                      </div>
                      <div
                        className="text-sm font-medium"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {currentParent
                          ? getBalanceDirectionLabel(currentParent.balance_direction)
                          : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {dialogMode === 'edit' && selectedSubject && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="glass-panel-light px-3 py-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      科目编码
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>{selectedSubject.code}</div>
                  </div>
                  <div className="glass-panel-light px-3 py-3">
                    <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                      上级科目
                    </div>
                    <div style={{ color: 'var(--color-text-primary)' }}>
                      {selectedSubject.parent_code
                        ? `${selectedSubject.parent_code} ${subjectByCode.get(selectedSubject.parent_code)?.name ?? ''}`.trim()
                        : '无'}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">科目编码</label>
                  <input
                    className="glass-input"
                    value={form.code}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, code: event.target.value }))
                    }
                    placeholder="例如：112201"
                    disabled={dialogMode === 'edit'}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">科目名称</label>
                  <input
                    className="glass-input"
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="请输入科目名称"
                    disabled={dialogMode === 'edit' && selectedSubject?.is_system === 1}
                  />
                </div>
              </div>

              <div className="glass-panel-light p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div
                      className="text-sm font-semibold"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      辅助项配置
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      新建和修改科目时都可以增加或减少辅助项，支持多选。
                    </div>
                  </div>
                  <label
                    className="inline-flex items-center gap-2 text-sm"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={form.isCashFlow}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, isCashFlow: event.target.checked }))
                      }
                    />
                    现金流量科目
                  </label>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                  {AUXILIARY_CATEGORY_OPTIONS.map((item) => {
                    const checked = form.auxiliaryCategories.includes(item.value)
                    const isCustom = item.value === 'custom'
                    const disabled = isCustom && !customAuxiliaryAvailable
                    return (
                      <label
                        key={item.value}
                        className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                          checked ? 'bg-slate-900/8' : 'bg-white/40'
                        } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        style={{
                          borderColor: 'var(--color-glass-border-light)',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <input
                          type="checkbox"
                          className="mr-2"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleAuxiliaryCategory(item.value)}
                        />
                        {item.label}
                      </label>
                    )
                  })}
                </div>

                {!customAuxiliaryAvailable && (
                  <div className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                    自定义辅助项暂无明细，请先在辅助项模块维护后再启用。
                  </div>
                )}

                {form.auxiliaryCategories.includes('custom') && (
                  <div className="mt-4">
                    <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                      自定义明细
                    </div>
                    {customAuxiliaryItems.length === 0 ? (
                      <div style={{ color: 'var(--color-text-muted)' }}>暂无自定义明细</div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {customAuxiliaryItems.map((item) => {
                          const checked = form.customAuxiliaryItemIds.includes(item.id)
                          return (
                            <label
                              key={item.id}
                              className={`rounded-xl border px-3 py-2 text-sm cursor-pointer transition-colors ${
                                checked ? 'bg-slate-900/8' : 'bg-white/40'
                              }`}
                              style={{
                                borderColor: 'var(--color-glass-border-light)',
                                color: 'var(--color-text-primary)'
                              }}
                            >
                              <input
                                type="checkbox"
                                className="mr-2"
                                checked={checked}
                                onChange={() => toggleCustomAuxiliaryItem(item.id)}
                              />
                              {item.name}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedSubject?.is_system === 1 && dialogMode === 'edit' && (
                <div
                  className="rounded-xl px-3 py-3 text-sm"
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.06)',
                    color: 'var(--color-text-secondary)'
                  }}
                >
                  当前为系统科目，本次修改只会保存辅助项和现金流量配置。
                </div>
              )}

              {message && dialogMode && (
                <div
                  className="text-sm px-1"
                  style={{
                    color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
                  }}
                >
                  {message.text}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="glass-btn-secondary" onClick={closeDialog}>
                  取消
                </button>
                <button type="submit" className="glass-btn-secondary">
                  保存
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

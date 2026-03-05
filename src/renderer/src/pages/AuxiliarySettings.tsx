import { useEffect, useState, type FormEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLedgerStore } from '../stores/ledgerStore'

type AuxiliaryItem = {
  id: number
  ledger_id: number
  category: string
  code: string
  name: string
  created_at?: string
}

type AuxiliaryForm = {
  code: string
  name: string
  category: string
}

const CATEGORIES = [
  { id: 'customer', label: '客户' },
  { id: 'supplier', label: '供应商' },
  { id: 'employee', label: '员工' },
  { id: 'project', label: '项目' },
  { id: 'department', label: '部门' },
  { id: 'custom', label: '自定义' }
] as const

function getCategoryLabel(category: string): string {
  return CATEGORIES.find((item) => item.id === category)?.label ?? category
}

export default function AuxiliarySettings(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const [items, setItems] = useState<AuxiliaryItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('customer')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<AuxiliaryItem | null>(null)
  const [form, setForm] = useState<AuxiliaryForm>({
    code: '',
    name: '',
    category: 'customer'
  })
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const visibleItems = items.filter((item) => item.category === activeCategory)

  async function reloadItems(): Promise<void> {
    if (!currentLedger || !window.electron) {
      setItems([])
      return
    }

    const nextItems = (await window.api.auxiliary.getAll(currentLedger.id)) as AuxiliaryItem[]
    setItems(nextItems)
  }

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      if (!currentLedger || !window.electron) {
        if (!cancelled) {
          setItems([])
        }
        return
      }

      try {
        const nextItems = (await window.api.auxiliary.getAll(currentLedger.id)) as AuxiliaryItem[]
        if (!cancelled) {
          setItems(nextItems)
        }
      } catch (error) {
        if (!cancelled) {
          setItems([])
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '加载辅助账失败'
          })
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [currentLedger])

  function openCreateDialog(): void {
    setEditingItem(null)
    setForm({ code: '', name: '', category: activeCategory })
    setMessage(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(item: AuxiliaryItem): void {
    setEditingItem(item)
    setForm({
      code: item.code,
      name: item.name,
      category: item.category
    })
    setMessage(null)
    setIsDialogOpen(true)
  }

  function closeDialog(): void {
    setIsDialogOpen(false)
    setEditingItem(null)
    setMessage(null)
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)

    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }

    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持辅助账设置操作' })
      return
    }

    if (!form.code.trim() || !form.name.trim()) {
      setMessage({ type: 'error', text: '请完整填写辅助账编码和名称' })
      return
    }

    try {
      const result = editingItem
        ? await window.api.auxiliary.update({
            id: editingItem.id,
            code: form.code.trim(),
            name: form.name.trim()
          })
        : await window.api.auxiliary.create({
            ledgerId: currentLedger.id,
            category: form.category,
            code: form.code.trim(),
            name: form.name.trim()
          })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存辅助账失败' })
        return
      }

      closeDialog()
      await reloadItems()
      setMessage({
        type: 'success',
        text: editingItem ? '辅助账修改成功' : '辅助账新增成功'
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存辅助账失败'
      })
    }
  }

  async function handleDelete(id: number): Promise<void> {
    if (!window.electron) {
      return
    }

    if (!window.confirm('确定要删除这个辅助账吗？')) {
      return
    }

    try {
      const result = await window.api.auxiliary.delete(id)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '删除辅助账失败' })
        return
      }

      await reloadItems()
      setMessage({ type: 'success', text: '辅助账删除成功' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '删除辅助账失败'
      })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          辅助账设置
        </h2>
        <button className="glass-btn-primary" onClick={openCreateDialog}>
          新增辅助账
        </button>
      </div>

      {message && !isDialogOpen && (
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

      <div className="flex flex-1 overflow-hidden gap-4">
        <div className="glass-panel w-52 flex flex-col p-2 overflow-y-auto">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              className={`text-left px-3 py-2 rounded-lg transition-colors ${
                activeCategory === category.id ? 'bg-slate-900/8 font-semibold' : 'hover:bg-black/5'
              }`}
              style={{
                color:
                  activeCategory === category.id
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)'
              }}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>

        <div className="glass-panel flex-1 overflow-hidden flex flex-col">
          <div
            className="px-4 py-3 border-b flex items-center justify-between gap-3"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                {getCategoryLabel(activeCategory)}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                当前分类共 {visibleItems.length} 条辅助账档案
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className="border-b"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-primary)'
                  }}
                >
                  <th className="py-2 px-3 font-semibold">编码</th>
                  <th className="py-2 px-3 font-semibold">名称</th>
                  <th className="py-2 px-3 font-semibold">分类</th>
                  <th className="py-2 px-3 font-semibold text-right">操作</th>
                </tr>
              </thead>

              <tbody>
                {visibleItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-0 hover:bg-white/10 transition-colors"
                    style={{
                      borderColor: 'var(--color-glass-border-light)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <td className="py-2 px-3">{item.code}</td>
                    <td className="py-2 px-3">{item.name}</td>
                    <td className="py-2 px-3">{getCategoryLabel(item.category)}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        className="text-blue-600 hover:underline mr-3 text-sm"
                        onClick={() => openEditDialog(item)}
                      >
                        编辑
                      </button>
                      <button
                        className="text-red-500 hover:underline text-sm"
                        onClick={() => void handleDelete(item.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {visibleItems.length === 0 && (
              <div
                className="py-12 text-center text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                当前分类暂无辅助账档案
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog.Root open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.88)' }}
          >
            <Dialog.Title
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {editingItem ? '修改辅助账' : '新增辅助账'}
            </Dialog.Title>

            <form onSubmit={(event) => void handleSave(event)} className="flex flex-col gap-4">
              {message && isDialogOpen && (
                <div
                  className="text-sm p-2 rounded"
                  style={{
                    backgroundColor:
                      message.type === 'error'
                        ? 'rgba(239, 68, 68, 0.1)'
                        : 'rgba(34, 197, 94, 0.1)',
                    color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
                  }}
                >
                  {message.text}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-slate-700">所属分类</label>
                <select
                  className="glass-input w-full"
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, category: event.target.value }))
                  }
                  disabled={editingItem !== null}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-slate-700">辅助账编码</label>
                <input
                  className="glass-input w-full"
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, code: event.target.value }))
                  }
                  placeholder="例如：KH001"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-slate-700">辅助账名称</label>
                <input
                  className="glass-input w-full"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="请输入辅助账名称"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="glass-btn-secondary" onClick={closeDialog}>
                  取消
                </button>
                <button type="submit" className="glass-btn-primary">
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

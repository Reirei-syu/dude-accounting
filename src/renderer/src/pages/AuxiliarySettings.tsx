import { useCallback, useEffect, useState, useMemo, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import * as Dialog from '@radix-ui/react-dialog'

interface AuxiliaryItem {
  id: number
  ledger_id: number
  category: string
  code: string
  name: string
  created_at: string
}

const CATEGORIES = [
  { id: 'customer', label: '客户' },
  { id: 'supplier', label: '供应商' },
  { id: 'employee', label: '职员' },
  { id: 'project', label: '项目' },
  { id: 'department', label: '部门' },
  { id: 'custom', label: '自定义' }
]

export default function AuxiliarySettings(): JSX.Element {
  const currentLedger = useLedgerStore((s) => s.currentLedger)
  const [items, setItems] = useState<AuxiliaryItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('customer')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<AuxiliaryItem | null>(null)

  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'customer'
  })

  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const loadItems = useCallback(async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setItems([])
      return
    }
    try {
      const data = await window.api.auxiliary.getAll(currentLedger.id)
      setItems(data as AuxiliaryItem[])
    } catch (err) {
      setItems([])
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '加载辅助核算项失败'
      })
    }
  }, [currentLedger])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const visibleItems = useMemo(
    () => items.filter((item) => item.category === activeCategory),
    [items, activeCategory]
  )

  const openCreateDialog = () => {
    setEditingItem(null)
    setForm({ code: '', name: '', category: activeCategory })
    setIsDialogOpen(true)
    setMessage(null)
  }

  const openEditDialog = (item: AuxiliaryItem) => {
    setEditingItem(item)
    setForm({ code: item.code, name: item.name, category: item.category })
    setIsDialogOpen(true)
    setMessage(null)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)

    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) return
    if (!form.code.trim() || !form.name.trim()) {
      setMessage({ type: 'error', text: '请完整填写入编码和名称' })
      return
    }

    try {
      let result
      if (editingItem) {
        result = await window.api.auxiliary.update({
          id: editingItem.id,
          code: form.code.trim(),
          name: form.name.trim()
        })
      } else {
        result = await window.api.auxiliary.create({
          ledgerId: currentLedger.id,
          category: form.category,
          code: form.code.trim(),
          name: form.name.trim()
        })
      }

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存失败' })
        return
      }

      setIsDialogOpen(false)
      await loadItems()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '保存失败' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.electron) return
    if (!confirm('确定要删除该辅助核算项吗？')) return

    try {
      const result = await window.api.auxiliary.delete(id)
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '删除失败' })
        return
      }
      await loadItems()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '删除失败' })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          辅助账设置
        </h2>
        <button className="glass-btn-primary" onClick={openCreateDialog}>
          新增核算项
        </button>
      </div>

      {message && !isDialogOpen && (
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

      <div className="flex flex-1 overflow-hidden gap-4">
        {/* Left Sidebar: Categories */}
        <div className="glass-panel w-48 flex flex-col p-2 overflow-y-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`text-left px-3 py-2 rounded transition-colors ${
                activeCategory === cat.id ? 'bg-blue-500/20 font-semibold' : 'hover:bg-black/5'
              }`}
              style={{
                color:
                  activeCategory === cat.id
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)'
              }}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Right Content: Items List */}
        <div className="glass-panel flex-1 flex flex-col overflow-hidden">
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
                className="py-10 text-center text-sm"
                style={{ color: 'var(--color-text-muted)' }}
              >
                当前分类暂无核算项
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog.Root open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] w-full max-w-md p-6 z-50 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.85)' }}
          >
            <Dialog.Title
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {editingItem ? '修改辅助核算项' : '新增辅助核算项'}
            </Dialog.Title>

            <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-4">
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
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  disabled={!!editingItem} // Category cannot be changed once created usually
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-slate-700">核算项编码</label>
                <input
                  className="glass-input w-full"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="例如: 001"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-slate-700">核算项名称</label>
                <input
                  className="glass-input w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="请输入名称"
                />
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  className="glass-btn-secondary"
                  onClick={() => setIsDialogOpen(false)}
                >
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

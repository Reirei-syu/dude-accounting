import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLedgerStore } from '../stores/ledgerStore'

type SubjectRow = {
  code: string
  name: string
  is_cash_flow: number
}

type CashFlowItem = {
  id: number
  code: string
  name: string
  category: 'operating' | 'investing' | 'financing'
  direction: 'inflow' | 'outflow'
}

type CashFlowMappingRow = {
  id: number
  ledger_id: number
  subject_code: string
  subject_name: string | null
  counterpart_subject_code: string
  counterpart_subject_name: string | null
  entry_direction: 'inflow' | 'outflow'
  cash_flow_item_id: number
  cash_flow_item_code: string | null
  cash_flow_item_name: string | null
}

type MappingForm = {
  subjectCode: string
  counterpartSubjectCode: string
  entryDirection: 'inflow' | 'outflow'
  cashFlowItemId: number | null
}

const EMPTY_FORM: MappingForm = {
  subjectCode: '',
  counterpartSubjectCode: '',
  entryDirection: 'outflow',
  cashFlowItemId: null
}

function getDirectionLabel(direction: 'inflow' | 'outflow'): string {
  return direction === 'inflow' ? '流入（借方发生）' : '流出（贷方发生）'
}

export default function CashFlowMapping(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)

  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [cashFlowItems, setCashFlowItems] = useState<CashFlowItem[]>([])
  const [mappings, setMappings] = useState<CashFlowMappingRow[]>([])
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<CashFlowMappingRow | null>(null)
  const [form, setForm] = useState<MappingForm>(EMPTY_FORM)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const cashFlowSubjects = useMemo(() => {
    return subjects.filter((subject) => subject.is_cash_flow === 1)
  }, [subjects])

  async function reloadAll(): Promise<void> {
    if (!currentLedger || !window.electron) {
      setSubjects([])
      setCashFlowItems([])
      setMappings([])
      return
    }

    const [nextSubjects, nextItems, nextMappings] = await Promise.all([
      window.api.subject.getAll(currentLedger.id),
      window.api.cashflow.getItems(currentLedger.id),
      window.api.cashflow.getMappings(currentLedger.id)
    ])

    setSubjects(nextSubjects as SubjectRow[])
    setCashFlowItems(nextItems as CashFlowItem[])
    setMappings(nextMappings as CashFlowMappingRow[])
  }

  useEffect(() => {
    let cancelled = false

    const run = async (): Promise<void> => {
      if (!currentLedger || !window.electron) {
        if (!cancelled) {
          setSubjects([])
          setCashFlowItems([])
          setMappings([])
        }
        return
      }

      try {
        const [nextSubjects, nextItems, nextMappings] = await Promise.all([
          window.api.subject.getAll(currentLedger.id),
          window.api.cashflow.getItems(currentLedger.id),
          window.api.cashflow.getMappings(currentLedger.id)
        ])

        if (!cancelled) {
          setSubjects(nextSubjects as SubjectRow[])
          setCashFlowItems(nextItems as CashFlowItem[])
          setMappings(nextMappings as CashFlowMappingRow[])
        }
      } catch (error) {
        if (!cancelled) {
          setSubjects([])
          setCashFlowItems([])
          setMappings([])
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : '加载现金流匹配设置失败'
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
    setEditingRow(null)
    setForm(EMPTY_FORM)
    setMessage(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(row: CashFlowMappingRow): void {
    setEditingRow(row)
    setForm({
      subjectCode: row.subject_code,
      counterpartSubjectCode: row.counterpart_subject_code,
      entryDirection: row.entry_direction,
      cashFlowItemId: row.cash_flow_item_id
    })
    setMessage(null)
    setIsDialogOpen(true)
  }

  function closeDialog(): void {
    setIsDialogOpen(false)
    setEditingRow(null)
    setForm(EMPTY_FORM)
    setMessage(null)
  }

  function normalizeErrorText(text: string): string {
    if (text.includes('UNIQUE constraint failed')) {
      return '该匹配规则已存在，请勿重复保存'
    }
    return text
  }

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)

    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持匹配规则设置操作' })
      return
    }
    if (!form.subjectCode || !form.counterpartSubjectCode || form.cashFlowItemId === null) {
      setMessage({ type: 'error', text: '请完整填写现金流科目、对方科目与现金流量项目' })
      return
    }

    try {
      const result = editingRow
        ? await window.api.cashflow.updateMapping({
            id: editingRow.id,
            subjectCode: form.subjectCode,
            counterpartSubjectCode: form.counterpartSubjectCode,
            entryDirection: form.entryDirection,
            cashFlowItemId: form.cashFlowItemId
          })
        : await window.api.cashflow.createMapping({
            ledgerId: currentLedger.id,
            subjectCode: form.subjectCode,
            counterpartSubjectCode: form.counterpartSubjectCode,
            entryDirection: form.entryDirection,
            cashFlowItemId: form.cashFlowItemId
          })

      if (!result.success) {
        setMessage({
          type: 'error',
          text: normalizeErrorText(result.error || '保存匹配规则失败')
        })
        return
      }

      closeDialog()
      await reloadAll()
      setMessage({
        type: 'success',
        text: editingRow ? '匹配规则修改成功' : '匹配规则新增成功'
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? normalizeErrorText(error.message) : '保存匹配规则失败'
      })
    }
  }

  async function handleDelete(id: number): Promise<void> {
    if (!window.electron) return
    if (!window.confirm('确定删除该现金流匹配规则吗？')) return

    try {
      const result = await window.api.cashflow.deleteMapping(id)
      if (!result.success) {
        setMessage({
          type: 'error',
          text: normalizeErrorText(result.error || '删除匹配规则失败')
        })
        return
      }
      await reloadAll()
      setMessage({ type: 'success', text: '匹配规则删除成功' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? normalizeErrorText(error.message) : '删除匹配规则失败'
      })
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          现金流量匹配设置
        </h2>
        <button className="glass-btn-primary" onClick={openCreateDialog}>
          新增匹配规则
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

      <div className="glass-panel flex-1 overflow-hidden flex flex-col">
        <div
          className="px-4 py-3 border-b text-sm"
          style={{ borderColor: 'var(--color-glass-border-light)', color: 'var(--color-text-muted)' }}
        >
          当前规则 {mappings.length} 条。保存凭证前会根据“现金流科目 + 对方科目 + 收/付方向”自动分配现金流量项目。
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
                <th className="py-2 px-3 font-semibold">现金流科目</th>
                <th className="py-2 px-3 font-semibold">对方科目</th>
                <th className="py-2 px-3 font-semibold">方向</th>
                <th className="py-2 px-3 font-semibold">现金流量项目</th>
                <th className="py-2 px-3 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((row) => (
                <tr
                  key={row.id}
                  className="border-b last:border-0 hover:bg-white/10 transition-colors"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-primary)'
                  }}
                >
                  <td className="py-2 px-3">
                    {row.subject_code} {row.subject_name ?? ''}
                  </td>
                  <td className="py-2 px-3">
                    {row.counterpart_subject_code} {row.counterpart_subject_name ?? ''}
                  </td>
                  <td className="py-2 px-3">{getDirectionLabel(row.entry_direction)}</td>
                  <td className="py-2 px-3">
                    {row.cash_flow_item_code} {row.cash_flow_item_name}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      className="text-blue-600 hover:underline mr-3 text-sm"
                      onClick={() => openEditDialog(row)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-red-500 hover:underline text-sm"
                      onClick={() => void handleDelete(row.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {mappings.length === 0 && (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
              当前账套暂无匹配规则
            </div>
          )}
        </div>
      </div>

      <Dialog.Root open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(760px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.88)' }}
          >
            <Dialog.Title
              className="text-lg font-bold mb-4"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {editingRow ? '编辑现金流匹配规则' : '新增现金流匹配规则'}
            </Dialog.Title>

            <form onSubmit={(event) => void handleSave(event)} className="space-y-4">
              {message && isDialogOpen && (
                <div
                  className="text-sm p-2 rounded"
                  style={{
                    backgroundColor:
                      message.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                    color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
                  }}
                >
                  {message.text}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">现金流科目</label>
                  <select
                    className="glass-input w-full"
                    value={form.subjectCode}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, subjectCode: event.target.value }))
                    }
                  >
                    <option value="">请选择现金流科目</option>
                    {cashFlowSubjects.map((subject) => (
                      <option key={subject.code} value={subject.code}>
                        {subject.code} {subject.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">对方科目（精确编码）</label>
                  <select
                    className="glass-input w-full"
                    value={form.counterpartSubjectCode}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        counterpartSubjectCode: event.target.value
                      }))
                    }
                  >
                    <option value="">请选择对方科目</option>
                    {subjects.map((subject) => (
                      <option key={subject.code} value={subject.code}>
                        {subject.code} {subject.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">收/付方向</label>
                  <select
                    className="glass-input w-full"
                    value={form.entryDirection}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        entryDirection: event.target.value as 'inflow' | 'outflow'
                      }))
                    }
                  >
                    <option value="inflow">流入（借方发生）</option>
                    <option value="outflow">流出（贷方发生）</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-slate-700">现金流量项目</label>
                  <select
                    className="glass-input w-full"
                    value={form.cashFlowItemId ?? ''}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        cashFlowItemId: event.target.value ? Number(event.target.value) : null
                      }))
                    }
                  >
                    <option value="">请选择现金流量项目</option>
                    {cashFlowItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                className="rounded-xl px-3 py-3 text-xs"
                style={{
                  backgroundColor: 'rgba(15, 23, 42, 0.06)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                规则说明：仅按“对方科目精确编码”匹配；若一条现金流分录对应多个对方科目且命中多个项目，系统会要求人工分配。
              </div>

              <div className="flex justify-end gap-3">
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

import { useState, useRef, useEffect, useMemo, type KeyboardEvent, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import Decimal from 'decimal.js'

interface VoucherRow {
  id: string
  summary: string
  subjectInput: string
  subjectCode: string
  subjectName: string
  debit: string
  credit: string
  cashFlowItemId: number | null
  isCashFlow: boolean
}

interface SubjectItem {
  id: number
  code: string
  name: string
  is_cash_flow: number
}

interface CashFlowItem {
  id: number
  code: string
  name: string
}

interface CashFlowDraft {
  selected: boolean
  cashFlowItemId: number | null
}

interface VoucherEntryProps {
  title?: string
  componentType?: string
  editVoucherId?: number | string
  editRequestKey?: number
}

interface VoucherListItem {
  id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2
}

interface VoucherEntryFromApi {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  cash_flow_item_id: number | null
  subject_name?: string
}

interface SignatureRow {
  summary: string
  subjectCode: string
  debit: string
  credit: string
  cashFlowItemId: number | null
  isCashFlow: boolean
}

const createEmptyRow = (): VoucherRow => ({
  id: Math.random().toString(36).substring(7),
  summary: '',
  subjectInput: '',
  subjectCode: '',
  subjectName: '',
  debit: '',
  credit: '',
  cashFlowItemId: null,
  isCashFlow: false
})

const DEFAULT_ROWS = 4
const AMOUNT_PATTERN = /^\d+(\.\d{0,2})?$/

const toAmountText = (cents: number): string => new Decimal(cents).div(100).toFixed(2)

const normalizeRowsForSignature = (rows: VoucherRow[]): SignatureRow[] =>
  rows.map((row) => ({
    summary: row.summary.trim(),
    subjectCode: row.subjectCode.trim(),
    debit: row.debit.trim(),
    credit: row.credit.trim(),
    cashFlowItemId: row.cashFlowItemId,
    isCashFlow: row.isCashFlow
  }))

const buildDraftSignature = (voucherDate: string, rows: VoucherRow[]): string =>
  JSON.stringify({
    voucherDate,
    rows: normalizeRowsForSignature(rows)
  })

const padRows = (rows: VoucherRow[]): VoucherRow[] => {
  if (rows.length >= DEFAULT_ROWS) return rows
  return [...rows, ...Array.from({ length: DEFAULT_ROWS - rows.length }, () => createEmptyRow())]
}

const sortVoucherRowsAsc = (rows: VoucherListItem[]): VoucherListItem[] =>
  [...rows].sort((left, right) => {
    if (left.voucher_date !== right.voucher_date) {
      return left.voucher_date.localeCompare(right.voucher_date)
    }
    return left.voucher_number - right.voucher_number
  })

const toPositiveInt = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export default function VoucherEntry({
  editVoucherId,
  editRequestKey
}: VoucherEntryProps): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const currentUser = useAuthStore((s) => s.user)
  const normalizedEditVoucherId = useMemo(() => toPositiveInt(editVoucherId), [editVoucherId])
  const [date, setDate] = useState(
    currentPeriod ? `${currentPeriod}-01` : new Date().toISOString().split('T')[0]
  )
  const [voucherNumber, setVoucherNumber] = useState<number>(1)
  const [rows, setRows] = useState<VoucherRow[]>(
    Array.from({ length: DEFAULT_ROWS }, () => createEmptyRow())
  )
  const [subjectOptions, setSubjectOptions] = useState<Record<string, SubjectItem[]>>({})
  const [cashFlowItems, setCashFlowItems] = useState<CashFlowItem[]>([])
  const [activeSubjectRowId, setActiveSubjectRowId] = useState<string | null>(null)
  const [cashFlowDialogOpen, setCashFlowDialogOpen] = useState(false)
  const [cashFlowDraft, setCashFlowDraft] = useState<Record<string, CashFlowDraft>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null)
  const [editableVouchers, setEditableVouchers] = useState<VoucherListItem[]>([])
  const [loadingVoucher, setLoadingVoucher] = useState(false)
  const [baselineSignature, setBaselineSignature] = useState<string>('')

  // Matrix of refs for keyboard navigation: row x col
  // col 0: summary, 1: subject, 2: debit, 3: credit
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([])

  useEffect(() => {
    if (!currentLedger || !window.electron) return
    const ledgerId = currentLedger.id
    let cancelled = false
    async function loadCashFlowItems(): Promise<void> {
      try {
        const items = await window.api.cashflow.getItems(ledgerId)
        if (!cancelled) {
          setCashFlowItems(items)
        }
      } catch (error) {
        if (!cancelled) {
          setCashFlowItems([])
          console.error('load cash flow items failed', error)
        }
      }
    }
    void loadCashFlowItems()
    return () => {
      cancelled = true
    }
  }, [currentLedger])

  useEffect(() => {
    if (editingVoucherId !== null) return
    if (!currentPeriod) return
    const nextDate = `${currentPeriod}-01`
    const frameId = window.requestAnimationFrame(() => {
      setDate((prev) => (prev.startsWith(currentPeriod) ? prev : nextDate))
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [currentPeriod, editingVoucherId])

  useEffect(() => {
    if (editingVoucherId !== null) return
    if (!currentLedger || !date || date.length < 7) return
    if (!window.electron) return
    const ledgerId = currentLedger.id
    let cancelled = false
    const period = date.slice(0, 7)
    async function loadNextNumber(): Promise<void> {
      try {
        const next = await window.api.voucher.getNextNumber(ledgerId, period)
        if (!cancelled) {
          setVoucherNumber(next)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('load next voucher number failed', error)
        }
      }
    }
    void loadNextNumber()
    return () => {
      cancelled = true
    }
  }, [currentLedger, date, editingVoucherId])

  const updateRow = (
    index: number,
    field: keyof VoucherRow,
    value: VoucherRow[keyof VoucherRow]
  ): void => {
    const newRows = [...rows]
    newRows[index] = { ...newRows[index], [field]: value }
    setRows(newRows)
  }

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number
  ): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Move right
      if (colIdx < 3) {
        focusCell(rowIdx, colIdx + 1)
      } else {
        // Move to next row first column
        if (rowIdx === rows.length - 1) {
          // Add new row
          setRows((prev) => [...prev, createEmptyRow()])
          setTimeout(() => focusCell(rowIdx + 1, 0), 50)
        } else {
          focusCell(rowIdx + 1, 0)
        }
      }
    } else if (e.key === '=' && (colIdx === 2 || colIdx === 3)) {
      e.preventDefault()
      autoBalance(rowIdx, colIdx === 2 ? 'debit' : 'credit')
    }
  }

  const focusCell = (rowIdx: number, colIdx: number): void => {
    if (inputRefs.current[rowIdx] && inputRefs.current[rowIdx][colIdx]) {
      inputRefs.current[rowIdx][colIdx]?.focus()
    }
  }

  const autoBalance = (rowIdx: number, field: 'debit' | 'credit'): void => {
    let totalDebit = new Decimal(0)
    let totalCredit = new Decimal(0)

    rows.forEach((r, i) => {
      if (i === rowIdx) return
      if (r.debit) totalDebit = totalDebit.plus(new Decimal(r.debit || '0'))
      if (r.credit) totalCredit = totalCredit.plus(new Decimal(r.credit || '0'))
    })

    const newRows = [...rows]
    if (field === 'debit' && totalCredit.greaterThan(totalDebit)) {
      newRows[rowIdx].debit = totalCredit.minus(totalDebit).toFixed(2)
      newRows[rowIdx].credit = ''
    } else if (field === 'credit' && totalDebit.greaterThan(totalCredit)) {
      newRows[rowIdx].credit = totalDebit.minus(totalCredit).toFixed(2)
      newRows[rowIdx].debit = ''
    }
    setRows(newRows)
  }

  const computeTotals = (): { debit: string; credit: string; balanced: boolean } => {
    let totalDebit = new Decimal(0)
    let totalCredit = new Decimal(0)
    rows.forEach((r) => {
      if (r.debit) totalDebit = totalDebit.plus(new Decimal(r.debit || 0))
      if (r.credit) totalCredit = totalCredit.plus(new Decimal(r.credit || 0))
    })
    return {
      debit: totalDebit.toFixed(2),
      credit: totalCredit.toFixed(2),
      balanced: totalDebit.equals(totalCredit) && !totalDebit.isZero()
    }
  }

  const { debit: totalDebit, credit: totalCredit, balanced } = computeTotals()
  const currentEditableIndex = useMemo(() => {
    if (editingVoucherId === null) return -1
    const exactIndex = editableVouchers.findIndex((voucher) => voucher.id === editingVoucherId)
    if (exactIndex >= 0) return exactIndex
    return editableVouchers.findIndex((voucher) => String(voucher.id) === String(editingVoucherId))
  }, [editingVoucherId, editableVouchers])
  const hasPrevVoucher = editingVoucherId !== null && currentEditableIndex > 0
  const hasNextVoucher =
    editingVoucherId !== null &&
    currentEditableIndex >= 0 &&
    currentEditableIndex < editableVouchers.length - 1
  const hasUnsavedChanges =
    editingVoucherId !== null &&
    baselineSignature !== '' &&
    buildDraftSignature(date, rows) !== baselineSignature

  // Dynamic set ref helper
  const setRef =
    (r: number, c: number) =>
    (el: HTMLInputElement | null): void => {
      if (!inputRefs.current[r]) inputRefs.current[r] = []
      inputRefs.current[r][c] = el
    }

  const searchSubject = async (rowId: string, keyword: string): Promise<void> => {
    if (!currentLedger || !keyword.trim() || !window.electron) {
      setSubjectOptions((prev) => ({ ...prev, [rowId]: [] }))
      return
    }
    try {
      const result = await window.api.subject.search(currentLedger.id, keyword.trim())
      setSubjectOptions((prev) => ({ ...prev, [rowId]: result }))
    } catch (error) {
      setSubjectOptions((prev) => ({ ...prev, [rowId]: [] }))
      console.error('search subject failed', error)
    }
  }

  const handleSubjectInput = (rowIdx: number, value: string): void => {
    const row = rows[rowIdx]
    const newRows = [...rows]
    newRows[rowIdx] = {
      ...row,
      subjectInput: value,
      subjectCode: '',
      subjectName: '',
      isCashFlow: false,
      cashFlowItemId: null
    }
    setRows(newRows)
    setActiveSubjectRowId(row.id)
    void searchSubject(row.id, value)
  }

  const selectSubject = (rowIdx: number, subject: SubjectItem): void => {
    const row = rows[rowIdx]
    const newRows = [...rows]
    newRows[rowIdx] = {
      ...row,
      subjectInput: `${subject.code} ${subject.name}`,
      subjectCode: subject.code,
      subjectName: subject.name,
      isCashFlow: subject.is_cash_flow === 1,
      cashFlowItemId: subject.is_cash_flow === 1 ? row.cashFlowItemId : null
    }
    setRows(newRows)
    setSubjectOptions((prev) => ({ ...prev, [row.id]: [] }))
    setActiveSubjectRowId(null)
  }

  const cashFlowCandidateRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.isCashFlow && row.subjectCode)

  const openCashFlowDialog = (): void => {
    if (cashFlowCandidateRows.length === 0) {
      setMessage({ type: 'error', text: '当前没有可分配现金流量的分录' })
      return
    }
    const draft: Record<string, CashFlowDraft> = {}
    cashFlowCandidateRows.forEach(({ row }) => {
      draft[row.id] = {
        selected: row.cashFlowItemId !== null,
        cashFlowItemId: row.cashFlowItemId
      }
    })
    setCashFlowDraft(draft)
    setCashFlowDialogOpen(true)
  }

  const toggleCashFlowRow = (rowId: string, checked: boolean): void => {
    setCashFlowDraft((prev) => ({
      ...prev,
      [rowId]: {
        selected: checked,
        cashFlowItemId: checked ? (prev[rowId]?.cashFlowItemId ?? null) : null
      }
    }))
  }

  const changeCashFlowDraftItem = (rowId: string, value: string): void => {
    setCashFlowDraft((prev) => ({
      ...prev,
      [rowId]: {
        selected: true,
        cashFlowItemId: value ? Number(value) : null
      }
    }))
  }

  const applyCashFlowAllocation = (): void => {
    const hasMissingItem = cashFlowCandidateRows.some(({ row }) => {
      const draft = cashFlowDraft[row.id]
      return draft?.selected === true && draft.cashFlowItemId === null
    })

    if (hasMissingItem) {
      setMessage({ type: 'error', text: '请为已勾选分录选择现金流量项目' })
      return
    }

    setRows((prev) =>
      prev.map((row) => {
        const draft = cashFlowDraft[row.id]
        if (!draft) return row
        return {
          ...row,
          cashFlowItemId: draft.selected ? draft.cashFlowItemId : null
        }
      })
    )
    setCashFlowDialogOpen(false)
    setMessage({ type: 'success', text: '现金流量分配已更新' })
  }

  const loadEditableVoucherRows = async (ledgerId: number): Promise<VoucherListItem[]> => {
    const allList = await window.api.voucher.list({ ledgerId })
    return sortVoucherRowsAsc((allList as VoucherListItem[]).filter((voucher) => voucher.status === 0))
  }

  const loadVoucherForEdit = async (voucherId: number): Promise<boolean> => {
    if (!currentLedger || !window.electron) return false
    const normalizedVoucherId = toPositiveInt(voucherId)
    if (normalizedVoucherId === null) {
      setMessage({ type: 'error', text: '凭证编号无效' })
      return false
    }

    setLoadingVoucher(true)
    setMessage(null)
    try {
      const editableList = await loadEditableVoucherRows(currentLedger.id)
      const targetVoucher = editableList.find((voucher) => voucher.id === normalizedVoucherId)
      if (!targetVoucher) {
        setMessage({ type: 'error', text: '该凭证不可修改（仅未审核凭证可编辑）' })
        return false
      }

      const [entries, subjects] = await Promise.all([
        window.api.voucher.getEntries(normalizedVoucherId),
        window.api.subject.getAll(currentLedger.id)
      ])
      const cashFlowSubjectCodeSet = new Set(
        subjects.filter((subject) => subject.is_cash_flow === 1).map((subject) => subject.code)
      )

      const mappedRows = (entries as VoucherEntryFromApi[]).map((entry) => {
        const subjectName = entry.subject_name || ''
        return {
          id: Math.random().toString(36).substring(7),
          summary: entry.summary || '',
          subjectInput: `${entry.subject_code} ${subjectName}`.trim(),
          subjectCode: entry.subject_code,
          subjectName,
          debit: entry.debit_amount > 0 ? toAmountText(entry.debit_amount) : '',
          credit: entry.credit_amount > 0 ? toAmountText(entry.credit_amount) : '',
          cashFlowItemId: entry.cash_flow_item_id,
          isCashFlow:
            cashFlowSubjectCodeSet.has(entry.subject_code) || entry.cash_flow_item_id !== null
        } satisfies VoucherRow
      })

      const finalRows = padRows(mappedRows)
      setRows(finalRows)
      setDate(targetVoucher.voucher_date)
      setVoucherNumber(targetVoucher.voucher_number)
      setEditingVoucherId(normalizedVoucherId)
      setEditableVouchers(editableList)
      setSubjectOptions({})
      setActiveSubjectRowId(null)
      setCashFlowDialogOpen(false)
      setCashFlowDraft({})
      setBaselineSignature(buildDraftSignature(targetVoucher.voucher_date, finalRows))
      return true
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载凭证失败'
      })
      return false
    } finally {
      setLoadingVoucher(false)
    }
  }

  useEffect(() => {
    if (!currentLedger || !window.electron) return
    if (!normalizedEditVoucherId) return
    void loadVoucherForEdit(normalizedEditVoucherId)
  }, [currentLedger, normalizedEditVoucherId, editRequestKey])

  const validateAndCleanRows = (): {
    valid: boolean
    cleanedRows: VoucherRow[]
    error?: string
  } => {
    const cleanedRows = rows.filter((row) => {
      return !(
        row.summary.trim() === '' &&
        row.subjectCode.trim() === '' &&
        row.debit.trim() === '' &&
        row.credit.trim() === ''
      )
    })

    if (cleanedRows.length < 2) {
      return { valid: false, cleanedRows, error: '至少需要两条有效分录' }
    }

    for (let i = 0; i < cleanedRows.length; i += 1) {
      const row = cleanedRows[i]
      if (!row.subjectCode) {
        return { valid: false, cleanedRows, error: `第${i + 1}行缺少会计科目` }
      }

      const debit = row.debit ? new Decimal(row.debit) : new Decimal(0)
      const credit = row.credit ? new Decimal(row.credit) : new Decimal(0)
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        return { valid: false, cleanedRows, error: `第${i + 1}行借贷不能同时填写` }
      }
      if (debit.isZero() && credit.isZero()) {
        return { valid: false, cleanedRows, error: `第${i + 1}行借贷金额不能同时为空` }
      }
    }

    if (!balanced) {
      return { valid: false, cleanedRows, error: '借贷不平衡，无法保存' }
    }

    return { valid: true, cleanedRows }
  }

  const resetVoucher = (): void => {
    const nextRows = Array.from({ length: DEFAULT_ROWS }, () => createEmptyRow())
    setRows(nextRows)
    setSubjectOptions({})
    setActiveSubjectRowId(null)
    setCashFlowDialogOpen(false)
    setCashFlowDraft({})
    setEditingVoucherId(null)
    setEditableVouchers([])
    setBaselineSignature('')
  }

  const handleNewVoucher = async (): Promise<void> => {
    resetVoucher()
    setMessage(null)
    if (!currentLedger || !date || date.length < 7) return
    if (!window.electron) return
    const period = date.slice(0, 7)
    try {
      const next = await window.api.voucher.getNextNumber(currentLedger.id, period)
      setVoucherNumber(next)
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '获取下一个凭证号失败'
      })
    }
  }

  const saveVoucher = async (mode: 'newAfterSave' | 'stay'): Promise<boolean> => {
    setMessage(null)
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先创建或选择账套' })
      return false
    }
    if (!window.electron) {
      setMessage({
        type: 'error',
        text: '浏览器预览模式不支持保存凭证，请在 Electron 客户端中操作'
      })
      return false
    }

    const { valid, cleanedRows, error } = validateAndCleanRows()
    if (!valid) {
      setMessage({ type: 'error', text: error || '校验失败' })
      return false
    }

    setSaving(true)
    try {
      const payloadEntries = cleanedRows.map((row) => ({
        summary: row.summary,
        subjectCode: row.subjectCode,
        debitAmount: row.debit,
        creditAmount: row.credit,
        cashFlowItemId: row.cashFlowItemId
      }))

      const result =
        editingVoucherId === null
          ? await window.api.voucher.save({
              ledgerId: currentLedger.id,
              voucherDate: date,
              voucherWord: '记',
              entries: payloadEntries
            })
          : await window.api.voucher.update({
              voucherId: editingVoucherId,
              ledgerId: currentLedger.id,
              voucherDate: date,
              entries: payloadEntries
            })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存失败' })
        return false
      }

      if (editingVoucherId === null) {
        setMessage({
          type: 'success',
          text: `凭证已保存（记-${String(result.voucherNumber).padStart(4, '0')}）`
        })
        if (mode === 'newAfterSave') {
          await handleNewVoucher()
        }
      } else {
        setMessage({
          type: 'success',
          text: `凭证已更新（记-${String(voucherNumber).padStart(4, '0')}）`
        })
        setBaselineSignature(buildDraftSignature(date, rows))
      }
      return true
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存失败'
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    const mode = editingVoucherId === null ? 'newAfterSave' : 'stay'
    await saveVoucher(mode)
  }

  const handleSwitchVoucher = async (direction: 'prev' | 'next'): Promise<void> => {
    if (editingVoucherId === null) {
      setMessage({ type: 'error', text: '请先在凭证管理中选择一张凭证进行编辑' })
      return
    }
    if (loadingVoucher || saving) return
    if (currentEditableIndex < 0) {
      setMessage({ type: 'error', text: '凭证导航序列已过期，请返回凭证管理重新打开' })
      return
    }

    const targetIndex = direction === 'prev' ? currentEditableIndex - 1 : currentEditableIndex + 1
    const targetVoucher = editableVouchers[targetIndex]
    if (!targetVoucher) return

    setMessage(null)
    if (hasUnsavedChanges) {
      const shouldSaveFirst = window.confirm('当前凭证未保存，是否先保存后再切换？')
      if (!shouldSaveFirst) return
      const saved = await saveVoucher('stay')
      if (!saved) return
    }

    await loadVoucherForEdit(targetVoucher.id)
  }

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      {/* 顶部操作区 */}
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {editingVoucherId ? '记账凭证（编辑）' : '记账凭证'}
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSwitchVoucher('prev')}
            disabled={!hasPrevVoucher || loadingVoucher || saving}
          >
            上一张
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSwitchVoucher('next')}
            disabled={!hasNextVoucher || loadingVoucher || saving}
          >
            下一张
          </button>
          <button className="glass-btn-secondary" onClick={() => void handleNewVoucher()}>
            新建
          </button>
          <button
            className="glass-btn-secondary"
            style={{ borderColor: balanced ? 'var(--color-success)' : '' }}
            onClick={() => void handleSave()}
            disabled={saving || loadingVoucher}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 表头区 */}
      <div
        className="flex justify-between items-center mb-2 px-2 gap-2 flex-wrap"
        style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}
      >
        <span>单位：{currentLedger?.name || ''}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="voucher-date-input">日期：</label>
          <input
            id="voucher-date-input"
            type="date"
            className="glass-input px-2 py-1 bg-transparent border-none shadow-none text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="glass-btn-secondary text-sm px-3 py-1.5"
          onClick={openCashFlowDialog}
        >
          现金流量分配
        </button>
        <span>字号：记-{String(voucherNumber).padStart(4, '0')}</span>
      </div>

      {/* 表格主体 */}
      <div className="glass-panel overflow-auto flex-1 flex flex-col">
        {/* 表头 */}
        <div
          className="grid grid-cols-12 text-center py-3 border-b"
          style={{
            borderColor: 'var(--color-glass-border-light)',
            color: 'var(--color-text-primary)'
          }}
        >
          <div
            className="col-span-3 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            摘要
          </div>
          <div
            className="col-span-5 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            会计科目
          </div>
          <div
            className="col-span-2 border-r"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            借方金额
          </div>
          <div className="col-span-2">贷方金额</div>
        </div>

        {/* 表格行 */}
        <div className="flex-1 overflow-y-auto">
          {rows.map((row, rIdx) => (
            <div
              key={row.id}
              className="grid grid-cols-12 border-b group relative"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div
                className="col-span-3 border-r"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <input
                  ref={setRef(rIdx, 0)}
                  className="w-full h-full bg-transparent px-3 py-3 outline-none focus:bg-white/10 transition-colors"
                  value={row.summary}
                  onChange={(e) => updateRow(rIdx, 'summary', e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 0)}
                  placeholder="摘要"
                  aria-label={`第 ${rIdx + 1} 行摘要`}
                />
              </div>
              <div
                className="col-span-5 border-r relative"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <input
                  ref={setRef(rIdx, 1)}
                  className="w-full h-full bg-transparent px-3 py-3 outline-none focus:bg-white/10 transition-colors"
                  value={row.subjectInput}
                  onChange={(e) => handleSubjectInput(rIdx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 1)}
                  onFocus={() => setActiveSubjectRowId(row.id)}
                  onBlur={() => {
                    setTimeout(() => {
                      setActiveSubjectRowId((prev) => (prev === row.id ? null : prev))
                    }, 100)
                  }}
                  placeholder="输入科目代码或名称"
                  aria-label={`第 ${rIdx + 1} 行会计科目`}
                />
                {activeSubjectRowId === row.id && (subjectOptions[row.id] || []).length > 0 && (
                  <div className="absolute z-30 left-0 right-0 top-full mt-1 glass-panel-light max-h-48 overflow-y-auto">
                    {(subjectOptions[row.id] || []).map((subject) => (
                      <button
                        key={subject.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/20"
                        style={{ color: 'var(--color-text-primary)' }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectSubject(rIdx, subject)}
                      >
                        {subject.code} {subject.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div
                className="col-span-2 border-r"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <input
                  ref={setRef(rIdx, 2)}
                  type="text"
                  inputMode="decimal"
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-right focus:bg-white/10 transition-colors"
                  value={row.debit}
                  onChange={(e) => {
                    if (e.target.value !== '' && !AMOUNT_PATTERN.test(e.target.value)) return
                    const newRows = [...rows]
                    newRows[rIdx] = {
                      ...row,
                      debit: e.target.value,
                      credit: e.target.value ? '' : row.credit
                    }
                    setRows(newRows)
                  }}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 2)}
                  aria-label={`第 ${rIdx + 1} 行借方金额`}
                />
              </div>
              <div className="col-span-2 relative">
                <input
                  ref={setRef(rIdx, 3)}
                  type="text"
                  inputMode="decimal"
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-right focus:bg-white/10 transition-colors"
                  value={row.credit}
                  onChange={(e) => {
                    if (e.target.value !== '' && !AMOUNT_PATTERN.test(e.target.value)) return
                    const newRows = [...rows]
                    newRows[rIdx] = {
                      ...row,
                      credit: e.target.value,
                      debit: e.target.value ? '' : row.debit
                    }
                    setRows(newRows)
                  }}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 3)}
                  aria-label={`第 ${rIdx + 1} 行贷方金额`}
                />
                {row.isCashFlow && (
                  <span
                    className="absolute left-2 bottom-1 text-[11px] pointer-events-none"
                    style={{
                      color: row.cashFlowItemId ? 'var(--color-success)' : 'var(--color-danger)'
                    }}
                  >
                    {row.cashFlowItemId ? '已分配现金流' : '待分配现金流'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 合计行 */}
        <div
          className="grid grid-cols-12 text-center py-3 border-t bg-white/5"
          style={{ borderColor: 'var(--color-glass-border)', color: 'var(--color-text-primary)' }}
        >
          <div className="col-span-8 text-right pr-4 font-bold">合计：</div>
          <div
            className="col-span-2 border-r text-right pr-3 font-bold"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            {totalDebit}
          </div>
          <div className="col-span-2 text-right pr-3 font-bold">{totalCredit}</div>
        </div>
      </div>

      {cashFlowDialogOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4"
          onClick={() => setCashFlowDialogOpen(false)}
        >
          <div
            className="glass-panel w-full max-w-5xl max-h-[80vh] flex flex-col p-4 gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>
                现金流量分配
              </h3>
              <button
                type="button"
                className="glass-btn-secondary text-sm px-3 py-1.5"
                onClick={() => setCashFlowDialogOpen(false)}
              >
                关闭
              </button>
            </div>

            <div
              className="overflow-auto rounded-md border"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div
                className="grid grid-cols-12 py-2 text-xs font-semibold border-b"
                style={{
                  color: 'var(--color-text-secondary)',
                  borderColor: 'var(--color-glass-border-light)'
                }}
              >
                <div className="col-span-1 text-center">选择</div>
                <div className="col-span-1 text-center">行号</div>
                <div className="col-span-3 px-2">摘要</div>
                <div className="col-span-3 px-2">会计科目</div>
                <div className="col-span-1 text-right pr-2">金额</div>
                <div className="col-span-3 px-2">现金流量项目</div>
              </div>

              {cashFlowCandidateRows.map(({ row, index }) => {
                const draft = cashFlowDraft[row.id] ?? {
                  selected: false,
                  cashFlowItemId: null
                }
                const amount = row.debit || row.credit || '0.00'
                const direction = row.debit ? '借' : '贷'
                return (
                  <div
                    key={row.id}
                    className="grid grid-cols-12 items-center py-2 border-b last:border-b-0"
                    style={{ borderColor: 'var(--color-glass-border-light)' }}
                  >
                    <div className="col-span-1 flex justify-center">
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        onChange={(e) => toggleCashFlowRow(row.id, e.target.checked)}
                        aria-label={`选择第 ${index + 1} 行进行现金流量分配`}
                      />
                    </div>
                    <div
                      className="col-span-1 text-center text-sm"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {index + 1}
                    </div>
                    <div
                      className="col-span-3 px-2 text-sm truncate"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {row.summary || '-'}
                    </div>
                    <div
                      className="col-span-3 px-2 text-sm truncate"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {row.subjectCode} {row.subjectName}
                    </div>
                    <div
                      className="col-span-1 text-right pr-2 text-sm"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {direction}
                      {amount}
                    </div>
                    <div className="col-span-3 px-2">
                      <select
                        className="glass-input w-full text-sm"
                        value={draft.cashFlowItemId ?? ''}
                        disabled={!draft.selected}
                        onChange={(e) => changeCashFlowDraftItem(row.id, e.target.value)}
                        aria-label={`第 ${index + 1} 行现金流量项目`}
                      >
                        <option value="">选择现金流量项目</option>
                        {cashFlowItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={() => setCashFlowDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={applyCashFlowAllocation}
              >
                确认分配
              </button>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div
          className="mt-2 px-2 text-sm"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      {/* 表尾区 */}
      <div
        className="flex justify-between mt-2 px-2 text-xs flex-wrap gap-2"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <span>记账：待记账</span>
        <span>审核：待审核</span>
        <span>制单：{currentUser?.realName || currentUser?.username || ''}</span>
      </div>
    </div>
  )
}

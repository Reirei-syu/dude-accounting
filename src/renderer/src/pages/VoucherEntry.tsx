import { useState, useRef, useEffect, type KeyboardEvent, type JSX } from 'react'
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

export default function VoucherEntry(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const currentUser = useAuthStore((s) => s.user)
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
  const [activeCashFlowRowId, setActiveCashFlowRowId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

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
    if (!currentPeriod) return
    const nextDate = `${currentPeriod}-01`
    const frameId = window.requestAnimationFrame(() => {
      setDate((prev) => (prev.startsWith(currentPeriod) ? prev : nextDate))
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [currentPeriod])

  useEffect(() => {
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
  }, [currentLedger, date])

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

  const updateCashFlowItem = (rowIdx: number, value: string): void => {
    updateRow(rowIdx, 'cashFlowItemId', value ? Number(value) : null)
  }

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
      if (row.isCashFlow && row.cashFlowItemId === null) {
        return { valid: false, cleanedRows, error: `第${i + 1}行为现金流科目，需指定现金流量项目` }
      }
    }

    if (!balanced) {
      return { valid: false, cleanedRows, error: '借贷不平衡，无法保存' }
    }

    return { valid: true, cleanedRows }
  }

  const resetVoucher = (): void => {
    setRows(Array.from({ length: DEFAULT_ROWS }, () => createEmptyRow()))
    setSubjectOptions({})
    setActiveSubjectRowId(null)
    setActiveCashFlowRowId(null)
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

  const handleSave = async (): Promise<void> => {
    setMessage(null)
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先创建或选择账套' })
      return
    }
    if (!window.electron) {
      setMessage({
        type: 'error',
        text: '浏览器预览模式不支持保存凭证，请在 Electron 客户端中操作'
      })
      return
    }

    const { valid, cleanedRows, error } = validateAndCleanRows()
    if (!valid) {
      setMessage({ type: 'error', text: error || '校验失败' })
      return
    }

    setSaving(true)
    try {
      const result = await window.api.voucher.save({
        ledgerId: currentLedger.id,
        voucherDate: date,
        voucherWord: '记',
        entries: cleanedRows.map((row) => ({
          summary: row.summary,
          subjectCode: row.subjectCode,
          debitAmount: row.debit,
          creditAmount: row.credit,
          cashFlowItemId: row.cashFlowItemId
        }))
      })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存失败' })
        return
      }

      setMessage({
        type: 'success',
        text: `凭证已保存（记-${String(result.voucherNumber).padStart(4, '0')}）`
      })
      await handleNewVoucher()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存失败'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4">
      {/* 顶部操作区 */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          记账凭证
        </h2>
        <div className="flex gap-2">
          <button className="glass-btn-secondary" onClick={() => void handleNewVoucher()}>
            新建
          </button>
          <button
            className="glass-btn-secondary"
            style={{ borderColor: balanced ? 'var(--color-success)' : '' }}
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 表头区 */}
      <div
        className="flex justify-between items-center mb-2 px-2"
        style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}
      >
        <span>单位：{currentLedger?.name || ''}</span>
        <div className="flex items-center gap-2">
          <span>日期：</span>
          <input
            type="date"
            className="glass-input px-2 py-1 bg-transparent border-none shadow-none text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <span>字号：记-{String(voucherNumber).padStart(4, '0')}</span>
      </div>

      {/* 表格主体 */}
      <div className="glass-panel overflow-hidden flex-1 flex flex-col">
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
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-white focus:bg-white/10 transition-colors"
                  value={row.summary}
                  onChange={(e) => updateRow(rIdx, 'summary', e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 0)}
                />
              </div>
              <div
                className="col-span-5 border-r relative"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <input
                  ref={setRef(rIdx, 1)}
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-white focus:bg-white/10 transition-colors"
                  value={row.subjectInput}
                  onChange={(e) => handleSubjectInput(rIdx, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, rIdx, 1)}
                  onFocus={() => setActiveSubjectRowId(row.id)}
                  onBlur={() => {
                    setTimeout(() => {
                      setActiveSubjectRowId((prev) => (prev === row.id ? null : prev))
                    }, 100)
                  }}
                  placeholder="输入科目代码"
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
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-right text-white focus:bg-white/10 transition-colors"
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
                />
              </div>
              <div className="col-span-2 relative">
                <input
                  ref={setRef(rIdx, 3)}
                  type="text"
                  className="w-full h-full bg-transparent px-3 py-3 outline-none text-right text-white focus:bg-white/10 transition-colors"
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
                />
                {row.isCashFlow && (
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-xs glass-btn-secondary p-0"
                    title="选择现金流量项目"
                    onClick={() =>
                      setActiveCashFlowRowId((prev) => (prev === row.id ? null : row.id))
                    }
                  >
                    ¥
                  </button>
                )}
                {row.isCashFlow && activeCashFlowRowId === row.id && (
                  <div className="absolute z-30 right-0 top-full mt-1 glass-panel-light p-2 min-w-[280px]">
                    <select
                      className="glass-input w-full text-sm"
                      value={row.cashFlowItemId ?? ''}
                      onChange={(e) => {
                        updateCashFlowItem(rIdx, e.target.value)
                        setActiveCashFlowRowId(null)
                      }}
                    >
                      <option value="">选择现金流量项目</option>
                      {cashFlowItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
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

      {message && (
        <div
          className="mt-2 px-2 text-sm"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}

      {/* 表尾区 */}
      <div
        className="flex justify-between mt-2 px-2 text-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <span>记账：待记账</span>
        <span>审核：待审核</span>
        <span>制单：{currentUser?.realName || currentUser?.username || ''}</span>
      </div>
    </div>
  )
}

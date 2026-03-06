import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type KeyboardEvent,
  type JSX
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import Decimal from 'decimal.js'
import {
  buildNextVoucherEntryRow,
  filterVoucherRowsForSave,
  inheritSummaryFromPreviousRow
} from './voucherEntryRowUtils'

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

interface VoucherSubject {
  id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  level: number
  is_cash_flow: number
}

type SubjectTreeRow =
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
      row: VoucherSubject
    }

interface SubjectHierarchy {
  logicalParentByCode: Map<string, string | null>
  logicalLevelByCode: Map<string, number>
  hasChildrenCodes: Set<string>
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
const NUMERIC_SUBJECT_KEYWORD_PATTERN = /^\d+$/
const SUBJECT_CATEGORY_ORDER = ['asset', 'liability', 'common', 'equity', 'cost', 'profit_loss']

const getSubjectIndentWidth = (level: number): string => `${Math.max(0, level - 1) * 2}ch`

const renderSubjectIndent = (level: number): JSX.Element | null => {
  if (level <= 1) {
    return null
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{ width: getSubjectIndentWidth(level) }}
    />
  )
}

const getSubjectCategoryLabel = (category: string, standardType?: 'enterprise' | 'npo'): string => {
  const labels: Record<string, string> = {
    asset: '资产类',
    liability: '负债类',
    common: '共同类',
    equity: standardType === 'npo' ? '净资产类' : '所有者权益类',
    cost: '成本类',
    profit_loss: '损益类'
  }

  return labels[category] ?? category
}

const getSubjectCategoryNodeCode = (category: string): string => `__category__${category}`

const buildSubjectHierarchy = (subjects: VoucherSubject[]): SubjectHierarchy => {
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))
  const subjectCodesByCategory = new Map<string, string[]>()

  for (const subject of subjects) {
    const currentCodes = subjectCodesByCategory.get(subject.category) ?? []
    currentCodes.push(subject.code)
    subjectCodesByCategory.set(subject.category, currentCodes)
  }

  const logicalParentByCode = new Map<string, string | null>()

  for (const subject of subjects) {
    const explicitParentCode =
      subject.parent_code &&
      subject.parent_code !== subject.code &&
      subject.code.startsWith(subject.parent_code) &&
      subjectByCode.has(subject.parent_code)
        ? subject.parent_code
        : null

    if (explicitParentCode) {
      logicalParentByCode.set(subject.code, explicitParentCode)
      continue
    }

    let inferredParentCode: string | null = null
    for (const candidateCode of subjectCodesByCategory.get(subject.category) ?? []) {
      if (candidateCode === subject.code) {
        continue
      }
      if (!subject.code.startsWith(candidateCode)) {
        continue
      }
      if (!inferredParentCode || candidateCode.length > inferredParentCode.length) {
        inferredParentCode = candidateCode
      }
    }

    logicalParentByCode.set(subject.code, inferredParentCode)
  }

  const logicalLevelByCode = new Map<string, number>()
  const resolveLogicalLevel = (code: string, visited = new Set<string>()): number => {
    if (logicalLevelByCode.has(code)) {
      return logicalLevelByCode.get(code) ?? 1
    }

    if (visited.has(code)) {
      return 1
    }

    visited.add(code)
    const parentCode = logicalParentByCode.get(code) ?? null
    const level = parentCode ? resolveLogicalLevel(parentCode, visited) + 1 : 1
    logicalLevelByCode.set(code, level)
    visited.delete(code)
    return level
  }

  for (const subject of subjects) {
    resolveLogicalLevel(subject.code)
  }

  const hasChildrenCodes = new Set<string>()
  for (const parentCode of logicalParentByCode.values()) {
    if (parentCode) {
      hasChildrenCodes.add(parentCode)
    }
  }

  return {
    logicalParentByCode,
    logicalLevelByCode,
    hasChildrenCodes
  }
}

const buildSubjectTreeRows = (
  subjects: VoucherSubject[],
  hierarchy: SubjectHierarchy,
  standardType?: 'enterprise' | 'npo'
): SubjectTreeRow[] => {
  const treeRows: SubjectTreeRow[] = []

  for (const category of SUBJECT_CATEGORY_ORDER) {
    const categorySubjects = subjects.filter((subject) => subject.category === category)
    if (categorySubjects.length === 0) {
      continue
    }

    treeRows.push({
      kind: 'category',
      id: getSubjectCategoryNodeCode(category),
      code: getSubjectCategoryNodeCode(category),
      name: getSubjectCategoryLabel(category, standardType),
      logicalParent: null,
      logicalLevel: 0
    })

    for (const subject of categorySubjects) {
      const logicalParentCode = hierarchy.logicalParentByCode.get(subject.code) ?? null
      treeRows.push({
        kind: 'subject',
        id: subject.id,
        code: subject.code,
        name: subject.name,
        logicalParent: logicalParentCode ?? getSubjectCategoryNodeCode(category),
        logicalLevel: hierarchy.logicalLevelByCode.get(subject.code) ?? 1,
        row: subject
      })
    }
  }

  return treeRows
}

const filterSubjectsByKeyword = (subjects: VoucherSubject[], keyword: string): VoucherSubject[] => {
  const normalizedKeyword = keyword.trim()
  if (!normalizedKeyword) {
    return []
  }

  const isNumericKeyword = NUMERIC_SUBJECT_KEYWORD_PATTERN.test(normalizedKeyword)
  const filtered = subjects.filter((subject) => {
    if (isNumericKeyword) {
      return (
        subject.code.startsWith(normalizedKeyword) || subject.name.startsWith(normalizedKeyword)
      )
    }

    return subject.code.startsWith(normalizedKeyword) || subject.name.includes(normalizedKeyword)
  })

  return filtered.sort((left, right) => left.code.localeCompare(right.code)).slice(0, 20)
}

const findFirstLeafSubject = (
  subjects: VoucherSubject[],
  hasChildrenCodes: Set<string>
): VoucherSubject | undefined => subjects.find((subject) => !hasChildrenCodes.has(subject.code))

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

const hasDraftRowContent = (row: VoucherRow): boolean =>
  row.summary.trim() !== '' ||
  row.subjectCode.trim() !== '' ||
  row.subjectInput.trim() !== '' ||
  row.debit.trim() !== '' ||
  row.credit.trim() !== '' ||
  row.cashFlowItemId !== null

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

const buildEditRequestToken = (voucherId: number | null, requestKey?: number): string | null => {
  if (voucherId === null) return null
  return `${voucherId}:${requestKey ?? 'default'}`
}

const PERIOD_PATTERN = /^\d{4}-\d{2}$/

const getPeriodDateRange = (period: string): { min: string; max: string } | null => {
  if (!PERIOD_PATTERN.test(period)) return null

  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null

  const lastDay = new Date(year, month, 0).getDate()
  return {
    min: `${period}-01`,
    max: `${period}-${String(lastDay).padStart(2, '0')}`
  }
}

const isDateWithinRange = (value: string, range: { min: string; max: string } | null): boolean => {
  if (!range) return true
  return value >= range.min && value <= range.max
}

const hasPositiveAmount = (value: string): boolean => {
  const text = value.trim()
  if (text === '') return false
  try {
    return new Decimal(text).greaterThan(0)
  } catch {
    return false
  }
}

const isOppositeDirection = (left: VoucherRow, right: VoucherRow): boolean => {
  return (
    (hasPositiveAmount(left.debit) && hasPositiveAmount(right.credit)) ||
    (hasPositiveAmount(left.credit) && hasPositiveAmount(right.debit))
  )
}

const shouldShowPendingCashFlowHint = (
  rows: VoucherRow[],
  index: number,
  row: VoucherRow
): boolean => {
  if (!row.isCashFlow || row.cashFlowItemId !== null || !row.subjectCode) return false

  const counterparts = rows.filter((candidate, candidateIndex) => {
    return candidateIndex !== index && candidate.subjectCode && isOppositeDirection(row, candidate)
  })

  if (counterparts.length === 0) return true
  const isInternalTransfer = counterparts.every((counterpart) => counterpart.isCashFlow)
  return !isInternalTransfer
}

export default function VoucherEntry({
  editVoucherId,
  editRequestKey
}: VoucherEntryProps): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const currentUser = useAuthStore((s) => s.user)
  const activeTabId = useUIStore((state) => state.activeTabId)
  const activePeriod = useMemo(
    () => (currentPeriod && PERIOD_PATTERN.test(currentPeriod) ? currentPeriod : ''),
    [currentPeriod]
  )
  const periodDateRange = useMemo(() => getPeriodDateRange(activePeriod), [activePeriod])
  const normalizedEditVoucherId = useMemo(() => toPositiveInt(editVoucherId), [editVoucherId])
  const currentEditRequestToken = useMemo(
    () => buildEditRequestToken(normalizedEditVoucherId, editRequestKey),
    [normalizedEditVoucherId, editRequestKey]
  )
  const [date, setDate] = useState(
    currentPeriod ? `${currentPeriod}-01` : new Date().toISOString().split('T')[0]
  )
  const [voucherNumber, setVoucherNumber] = useState<number>(1)
  const [rows, setRows] = useState<VoucherRow[]>(
    Array.from({ length: DEFAULT_ROWS }, () => createEmptyRow())
  )
  const [allSubjects, setAllSubjects] = useState<VoucherSubject[]>([])
  const [subjectOptions, setSubjectOptions] = useState<Record<string, VoucherSubject[]>>({})
  const [cashFlowItems, setCashFlowItems] = useState<CashFlowItem[]>([])
  const [activeSubjectRowId, setActiveSubjectRowId] = useState<string | null>(null)
  const [manualSubjectRowId, setManualSubjectRowId] = useState<string | null>(null)
  const [manualTreeExpandedCodes, setManualTreeExpandedCodes] = useState<Set<string>>(new Set())
  const [cashFlowDialogOpen, setCashFlowDialogOpen] = useState(false)
  const [cashFlowDraft, setCashFlowDraft] = useState<Record<string, CashFlowDraft>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null)
  const [currentVoucherStatus, setCurrentVoucherStatus] = useState<0 | 1 | 2 | null>(null)
  const [navigableVouchers, setNavigableVouchers] = useState<VoucherListItem[]>([])
  const [loadingVoucher, setLoadingVoucher] = useState(false)
  const [dismissedEditRequestToken, setDismissedEditRequestToken] = useState<string | null>(null)
  const [baselineSignature, setBaselineSignature] = useState<string>('')
  const [isEditMode, setIsEditMode] = useState(true)

  // Matrix of refs for keyboard navigation: row x col
  // col 0: summary, 1: subject, 2: debit, 3: credit
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([])
  const subjectHierarchy = useMemo(() => buildSubjectHierarchy(allSubjects), [allSubjects])
  const manualTreeRows = useMemo(
    () => buildSubjectTreeRows(allSubjects, subjectHierarchy, currentLedger?.standard_type),
    [allSubjects, currentLedger?.standard_type, subjectHierarchy]
  )
  const manualTreeNodeByCode = useMemo(
    () => new Map(manualTreeRows.map((row) => [row.code, row])),
    [manualTreeRows]
  )
  const manualTreeHasChildren = useMemo(() => {
    const codes = new Set<string>()
    for (const row of manualTreeRows) {
      if (row.logicalParent) {
        codes.add(row.logicalParent)
      }
    }
    return codes
  }, [manualTreeRows])
  const manualVisibleTreeRows = useMemo(
    () =>
      manualTreeRows.filter((row) => {
        if (row.kind === 'category') {
          return true
        }

        let currentParent: string | null = row.logicalParent
        while (currentParent) {
          if (!manualTreeExpandedCodes.has(currentParent)) {
            return false
          }
          const parentNode = manualTreeNodeByCode.get(currentParent)
          currentParent = parentNode?.logicalParent ?? null
        }
        return true
      }),
    [manualTreeExpandedCodes, manualTreeNodeByCode, manualTreeRows]
  )

  useEffect(() => {
    if (!currentLedger || !window.electron) {
      setAllSubjects([])
      setSubjectOptions({})
      setActiveSubjectRowId(null)
      setManualSubjectRowId(null)
      setManualTreeExpandedCodes(new Set())
      return
    }

    const ledgerId = currentLedger.id
    let cancelled = false
    async function loadSubjects(): Promise<void> {
      try {
        const subjects = (await window.api.subject.getAll(ledgerId)) as VoucherSubject[]
        if (!cancelled) {
          setAllSubjects(subjects)
        }
      } catch (error) {
        if (!cancelled) {
          setAllSubjects([])
          setSubjectOptions({})
          console.error('load subjects failed', error)
        }
      }
    }

    void loadSubjects()
    return () => {
      cancelled = true
    }
  }, [currentLedger])

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
    if (!activePeriod) return
    const nextDate = `${activePeriod}-01`
    const frameId = window.requestAnimationFrame(() => {
      setDate((prev) => (prev.startsWith(activePeriod) ? prev : nextDate))
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [activePeriod, editingVoucherId])

  useEffect(() => {
    if (editingVoucherId !== null) return
    if (!currentLedger || !activePeriod || !date || date.length < 7) return
    if (!date.startsWith(activePeriod)) return
    if (!window.electron) return
    const ledgerId = currentLedger.id
    let cancelled = false
    const period = activePeriod
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
  }, [currentLedger, date, editingVoucherId, activePeriod])

  const updateRow = (
    index: number,
    field: keyof VoucherRow,
    value: VoucherRow[keyof VoucherRow]
  ): void => {
    const newRows = [...rows]
    newRows[index] = { ...newRows[index], [field]: value }
    setRows(newRows)
  }

  const carrySummaryToRow = (rowIdx: number): void => {
    setRows((prev) => inheritSummaryFromPreviousRow(prev, rowIdx))
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
          setRows((prev) => [
            ...prev,
            buildNextVoucherEntryRow(prev[rowIdx], () => createEmptyRow())
          ])
          setTimeout(() => focusCell(rowIdx + 1, 0), 50)
        } else {
          carrySummaryToRow(rowIdx + 1)
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
    if (editingVoucherId === null) return navigableVouchers.length
    const exactIndex = navigableVouchers.findIndex((voucher) => voucher.id === editingVoucherId)
    if (exactIndex >= 0) return exactIndex
    return navigableVouchers.findIndex((voucher) => String(voucher.id) === String(editingVoucherId))
  }, [editingVoucherId, navigableVouchers])
  const hasPrevVoucher = currentEditableIndex > 0
  const hasNextVoucher =
    currentEditableIndex >= 0 && currentEditableIndex < navigableVouchers.length - 1
  const isSavedVoucher = editingVoucherId !== null
  const isEditableSavedVoucher = isSavedVoucher && currentVoucherStatus === 0
  const isReadonlyVoucher = isSavedVoucher && !isEditMode
  const canEditFields = !isReadonlyVoucher && !saving && !loadingVoucher
  const hasUnsavedChanges =
    editingVoucherId !== null &&
    isEditMode &&
    baselineSignature !== '' &&
    buildDraftSignature(date, rows) !== baselineSignature
  const hasNewVoucherDraft = editingVoucherId === null && rows.some(hasDraftRowContent)

  // Dynamic set ref helper
  const setRef =
    (r: number, c: number) =>
    (el: HTMLInputElement | null): void => {
      if (!inputRefs.current[r]) inputRefs.current[r] = []
      inputRefs.current[r][c] = el
    }

  const updateSubjectOptions = (rowId: string, keyword: string): void => {
    setSubjectOptions((prev) => ({
      ...prev,
      [rowId]: filterSubjectsByKeyword(allSubjects, keyword)
    }))
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
    updateSubjectOptions(row.id, value)
  }

  const selectSubject = (rowIdx: number, subject: VoucherSubject, focusNext = false): void => {
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
    if (focusNext) {
      window.setTimeout(() => focusCell(rowIdx, 2), 0)
    }
  }

  const handleSubjectInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIdx: number
  ): void => {
    const row = rows[rowIdx]
    const firstLeafOption = findFirstLeafSubject(
      subjectOptions[row.id] ?? [],
      subjectHierarchy.hasChildrenCodes
    )

    if (event.key === 'Enter' && !row.subjectCode && firstLeafOption) {
      event.preventDefault()
      selectSubject(rowIdx, firstLeafOption, true)
      return
    }

    handleKeyDown(event, rowIdx, 1)
  }

  const openManualSubjectDialog = (rowId: string): void => {
    if (!canEditFields) {
      return
    }
    if (allSubjects.length === 0) {
      setMessage({ type: 'error', text: '当前账套暂无可选会计科目' })
      return
    }

    setActiveSubjectRowId(null)
    setManualTreeExpandedCodes(new Set())
    setManualSubjectRowId(rowId)
  }

  const closeManualSubjectDialog = useCallback((): void => {
    setManualSubjectRowId(null)
    setManualTreeExpandedCodes(new Set())
  }, [])

  const toggleManualTreeNode = (code: string): void => {
    setManualTreeExpandedCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  const selectSubjectFromDialog = (subject: VoucherSubject): void => {
    if (!manualSubjectRowId) {
      return
    }

    const rowIdx = rows.findIndex((row) => row.id === manualSubjectRowId)
    if (rowIdx < 0) {
      closeManualSubjectDialog()
      return
    }

    selectSubject(rowIdx, subject, true)
    closeManualSubjectDialog()
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

  const loadNavigableVoucherRows = async (ledgerId: number): Promise<VoucherListItem[]> => {
    const allList = await window.api.voucher.list({ ledgerId })
    return sortVoucherRowsAsc(allList as VoucherListItem[])
  }

  const refreshNavigableVouchers = async (ledgerId: number): Promise<VoucherListItem[]> => {
    try {
      const list = await loadNavigableVoucherRows(ledgerId)
      setNavigableVouchers(list)
      return list
    } catch (error) {
      console.error('load navigable vouchers failed', error)
      setNavigableVouchers([])
      return []
    }
  }

  useEffect(() => {
    const ledgerId = currentLedger?.id
    if (!ledgerId || !window.electron) {
      setNavigableVouchers([])
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const list = await loadNavigableVoucherRows(ledgerId)
        if (!cancelled) {
          setNavigableVouchers(list)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('load navigable vouchers failed', error)
          setNavigableVouchers([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentLedger?.id])

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
      const allVouchers = await refreshNavigableVouchers(currentLedger.id)
      const targetVoucher = allVouchers.find((voucher) => voucher.id === normalizedVoucherId)
      if (!targetVoucher) {
        await prepareNewVoucherState('凭证不存在或已被删除，已切换为新建凭证。')
        return false
      }

      const [entries, subjectsFromApi] = await Promise.all([
        window.api.voucher.getEntries(normalizedVoucherId),
        allSubjects.length > 0
          ? Promise.resolve(allSubjects)
          : (window.api.subject.getAll(currentLedger.id) as Promise<VoucherSubject[]>)
      ])
      if (allSubjects.length === 0) {
        setAllSubjects(subjectsFromApi)
      }
      const cashFlowSubjectCodeSet = new Set(
        subjectsFromApi
          .filter((subject) => subject.is_cash_flow === 1)
          .map((subject) => subject.code)
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
      setDismissedEditRequestToken(null)
      setCurrentVoucherStatus(targetVoucher.status)
      setSubjectOptions({})
      setActiveSubjectRowId(null)
      closeManualSubjectDialog()
      setCashFlowDialogOpen(false)
      setCashFlowDraft({})
      setBaselineSignature(buildDraftSignature(targetVoucher.voucher_date, finalRows))
      setIsEditMode(false)
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

  const loadVoucherForEditRef = useRef(loadVoucherForEdit)
  loadVoucherForEditRef.current = loadVoucherForEdit

  useEffect(() => {
    if (!currentLedger || !window.electron) return
    if (!normalizedEditVoucherId || !currentEditRequestToken) return
    if (dismissedEditRequestToken === currentEditRequestToken) return
    void loadVoucherForEditRef.current(normalizedEditVoucherId)
  }, [
    activePeriod,
    currentEditRequestToken,
    currentLedger,
    dismissedEditRequestToken,
    normalizedEditVoucherId
  ])

  const validateAndCleanRows = (): {
    valid: boolean
    cleanedRows: VoucherRow[]
    error?: string
  } => {
    if (periodDateRange && !isDateWithinRange(date, periodDateRange)) {
      return {
        valid: false,
        cleanedRows: [],
        error: `凭证日期必须在当前会计期间内（${periodDateRange.min} ~ ${periodDateRange.max}）`
      }
    }

    const cleanedRows = filterVoucherRowsForSave(rows)

    if (cleanedRows.length < 2) {
      return { valid: false, cleanedRows, error: '至少需要两条有效分录' }
    }

    for (let i = 0; i < cleanedRows.length; i += 1) {
      const row = cleanedRows[i]
      if (!row.subjectCode) {
        return { valid: false, cleanedRows, error: `第 ${i + 1} 行缺少会计科目` }
      }

      const debit = row.debit ? new Decimal(row.debit) : new Decimal(0)
      const credit = row.credit ? new Decimal(row.credit) : new Decimal(0)
      if (debit.greaterThan(0) && credit.greaterThan(0)) {
        return { valid: false, cleanedRows, error: `第 ${i + 1} 行借贷不能同时填写` }
      }
      if (debit.isZero() && credit.isZero()) {
        return { valid: false, cleanedRows, error: `第 ${i + 1} 行借贷金额不能同时为空` }
      }
    }

    if (!balanced) {
      return { valid: false, cleanedRows, error: '借贷不平衡，无法保存' }
    }

    return { valid: true, cleanedRows }
  }

  const resetVoucher = useCallback((): void => {
    const nextRows = Array.from({ length: DEFAULT_ROWS }, () => createEmptyRow())
    setRows(nextRows)
    setSubjectOptions({})
    setActiveSubjectRowId(null)
    closeManualSubjectDialog()
    setCashFlowDialogOpen(false)
    setCashFlowDraft({})
    setEditingVoucherId(null)
    setCurrentVoucherStatus(null)
    setBaselineSignature('')
    setIsEditMode(true)
  }, [closeManualSubjectDialog])

  const prepareNewVoucherState = useCallback(
    async (messageText?: string): Promise<void> => {
      setLoadingVoucher(false)
      if (currentEditRequestToken) {
        setDismissedEditRequestToken(currentEditRequestToken)
      }
      resetVoucher()
      const targetDate = activePeriod ? `${activePeriod}-01` : date
      if (activePeriod) {
        setDate(targetDate)
      }

      if (!currentLedger || !targetDate || targetDate.length < 7 || !window.electron) {
        if (messageText) {
          setMessage({ type: 'success', text: messageText })
        }
        return
      }

      const period = activePeriod || targetDate.slice(0, 7)
      try {
        const next = await window.api.voucher.getNextNumber(currentLedger.id, period)
        setVoucherNumber(next)
        if (messageText) {
          setMessage({ type: 'success', text: messageText })
        }
      } catch (error) {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '获取下一个凭证号失败'
        })
      }
    },
    [activePeriod, currentEditRequestToken, currentLedger, date, resetVoucher]
  )

  const handleNewVoucher = async (): Promise<void> => {
    setMessage(null)
    await prepareNewVoucherState()
  }

  useEffect(() => {
    if (
      activeTabId !== 'voucher-entry' ||
      editingVoucherId === null ||
      !currentLedger ||
      !window.electron ||
      loadingVoucher
    ) {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const list = await loadNavigableVoucherRows(currentLedger.id)
        if (cancelled) return

        setNavigableVouchers(list)
        if (!list.some((voucher) => voucher.id === editingVoucherId)) {
          await prepareNewVoucherState('当前凭证已被删除，凭证录入已恢复为新建状态。')
        }
      } catch (error) {
        if (!cancelled) {
          console.error('refresh active voucher failed', error)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeTabId, currentLedger, editingVoucherId, loadingVoucher, prepareNewVoucherState])

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

      await refreshNavigableVouchers(currentLedger.id)
      const normalizedRows = padRows(cleanedRows.map((row) => ({ ...row })))
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
        setRows(normalizedRows)
        setBaselineSignature(buildDraftSignature(date, normalizedRows))
        setCurrentVoucherStatus((result.status as 0 | 1 | 2) ?? 0)
        setIsEditMode(false)
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

  const handleEnableEdit = (): void => {
    if (editingVoucherId === null) return
    if (currentVoucherStatus !== 0) {
      setMessage({ type: 'error', text: '仅未审核凭证可修改，当前凭证为只读。' })
      return
    }
    setIsEditMode(true)
    setMessage(null)
  }

  const handleDateChange = (nextDate: string): void => {
    if (!canEditFields) return
    if (!isDateWithinRange(nextDate, periodDateRange)) {
      if (periodDateRange) {
        setMessage({
          type: 'error',
          text: `凭证日期必须在当前会计期间内（${periodDateRange.min} ~ ${periodDateRange.max}）`
        })
      }
      return
    }
    setMessage(null)
    setDate(nextDate)
  }

  const handleSave = async (): Promise<void> => {
    if (isReadonlyVoucher) {
      setMessage({
        type: 'error',
        text: isEditableSavedVoucher
          ? '当前凭证为已保存状态，请先点击“修改”后再编辑。'
          : '仅未审核凭证可修改，当前凭证为只读。'
      })
      return
    }
    const mode = editingVoucherId === null ? 'newAfterSave' : 'stay'
    await saveVoucher(mode)
  }

  const handleSwitchVoucher = async (direction: 'prev' | 'next'): Promise<void> => {
    if (loadingVoucher || saving) return
    if (navigableVouchers.length === 0) return
    if (currentEditableIndex < 0) {
      setMessage({ type: 'error', text: '凭证导航序列已过期，请刷新后重试' })
      return
    }

    const targetIndex = direction === 'prev' ? currentEditableIndex - 1 : currentEditableIndex + 1
    const targetVoucher = navigableVouchers[targetIndex]
    if (!targetVoucher) return

    setMessage(null)
    if (hasNewVoucherDraft) {
      const shouldDiscard = window.confirm('当前新凭证尚未保存，切换后将丢失输入内容。是否继续？')
      if (!shouldDiscard) return
    } else if (hasUnsavedChanges) {
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
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {editingVoucherId ? (isEditMode ? '记账凭证（修改）' : '记账凭证（查看）') : '记账凭证'}
          </h2>
          <span
            className="px-2 py-1 rounded-md text-xs border"
            style={{
              color: isReadonlyVoucher ? 'var(--color-text-secondary)' : 'var(--color-success)',
              borderColor: isReadonlyVoucher
                ? 'var(--color-glass-border-light)'
                : 'rgba(22, 163, 74, 0.35)'
            }}
          >
            {isReadonlyVoucher ? '查看中' : '编辑中'}
          </span>
        </div>
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
          {isSavedVoucher && (
            <button
              className="glass-btn-secondary"
              onClick={handleEnableEdit}
              disabled={!isEditableSavedVoucher || isEditMode || saving || loadingVoucher}
              title={
                !isEditableSavedVoucher
                  ? '仅未审核凭证可修改'
                  : isEditMode
                    ? '当前凭证已处于修改状态'
                    : '进入修改状态'
              }
            >
              修改
            </button>
          )}
          <button
            className="glass-btn-secondary"
            style={{ borderColor: balanced ? 'var(--color-success)' : '' }}
            onClick={() => void handleSave()}
            disabled={saving || loadingVoucher || isReadonlyVoucher}
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
            min={periodDateRange?.min}
            max={periodDateRange?.max}
            onChange={(e) => handleDateChange(e.target.value)}
            disabled={!canEditFields}
          />
        </div>
        <button
          type="button"
          className="glass-btn-secondary text-sm px-3 py-1.5"
          onClick={openCashFlowDialog}
          disabled={!canEditFields}
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
          {rows.map((row, rIdx) => {
            const showAssignedCashFlowHint = row.isCashFlow && row.cashFlowItemId !== null
            const showPendingCashFlowHint = shouldShowPendingCashFlowHint(rows, rIdx, row)
            return (
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
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none transition-colors"
                    value={row.summary}
                    onChange={(e) => updateRow(rIdx, 'summary', e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, rIdx, 0)}
                    onFocus={() => carrySummaryToRow(rIdx)}
                    placeholder="摘要"
                    disabled={!canEditFields}
                    aria-label="voucher-row-summary"
                  />
                </div>
                <div
                  className="col-span-5 border-r relative"
                  style={{ borderColor: 'var(--color-glass-border-light)' }}
                >
                  <input
                    ref={setRef(rIdx, 1)}
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 pr-14 outline-none transition-colors"
                    value={row.subjectInput}
                    onChange={(e) => handleSubjectInput(rIdx, e.target.value)}
                    onKeyDown={(e) => handleSubjectInputKeyDown(e, rIdx)}
                    onFocus={() => {
                      carrySummaryToRow(rIdx)
                      setActiveSubjectRowId(row.id)
                      if (row.subjectInput.trim()) {
                        updateSubjectOptions(row.id, row.subjectInput)
                      }
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setActiveSubjectRowId((prev) => (prev === row.id ? null : prev))
                      }, 100)
                    }}
                    placeholder="输入末级科目代码或名称"
                    disabled={!canEditFields}
                    aria-label="voucher-row-subject"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold cursor-pointer transition-colors hover:bg-white/95"
                    style={{
                      backgroundColor: 'rgba(255, 255, 255, 0.84)',
                      border: '1px solid rgba(148, 163, 184, 0.28)',
                      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.14)',
                      color: 'var(--color-text-primary)',
                      backdropFilter: 'blur(10px)'
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openManualSubjectDialog(row.id)}
                    disabled={!canEditFields}
                    aria-label="voucher-row-subject-picker"
                    title="手动选择科目"
                  >
                    +
                  </button>
                  {activeSubjectRowId === row.id && (subjectOptions[row.id] || []).length > 0 && (
                    <div className="absolute z-30 left-0 right-0 top-full mt-1 glass-panel-light max-h-48 overflow-y-auto">
                      {(subjectOptions[row.id] || []).map((subject) => {
                        const subjectLogicalLevel =
                          subjectHierarchy.logicalLevelByCode.get(subject.code) ?? 1
                        const isLeafSubject = !subjectHierarchy.hasChildrenCodes.has(subject.code)

                        return (
                          <button
                            key={subject.id}
                            type="button"
                            className={`w-full text-left px-3 py-2 text-sm ${
                              isLeafSubject
                                ? 'hover:bg-white/20 cursor-pointer'
                                : 'cursor-not-allowed bg-white/5'
                            }`}
                            style={{
                              color: isLeafSubject
                                ? 'var(--color-text-primary)'
                                : 'var(--color-text-secondary)'
                            }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              if (!isLeafSubject) {
                                return
                              }
                              selectSubject(rIdx, subject, true)
                            }}
                            disabled={!isLeafSubject}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {renderSubjectIndent(subjectLogicalLevel)}
                              <span className="truncate flex-1">
                                {subject.code} {subject.name}
                              </span>
                              <span className="shrink-0 text-[11px]">
                                {isLeafSubject ? '末级' : '上级'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
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
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none text-right transition-colors"
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
                    onFocus={() => carrySummaryToRow(rIdx)}
                    disabled={!canEditFields}
                    aria-label="voucher-row-debit"
                  />
                </div>
                <div className="col-span-2 relative">
                  <input
                    ref={setRef(rIdx, 3)}
                    type="text"
                    inputMode="decimal"
                    className="voucher-grid-input w-full h-full bg-transparent px-3 py-3 outline-none text-right transition-colors"
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
                    onFocus={() => carrySummaryToRow(rIdx)}
                    disabled={!canEditFields}
                    aria-label="voucher-row-credit"
                  />
                  {(showAssignedCashFlowHint || showPendingCashFlowHint) && (
                    <span
                      className="absolute left-2 bottom-1 text-[11px] pointer-events-none"
                      style={{
                        color: showAssignedCashFlowHint
                          ? 'var(--color-success)'
                          : 'var(--color-danger)'
                      }}
                    >
                      {showAssignedCashFlowHint ? '已分配现金流' : '待分配现金流'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
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

      <Dialog.Root
        open={manualSubjectRowId !== null}
        onOpenChange={(open) => !open && closeManualSubjectDialog()}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
          <Dialog.Content
            className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(820px,calc(100vw-32px))] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden p-6 focus:outline-none"
            style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title
                  className="text-lg font-bold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  手动选择会计科目
                </Dialog.Title>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  仅允许选择末级科目。科目树默认收起，可按层级展开后选择。
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary text-sm px-3 py-1.5"
                onClick={closeManualSubjectDialog}
              >
                关闭
              </button>
            </div>

            <div
              className="mt-4 overflow-auto rounded-md border max-h-[60vh]"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div
                className="grid grid-cols-[140px_minmax(0,1fr)_88px] gap-3 px-4 py-3 text-sm font-semibold border-b"
                style={{
                  borderColor: 'var(--color-glass-border-light)',
                  color: 'var(--color-text-primary)'
                }}
              >
                <div>科目编码</div>
                <div>科目名称</div>
                <div className="text-right">类型</div>
              </div>

              {manualVisibleTreeRows.length === 0 ? (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前账套暂无可选科目
                </div>
              ) : (
                manualVisibleTreeRows.map((treeRow) => {
                  const hasChildren = manualTreeHasChildren.has(treeRow.code)
                  const isLeaf = treeRow.kind === 'subject' && !hasChildren
                  const isCategory = treeRow.kind === 'category'
                  const subjectLogicalLevel = treeRow.kind === 'subject' ? treeRow.logicalLevel : 0

                  return (
                    <div
                      key={treeRow.id}
                      className="grid grid-cols-[140px_minmax(0,1fr)_88px] gap-3 px-3 py-2 text-sm items-center border-b last:border-b-0"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      <div className="flex min-w-0 items-center">
                        {!isCategory && renderSubjectIndent(subjectLogicalLevel)}
                        <span className="truncate">{isCategory ? '' : treeRow.row.code}</span>
                      </div>
                      <div className="flex items-center gap-1 min-w-0">
                        {!isCategory && renderSubjectIndent(subjectLogicalLevel)}
                        {hasChildren ? (
                          <button
                            type="button"
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-slate-800 hover:bg-black/5 shrink-0"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                            aria-label={manualTreeExpandedCodes.has(treeRow.code) ? '折叠' : '展开'}
                          >
                            {manualTreeExpandedCodes.has(treeRow.code) ? (
                              <ChevronDown />
                            ) : (
                              <ChevronRight />
                            )}
                          </button>
                        ) : (
                          <span className="w-5 h-5 shrink-0" />
                        )}

                        {isCategory ? (
                          <button
                            type="button"
                            className="truncate text-left font-semibold"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                          >
                            {treeRow.name}
                          </button>
                        ) : isLeaf ? (
                          <button
                            type="button"
                            className="truncate text-left hover:text-slate-950"
                            onClick={() => selectSubjectFromDialog(treeRow.row)}
                          >
                            {treeRow.row.name}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="truncate text-left text-slate-600 hover:text-slate-950"
                            onClick={() => toggleManualTreeNode(treeRow.code)}
                          >
                            {treeRow.row.name}
                          </button>
                        )}
                      </div>
                      <div
                        className="text-right text-xs"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {isCategory ? '' : isLeaf ? '末级' : '上级'}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
                        aria-label="cashflow-allocation-row-toggle"
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
                        aria-label="cashflow-allocation-item-select"
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

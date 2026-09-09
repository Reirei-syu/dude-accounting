import Decimal from 'decimal.js'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useLedgerStore } from '../../stores/ledgerStore'
import { useUIStore } from '../../stores/uiStore'
import { prepareAndOpenPrintPreview } from '../printUtils'
import {
  buildNextVoucherEntryRow,
  filterVoucherRowsForSave,
  inheritSummaryFromPreviousRow
} from '../voucherEntryRowUtils'
import { getDefaultVoucherDateForNewVoucher, sortVouchersForDisplay } from '../voucherOrdering'
import { buildVoucherSubjectPath, filterLeafVoucherSubjectsByKeyword } from '../voucherSubjectUtils'
import {
  AMOUNT_PATTERN,
  buildClosedPeriodEditMessage,
  buildDraftSignature,
  buildEditRequestToken,
  buildSubjectHierarchy,
  buildSubjectTreeRows,
  CashFlowDraft,
  CashFlowItem,
  createEmptyRow,
  DEFAULT_ROWS,
  findFirstLeafSubject,
  getPeriodDateRange,
  hasDraftRowContent,
  isDateWithinRange,
  padRows,
  PERIOD_PATTERN,
  PeriodStatusSummary,
  toAmountText,
  toPositiveInt,
  VoucherEntryFromApi,
  VoucherEntryProps,
  VoucherListItem,
  VoucherRow,
  VoucherSubject
} from './voucherEntryModel'

// 返回对象是组件 Pick 契约的唯一类型来源，避免维护一份重复的状态声明。
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useVoucherEntryController({
  editVoucherId,
  editRequestKey,
  initialElectronicDraft
}: VoucherEntryProps) {
  const mountedRef = useRef(false)
  const draftRequestRef = useRef(0)
  const navigationRequestRef = useRef(0)
  const numberRequestRef = useRef(0)
  const saveLockRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      draftRequestRef.current += 1
      navigationRequestRef.current += 1
      numberRequestRef.current += 1
    }
  }, [])
  const { currentLedger, currentPeriod } = useLedgerStore()
  const contextToken = useMemo(
    () => ({ ledgerId: currentLedger?.id, period: currentPeriod }),
    [currentLedger?.id, currentPeriod]
  )
  const contextTokenRef = useRef(contextToken)
  useLayoutEffect(() => {
    contextTokenRef.current = contextToken
  }, [contextToken])
  const isCurrentContext = useCallback((): boolean => {
    const current = useLedgerStore.getState()
    return (
      mountedRef.current &&
      contextTokenRef.current === contextToken &&
      current.currentLedger?.id === currentLedger?.id &&
      current.currentPeriod === currentPeriod
    )
  }, [contextToken, currentLedger?.id, currentPeriod])
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
    initialElectronicDraft?.voucherDate ??
      (currentPeriod ? `${currentPeriod}-01` : new Date().toISOString().split('T')[0])
  )
  const [electronicSource, setElectronicSource] = useState(initialElectronicDraft)
  const [voucherNumber, setVoucherNumber] = useState<number>(1)
  const [rows, setRows] = useState<VoucherRow[]>(
    Array.from({ length: DEFAULT_ROWS }, (_, index) => ({
      ...createEmptyRow(),
      summary: index === 0 ? (initialElectronicDraft?.summary ?? '') : ''
    }))
  )
  const [allSubjects, setAllSubjects] = useState<VoucherSubject[]>([])
  const [subjectOptions, setSubjectOptions] = useState<Record<string, VoucherSubject[]>>({})
  const [cashFlowItems, setCashFlowItems] = useState<CashFlowItem[]>([])
  const [activeSubjectRowId, setActiveSubjectRowId] = useState<string | null>(null)
  const [manualSubjectRowId, setManualSubjectRowId] = useState<string | null>(null)
  const [manualSubjectSearchKeyword, setManualSubjectSearchKeyword] = useState('')
  const [manualTreeExpandedCodes, setManualTreeExpandedCodes] = useState<Set<string>>(new Set())
  const [cashFlowDialogOpen, setCashFlowDialogOpen] = useState(false)
  const [cashFlowDraft, setCashFlowDraft] = useState<Record<string, CashFlowDraft>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [periodStatus, setPeriodStatus] = useState<PeriodStatusSummary | null>(null)
  const [editingVoucherId, setEditingVoucherId] = useState<number | null>(null)
  const [currentVoucherStatus, setCurrentVoucherStatus] = useState<0 | 1 | 2 | 3 | null>(null)
  const [navigableVouchers, setNavigableVouchers] = useState<VoucherListItem[]>([])
  const [defaultVoucherWord, setDefaultVoucherWord] = useState('记')
  const [newVoucherDateStrategy, setNewVoucherDateStrategy] = useState<
    'last_voucher_date' | 'period_start'
  >('last_voucher_date')
  const [voucherPrintLayout, setVoucherPrintLayout] = useState<'single' | 'double'>('single')
  const [voucherPrintDoubleGapPx, setVoucherPrintDoubleGapPx] = useState('24')
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [printSubmitting, setPrintSubmitting] = useState(false)
  const [loadingVoucher, setLoadingVoucher] = useState(false)
  const [dismissedEditRequestToken, setDismissedEditRequestToken] = useState<string | null>(null)
  const [baselineSignature, setBaselineSignature] = useState<string>('')
  const [isEditMode, setIsEditMode] = useState(true)

  // Matrix of refs for keyboard navigation: row x col
  // col 0: summary, 1: subject, 2: debit, 3: credit
  const inputRefs = useRef<(HTMLInputElement | null)[][]>([])
  const lastFocusedCellRef = useRef<{ rowIdx: number; colIdx: number } | null>(null)
  const subjectHierarchy = useMemo(() => buildSubjectHierarchy(allSubjects), [allSubjects])
  const subjectByCode = useMemo(
    () => new Map(allSubjects.map((subject) => [subject.code, subject])),
    [allSubjects]
  )
  const subjectPathByCode = useMemo(
    () =>
      new Map(
        allSubjects.map((subject) => [
          subject.code,
          buildVoucherSubjectPath(subject.code, subjectByCode, subjectHierarchy.logicalParentByCode)
        ])
      ),
    [allSubjects, subjectByCode, subjectHierarchy.logicalParentByCode]
  )
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
  const manualSearchResults = useMemo(
    () =>
      filterLeafVoucherSubjectsByKeyword(
        allSubjects,
        manualSubjectSearchKeyword,
        subjectHierarchy.hasChildrenCodes
      ),
    [allSubjects, manualSubjectSearchKeyword, subjectHierarchy.hasChildrenCodes]
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
    if (typeof document === 'undefined') return
    if (manualSubjectRowId === null && !cashFlowDialogOpen && !printDialogOpen) {
      document.body.style.pointerEvents = ''
    }
    return () => {
      document.body.style.pointerEvents = ''
    }
  }, [cashFlowDialogOpen, manualSubjectRowId, printDialogOpen])

  useEffect(() => {
    if (!window.electron) return

    Promise.all([
      window.api.settings.getRuntimeDefaults(),
      window.api.settings.getUserPreferences()
    ])
      .then(([settings, preferences]) => {
        if (!mountedRef.current) return
        setDefaultVoucherWord(settings.default_voucher_word || '记')
        setNewVoucherDateStrategy(
          settings.new_voucher_date_strategy === 'period_start'
            ? 'period_start'
            : 'last_voucher_date'
        )
        setVoucherPrintLayout(preferences.voucher_print_layout === 'double' ? 'double' : 'single')
        setVoucherPrintDoubleGapPx(preferences.voucher_print_double_gap || '24')
      })
      .catch((error) => {
        console.error('load voucher entry settings failed', error)
      })
  }, [])

  useEffect(() => {
    if (!currentLedger || !activePeriod || !window.electron) {
      setPeriodStatus(null)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const result = (await window.api.period.getStatus(
          currentLedger.id,
          activePeriod
        )) as PeriodStatusSummary
        if (!cancelled) {
          setPeriodStatus(result)
        }
      } catch (error) {
        if (!cancelled) {
          console.error('load period status failed', error)
          setPeriodStatus(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activePeriod, activeTabId, currentLedger])

  useEffect(() => {
    if (editingVoucherId !== null) return
    if (periodStatus?.is_closed === 1) return
    if (!currentLedger || !activePeriod || !date || date.length < 7) return
    if (!date.startsWith(activePeriod)) return
    if (!window.electron) return
    const ledgerId = currentLedger.id
    let cancelled = false
    const period = activePeriod
    const request = ++numberRequestRef.current
    async function loadNextNumber(): Promise<void> {
      try {
        const next = await window.api.voucher.getNextNumber(ledgerId, period)
        if (!cancelled && request === numberRequestRef.current) {
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
  }, [currentLedger, date, editingVoucherId, activePeriod, periodStatus])

  const updateRow = (
    index: number,
    field: keyof VoucherRow,
    value: VoucherRow[keyof VoucherRow]
  ): void => {
    const newRows = [...rows]
    newRows[index] = { ...newRows[index], [field]: value }
    setRows(newRows)
  }

  const updateAmount = (index: number, side: 'debit' | 'credit', value: string): void => {
    if (value !== '' && !AMOUNT_PATTERN.test(value)) return
    const row = rows[index]
    const opposite = side === 'debit' ? 'credit' : 'debit'
    const nextRows = [...rows]
    nextRows[index] = { ...row, [side]: value, [opposite]: value ? '' : row[opposite] }
    setRows(nextRows)
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
    if (!mountedRef.current) return
    if (inputRefs.current[rowIdx] && inputRefs.current[rowIdx][colIdx]) {
      inputRefs.current[rowIdx][colIdx]?.focus()
    }
  }

  const restoreEditorInteraction = (fallback?: { rowIdx: number; colIdx: number }): void => {
    window.requestAnimationFrame(() => {
      if (!mountedRef.current) return
      if (typeof document !== 'undefined') {
        document.body.style.pointerEvents = ''
      }
      window.focus()
      const target = fallback ?? lastFocusedCellRef.current ?? { rowIdx: 0, colIdx: 0 }
      focusCell(target.rowIdx, target.colIdx)
    })
  }

  const closeCashFlowDialog = (restoreFocus = true): void => {
    setCashFlowDialogOpen(false)
    if (restoreFocus) {
      restoreEditorInteraction()
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
  const currentVoucherPeriod = useMemo(
    () => (date.length >= 7 && PERIOD_PATTERN.test(date.slice(0, 7)) ? date.slice(0, 7) : ''),
    [date]
  )
  const navigableVoucherPeriod = useMemo(
    () =>
      editingVoucherId === null
        ? activePeriod || undefined
        : currentVoucherPeriod || activePeriod || undefined,
    [activePeriod, currentVoucherPeriod, editingVoucherId]
  )
  const hasPrevVoucher = currentEditableIndex > 0
  const hasNextVoucher =
    currentEditableIndex >= 0 && currentEditableIndex < navigableVouchers.length - 1
  const isClosedPeriod = periodStatus?.is_closed === 1
  const isSavedVoucher = editingVoucherId !== null
  const isEditableSavedVoucher = isSavedVoucher && currentVoucherStatus === 0 && !isClosedPeriod
  const isReadonlyVoucher = isClosedPeriod || (isSavedVoucher && !isEditMode)
  const canEditFields = !isReadonlyVoucher && !saving && !loadingVoucher
  const closedPeriodMessage = activePeriod ? buildClosedPeriodEditMessage(activePeriod) : ''
  const hasUnsavedChanges =
    editingVoucherId !== null &&
    isEditMode &&
    baselineSignature !== '' &&
    buildDraftSignature(date, rows) !== baselineSignature
  const hasNewVoucherDraft = editingVoucherId === null && rows.some(hasDraftRowContent)
  const currentVoucherMeta = useMemo(
    () =>
      editingVoucherId === null
        ? null
        : (navigableVouchers.find((voucher) => voucher.id === editingVoucherId) ?? null),
    [editingVoucherId, navigableVouchers]
  )
  const creatorDisplayName =
    currentVoucherMeta?.creator_name || currentUser?.realName || currentUser?.username || '待制单'
  const auditorDisplayName = currentVoucherMeta?.auditor_name || '待审核'
  const bookkeeperDisplayName = currentVoucherMeta?.bookkeeper_name || '待记账'

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
      [rowId]: filterLeafVoucherSubjectsByKeyword(
        allSubjects,
        keyword,
        subjectHierarchy.hasChildrenCodes
      )
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
    setManualSubjectSearchKeyword('')
    setManualTreeExpandedCodes(new Set())
    setManualSubjectRowId(rowId)
  }

  const closeManualSubjectDialog = useCallback((): void => {
    setManualSubjectRowId(null)
    setManualSubjectSearchKeyword('')
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
    if (!canEditFields) {
      return
    }

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
    closeCashFlowDialog()
    setMessage({ type: 'success', text: '现金流量分配已更新' })
  }

  const loadNavigableVoucherRows = useCallback(
    async (ledgerId: number, period?: string): Promise<VoucherListItem[]> => {
      const allList = await window.api.voucher.list({
        ledgerId,
        period
      })
      return sortVouchersForDisplay(allList as VoucherListItem[])
    },
    []
  )

  const refreshNavigableVouchers = useCallback(
    async (ledgerId: number, period?: string): Promise<VoucherListItem[]> => {
      const request = ++navigationRequestRef.current
      try {
        const list = await loadNavigableVoucherRows(ledgerId, period)
        if (isCurrentContext() && request === navigationRequestRef.current)
          setNavigableVouchers(list)
        return list
      } catch (error) {
        console.error('load navigable vouchers failed', error)
        if (isCurrentContext() && request === navigationRequestRef.current) setNavigableVouchers([])
        return []
      }
    },
    [isCurrentContext, loadNavigableVoucherRows]
  )

  useEffect(() => {
    const ledgerId = currentLedger?.id
    if (!ledgerId || !window.electron) {
      setNavigableVouchers([])
      return
    }

    let cancelled = false
    const request = ++navigationRequestRef.current
    void (async () => {
      try {
        const list = await loadNavigableVoucherRows(ledgerId, navigableVoucherPeriod)
        if (!cancelled && request === navigationRequestRef.current) {
          setNavigableVouchers(list)
          if (editingVoucherId === null && activePeriod && !electronicSource) {
            setDate(getDefaultVoucherDateForNewVoucher(activePeriod, list, newVoucherDateStrategy))
          }
        }
      } catch (error) {
        if (!cancelled && request === navigationRequestRef.current) {
          console.error('load navigable vouchers failed', error)
          setNavigableVouchers([])
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activePeriod,
    currentLedger?.id,
    editingVoucherId,
    loadNavigableVoucherRows,
    navigableVoucherPeriod,
    newVoucherDateStrategy,
    electronicSource
  ])

  const loadVoucherForEdit = async (voucherId: number): Promise<boolean> => {
    if (!isCurrentContext() || !currentLedger || !window.electron) return false
    const request = ++draftRequestRef.current
    const isCurrent = (): boolean => isCurrentContext() && request === draftRequestRef.current
    const normalizedVoucherId = toPositiveInt(voucherId)
    if (normalizedVoucherId === null) {
      setMessage({ type: 'error', text: '凭证编号无效' })
      return false
    }

    setLoadingVoucher(true)
    setMessage(null)
    try {
      const allVouchers = await refreshNavigableVouchers(currentLedger.id)
      if (!isCurrent()) return false
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
      if (!isCurrent()) return false
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
      setElectronicSource(undefined)
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
      if (!isCurrent()) return false
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载凭证失败'
      })
      return false
    } finally {
      if (mountedRef.current && request === draftRequestRef.current) setLoadingVoucher(false)
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
    setElectronicSource(undefined)
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
      if (!isCurrentContext()) return
      const request = ++draftRequestRef.current
      const isCurrent = (): boolean => isCurrentContext() && request === draftRequestRef.current
      setLoadingVoucher(false)
      if (currentEditRequestToken) {
        setDismissedEditRequestToken(currentEditRequestToken)
      }
      resetVoucher()
      let targetDate = activePeriod ? `${activePeriod}-01` : date

      if (!currentLedger || !targetDate || targetDate.length < 7 || !window.electron) {
        if (messageText) {
          setMessage({ type: 'success', text: messageText })
        }
        return
      }

      const navigableList = await refreshNavigableVouchers(
        currentLedger.id,
        activePeriod || undefined
      )
      if (!isCurrent()) return
      if (activePeriod) {
        targetDate = getDefaultVoucherDateForNewVoucher(
          activePeriod,
          navigableList,
          newVoucherDateStrategy
        )
        setDate(targetDate)
      }

      const period = activePeriod || targetDate.slice(0, 7)
      if (periodStatus?.is_closed === 1) {
        setMessage({
          type: 'error',
          text: buildClosedPeriodEditMessage(period)
        })
        return
      }

      const numberRequest = ++numberRequestRef.current
      try {
        const next = await window.api.voucher.getNextNumber(currentLedger.id, period)
        if (!isCurrent() || numberRequest !== numberRequestRef.current) return
        setVoucherNumber(next)
        if (messageText) {
          setMessage({ type: 'success', text: messageText })
        }
      } catch (error) {
        if (!isCurrent() || numberRequest !== numberRequestRef.current) return
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '获取下一个凭证号失败'
        })
      }
    },
    [
      activePeriod,
      currentEditRequestToken,
      currentLedger,
      date,
      isCurrentContext,
      newVoucherDateStrategy,
      periodStatus,
      refreshNavigableVouchers,
      resetVoucher
    ]
  )

  const handleNewVoucher = async (): Promise<void> => {
    setMessage(null)
    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }
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
    const request = ++navigationRequestRef.current
    void (async () => {
      try {
        const list = await loadNavigableVoucherRows(
          currentLedger.id,
          date.length >= 7 && PERIOD_PATTERN.test(date.slice(0, 7))
            ? date.slice(0, 7)
            : activePeriod || undefined
        )
        if (cancelled || request !== navigationRequestRef.current) return

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
  }, [
    activePeriod,
    activeTabId,
    currentLedger,
    date,
    editingVoucherId,
    loadingVoucher,
    loadNavigableVoucherRows,
    prepareNewVoucherState
  ])

  const saveVoucher = async (mode: 'newAfterSave' | 'stay'): Promise<boolean> => {
    if (!isCurrentContext() || saveLockRef.current) return false
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
    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return false
    }

    const { valid, cleanedRows, error } = validateAndCleanRows()
    if (!valid) {
      setMessage({ type: 'error', text: error || '校验失败' })
      return false
    }

    saveLockRef.current = true
    const request = draftRequestRef.current
    const isCurrent = (): boolean => isCurrentContext() && request === draftRequestRef.current
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
              voucherWord: defaultVoucherWord,
              sourceRecordId: electronicSource?.sourceRecordId,
              sourceFingerprint: electronicSource?.sourceFingerprint,
              entries: payloadEntries
            })
          : await window.api.voucher.update({
              voucherId: editingVoucherId,
              ledgerId: currentLedger.id,
              voucherDate: date,
              entries: payloadEntries
            })

      if (!isCurrent()) return false
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存失败' })
        return false
      }

      await refreshNavigableVouchers(currentLedger.id, date.slice(0, 7))
      if (!isCurrent()) return false
      const normalizedRows = padRows(cleanedRows.map((row) => ({ ...row })))
      if (editingVoucherId === null) {
        setMessage({
          type: 'success',
          text: `凭证已保存（${defaultVoucherWord}-${String(result.voucherNumber).padStart(4, '0')}）`
        })
        if (mode === 'newAfterSave') {
          await handleNewVoucher()
        }
      } else {
        setMessage({
          type: 'success',
          text: `凭证已更新（${defaultVoucherWord}-${String(voucherNumber).padStart(4, '0')}）`
        })
        setRows(normalizedRows)
        setBaselineSignature(buildDraftSignature(date, normalizedRows))
        setCurrentVoucherStatus((result.status as 0 | 1 | 2 | 3) ?? 0)
        setIsEditMode(false)
      }
      return true
    } catch (error) {
      if (!isCurrent()) return false
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存失败'
      })
      return false
    } finally {
      saveLockRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  const handleEnableEdit = (): void => {
    if (editingVoucherId === null) return
    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }
    if (currentVoucherStatus !== 0) {
      setMessage({ type: 'error', text: '仅未审核凭证可修改，当前凭证为只读。' })
      return
    }
    setIsEditMode(true)
    setMessage(null)
    restoreEditorInteraction()
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

  const handleDateInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    const nextDate = event.currentTarget.value

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
    window.requestAnimationFrame(() => {
      focusCell(0, 0)
    })
  }

  const handleOpenPrintDialog = (): void => {
    setMessage(null)
    if (editingVoucherId === null) {
      setMessage({ type: 'error', text: '请先保存当前凭证后再打印' })
      return
    }
    setPrintDialogOpen(true)
  }

  const handleConfirmPrint = async (): Promise<void> => {
    if (!currentLedger || editingVoucherId === null) {
      setMessage({ type: 'error', text: '请先保存当前凭证后再打印' })
      return
    }

    const gapValue = Number(voucherPrintDoubleGapPx)
    if (
      voucherPrintLayout === 'double' &&
      (!Number.isFinite(gapValue) || gapValue < 0 || gapValue > 500)
    ) {
      setMessage({ type: 'error', text: '两联上下间距需为 0 到 500 之间的数字' })
      return
    }

    setPrintSubmitting(true)
    try {
      await window.api.settings.setUserPreferences({
        voucher_print_layout: voucherPrintLayout,
        voucher_print_double_gap: String(voucherPrintLayout === 'double' ? gapValue : 24)
      })
      if (!mountedRef.current) return
      const result = await prepareAndOpenPrintPreview({
        type: 'voucher',
        ledgerId: currentLedger.id,
        voucherIds: [editingVoucherId],
        layout: voucherPrintLayout,
        doubleGapPx: voucherPrintLayout === 'double' ? gapValue : 24
      })
      if (!mountedRef.current) return
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '打开打印预览失败' })
        return
      }
      setPrintDialogOpen(false)
      setMessage({ type: 'success', text: '已打开凭证打印预览' })
    } finally {
      if (mountedRef.current) setPrintSubmitting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (isClosedPeriod) {
      setMessage({ type: 'error', text: closedPeriodMessage })
      return
    }
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

  return {
    electronicSource,
    activeSubjectRowId,
    applyCashFlowAllocation,
    auditorDisplayName,
    balanced,
    bookkeeperDisplayName,
    canEditFields,
    carrySummaryToRow,
    cashFlowCandidateRows,
    cashFlowDialogOpen,
    cashFlowDraft,
    cashFlowItems,
    changeCashFlowDraftItem,
    closeCashFlowDialog,
    closeManualSubjectDialog,
    closedPeriodMessage,
    creatorDisplayName,
    currentLedger,
    date,
    editingVoucherId,
    handleConfirmPrint,
    handleDateChange,
    handleDateInputKeyDown,
    handleEnableEdit,
    handleKeyDown,
    handleNewVoucher,
    handleOpenPrintDialog,
    handleSave,
    handleSubjectInput,
    handleSubjectInputKeyDown,
    handleSwitchVoucher,
    hasNextVoucher,
    hasPrevVoucher,
    isClosedPeriod,
    isEditMode,
    isEditableSavedVoucher,
    isReadonlyVoucher,
    isSavedVoucher,
    lastFocusedCellRef,
    loadingVoucher,
    manualSearchResults,
    manualSubjectRowId,
    manualSubjectSearchKeyword,
    manualTreeExpandedCodes,
    manualTreeHasChildren,
    manualVisibleTreeRows,
    message,
    openCashFlowDialog,
    openManualSubjectDialog,
    periodDateRange,
    printDialogOpen,
    printSubmitting,
    restoreEditorInteraction,
    rows,
    saving,
    selectSubject,
    selectSubjectFromDialog,
    setActiveSubjectRowId,
    setManualSubjectSearchKeyword,
    setPrintDialogOpen,
    setRef,
    setRows,
    setVoucherPrintDoubleGapPx,
    setVoucherPrintLayout,
    subjectHierarchy,
    subjectOptions,
    subjectPathByCode,
    toggleCashFlowRow,
    toggleManualTreeNode,
    totalCredit,
    totalDebit,
    updateRow,
    updateAmount,
    updateSubjectOptions,
    voucherNumber,
    voucherPrintDoubleGapPx,
    voucherPrintLayout
  }
}
export type VoucherEntryController = ReturnType<typeof useVoucherEntryController>

import Decimal from 'decimal.js'
import { type JSX } from 'react'

export interface VoucherRow {
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

export interface VoucherSubject {
  id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  level: number
  is_cash_flow: number
}

export type SubjectTreeRow =
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

export interface SubjectHierarchy {
  logicalParentByCode: Map<string, string | null>
  logicalLevelByCode: Map<string, number>
  hasChildrenCodes: Set<string>
}

export interface CashFlowItem {
  id: number
  code: string
  name: string
}

export interface CashFlowDraft {
  selected: boolean
  cashFlowItemId: number | null
}

export interface VoucherEntryProps {
  initialElectronicDraft?: {
    ledgerId: number
    voucherDate: string
    summary: string
    sourceRecordId: number
    sourceFingerprint: string
    amountCents: number | null
  }
  title?: string
  componentType?: string
  editVoucherId?: number | string
  editRequestKey?: number
}

export interface VoucherListItem {
  id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2 | 3
  creator_id?: number | null
  auditor_id?: number | null
  bookkeeper_id?: number | null
  creator_name?: string | null
  auditor_name?: string | null
  bookkeeper_name?: string | null
}

export interface VoucherEntryFromApi {
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

export interface SignatureRow {
  summary: string
  subjectCode: string
  debit: string
  credit: string
  cashFlowItemId: number | null
  isCashFlow: boolean
}

export interface PeriodStatusSummary {
  period: string
  is_closed: number
  closed_at: string | null
  pending_audit_vouchers: Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: 0 | 1 | 2
    voucher_label: string
  }>
  pending_bookkeep_vouchers: Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: 0 | 1 | 2
    voucher_label: string
  }>
}

export const createEmptyRow = (): VoucherRow => ({
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

export const DEFAULT_ROWS = 4

export const AMOUNT_PATTERN = /^\d+(\.\d{0,2})?$/

export const getSubjectCategoryOrder = (standardType?: 'enterprise' | 'npo'): string[] =>
  standardType === 'npo'
    ? ['asset', 'liability', 'net_assets', 'income', 'expense']
    : ['asset', 'liability', 'common', 'equity', 'cost', 'profit_loss']

export const getSubjectIndentWidth = (level: number): string => `${Math.max(0, level - 1) * 2}ch`

export const renderSubjectIndent = (level: number): JSX.Element | null => {
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

export const getSubjectCategoryLabel = (
  category: string,
  standardType?: 'enterprise' | 'npo'
): string => {
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

export const getSubjectCategoryNodeCode = (category: string): string => `__category__${category}`

export const buildSubjectHierarchy = (subjects: VoucherSubject[]): SubjectHierarchy => {
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

export const buildSubjectTreeRows = (
  subjects: VoucherSubject[],
  hierarchy: SubjectHierarchy,
  standardType?: 'enterprise' | 'npo'
): SubjectTreeRow[] => {
  const treeRows: SubjectTreeRow[] = []

  for (const category of getSubjectCategoryOrder(standardType)) {
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

export const findFirstLeafSubject = (
  subjects: VoucherSubject[],
  hasChildrenCodes: Set<string>
): VoucherSubject | undefined => subjects.find((subject) => !hasChildrenCodes.has(subject.code))

export const toAmountText = (cents: number): string => new Decimal(cents).div(100).toFixed(2)

export const normalizeRowsForSignature = (rows: VoucherRow[]): SignatureRow[] =>
  rows.map((row) => ({
    summary: row.summary.trim(),
    subjectCode: row.subjectCode.trim(),
    debit: row.debit.trim(),
    credit: row.credit.trim(),
    cashFlowItemId: row.cashFlowItemId,
    isCashFlow: row.isCashFlow
  }))

export const buildDraftSignature = (voucherDate: string, rows: VoucherRow[]): string =>
  JSON.stringify({
    voucherDate,
    rows: normalizeRowsForSignature(rows)
  })

export const padRows = (rows: VoucherRow[]): VoucherRow[] => {
  if (rows.length >= DEFAULT_ROWS) return rows
  return [...rows, ...Array.from({ length: DEFAULT_ROWS - rows.length }, () => createEmptyRow())]
}

export const hasDraftRowContent = (row: VoucherRow): boolean =>
  row.summary.trim() !== '' ||
  row.subjectCode.trim() !== '' ||
  row.subjectInput.trim() !== '' ||
  row.debit.trim() !== '' ||
  row.credit.trim() !== '' ||
  row.cashFlowItemId !== null

export const toPositiveInt = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

export const buildEditRequestToken = (
  voucherId: number | null,
  requestKey?: number
): string | null => {
  if (voucherId === null) return null
  return `${voucherId}:${requestKey ?? 'default'}`
}

export const PERIOD_PATTERN = /^\d{4}-\d{2}$/

export const CASH_FLOW_DIALOG_GRID_TEMPLATE =
  '72px 72px minmax(170px, 1.2fr) minmax(210px, 1.35fr) minmax(108px, 0.7fr) minmax(420px, 2.75fr)'

export const buildClosedPeriodEditMessage = (period: string): string =>
  `当前会计期间（${period}）已结账，本期凭证不能新增或编辑；未审核、未记账凭证仅可删除，如需继续编辑请先反结账。`

export const getPeriodDateRange = (period: string): { min: string; max: string } | null => {
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

export const isDateWithinRange = (
  value: string,
  range: { min: string; max: string } | null
): boolean => {
  if (!range) return true
  return value >= range.min && value <= range.max
}

export const hasPositiveAmount = (value: string): boolean => {
  const text = value.trim()
  if (text === '') return false
  try {
    return new Decimal(text).greaterThan(0)
  } catch {
    return false
  }
}

export const isOppositeDirection = (left: VoucherRow, right: VoucherRow): boolean => {
  return (
    (hasPositiveAmount(left.debit) && hasPositiveAmount(right.credit)) ||
    (hasPositiveAmount(left.credit) && hasPositiveAmount(right.debit))
  )
}

export const shouldShowPendingCashFlowHint = (
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

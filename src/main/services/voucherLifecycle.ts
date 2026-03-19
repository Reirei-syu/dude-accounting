import type Database from 'better-sqlite3'
import Decimal from 'decimal.js'
import { applyCashFlowMappings } from './cashFlowMapping'

export interface VoucherEntryInput {
  summary: string
  subjectCode: string
  debitAmount: string
  creditAmount: string
  cashFlowItemId: number | null
}

export interface NormalizedVoucherEntry {
  summary: string
  subjectCode: string
  debitCents: number
  creditCents: number
  cashFlowItemId: number | null
}

export interface VoucherSubjectMeta {
  code: string
  is_cash_flow: number
  has_children: number
}

export interface VoucherCashFlowRule {
  subjectCode: string
  counterpartSubjectCode: string
  entryDirection: 'inflow' | 'outflow'
  cashFlowItemId: number
}

export interface CreateVoucherLifecycleInput {
  ledgerId: number
  period: string
  voucherDate: string
  voucherWord?: string
  isCarryForward?: boolean
  entries: VoucherEntryInput[]
  creatorId: number
  allowSameMakerAuditor: boolean
}

export interface UpdateVoucherLifecycleInput {
  voucherId: number
  ledgerId: number
  period: string
  voucherDate: string
  entries: VoucherEntryInput[]
}

export interface CreateVoucherLifecycleResult {
  voucherId: number
  voucherNumber: number
  status: number
}

const DECIMAL_PATTERN = /^\d+(\.\d{0,2})?$/

export function isVoucherNumberConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('UNIQUE constraint failed') && error.message.includes('vouchers')
}

export function parseAmountToCents(raw: string, field: string): number {
  const value = raw.trim()
  if (value === '') return 0

  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`${field}格式不正确，仅支持最多两位小数`)
  }

  const amount = new Decimal(value)
  if (amount.isNegative()) {
    throw new Error(`${field}不能为负数`)
  }

  return amount.mul(100).toNumber()
}

export function normalizeVoucherEntries(entries: VoucherEntryInput[]): NormalizedVoucherEntry[] {
  const normalized: NormalizedVoucherEntry[] = []

  for (const entry of entries) {
    const summary = entry.summary.trim()
    const subjectCode = entry.subjectCode.trim()
    const debitCents = parseAmountToCents(entry.debitAmount, '借方金额')
    const creditCents = parseAmountToCents(entry.creditAmount, '贷方金额')

    if (debitCents === 0 && creditCents === 0) {
      continue
    }

    normalized.push({
      summary,
      subjectCode,
      debitCents,
      creditCents,
      cashFlowItemId: entry.cashFlowItemId
    })
  }

  return normalized
}

export function listVoucherCashFlowRules(
  db: Database.Database,
  ledgerId: number
): VoucherCashFlowRule[] {
  return (
    db
      .prepare(
        `SELECT
           subject_code,
           counterpart_subject_code,
           entry_direction,
           cash_flow_item_id
         FROM cash_flow_mappings
         WHERE ledger_id = ?
           AND counterpart_subject_code <> ''`
      )
      .all(ledgerId) as Array<{
      subject_code: string
      counterpart_subject_code: string
      entry_direction: 'inflow' | 'outflow'
      cash_flow_item_id: number
    }>
  ).map((rule) => ({
    subjectCode: rule.subject_code,
    counterpartSubjectCode: rule.counterpart_subject_code,
    entryDirection: rule.entry_direction,
    cashFlowItemId: rule.cash_flow_item_id
  }))
}

export function resolveVoucherCashFlowEntries(
  entries: NormalizedVoucherEntry[],
  subjectByCode: Map<string, Pick<VoucherSubjectMeta, 'is_cash_flow'>>,
  rules: VoucherCashFlowRule[]
): { entries: NormalizedVoucherEntry[]; error?: string } {
  const autoMatched = applyCashFlowMappings(
    entries.map((entry) => ({
      subjectCode: entry.subjectCode,
      debitCents: entry.debitCents,
      creditCents: entry.creditCents,
      cashFlowItemId: entry.cashFlowItemId,
      isCashFlow: (subjectByCode.get(entry.subjectCode)?.is_cash_flow ?? 0) === 1
    })),
    rules
  )

  if (autoMatched.errors.length > 0) {
    return { entries, error: autoMatched.errors[0] }
  }

  const resolvedEntries = entries.map((entry, index) => ({
    ...entry,
    cashFlowItemId: autoMatched.entries[index].cashFlowItemId
  }))

  for (const [index, entry] of resolvedEntries.entries()) {
    const subject = subjectByCode.get(entry.subjectCode)
    if (!subject) {
      return {
        entries: resolvedEntries,
        error: `第${index + 1}行科目不存在：${entry.subjectCode}`
      }
    }
    if (subject.is_cash_flow !== 1 && entry.cashFlowItemId !== null) {
      return {
        entries: resolvedEntries,
        error: `第${index + 1}行非现金流科目，不应指定现金流量项目`
      }
    }
  }

  return { entries: resolvedEntries }
}

function loadSubjectMeta(
  db: Database.Database,
  ledgerId: number,
  subjectCode: string
): VoucherSubjectMeta | undefined {
  return db
    .prepare(
      `SELECT
         s.code,
         s.is_cash_flow,
         EXISTS (
           SELECT 1
             FROM subjects child
            WHERE child.ledger_id = s.ledger_id
              AND child.code <> s.code
              AND (child.parent_code = s.code OR child.code LIKE s.code || '%')
         ) AS has_children
       FROM subjects s
       WHERE s.ledger_id = ? AND s.code = ?`
    )
    .get(ledgerId, subjectCode) as VoucherSubjectMeta | undefined
}

function ensureCashFlowItemExists(
  db: Database.Database,
  ledgerId: number,
  cashFlowItemId: number
): boolean {
  const row = db
    .prepare('SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?')
    .get(ledgerId, cashFlowItemId) as { id: number } | undefined

  return Boolean(row)
}

export function prepareVoucherEntries(
  db: Database.Database,
  ledgerId: number,
  entries: VoucherEntryInput[]
): NormalizedVoucherEntry[] {
  let normalizedEntries = normalizeVoucherEntries(entries)
  if (normalizedEntries.length < 2) {
    throw new Error('至少需要两条有效分录')
  }

  let totalDebit = 0
  let totalCredit = 0
  const subjectByCode = new Map<string, VoucherSubjectMeta>()

  for (const [index, entry] of normalizedEntries.entries()) {
    if (!entry.subjectCode) {
      throw new Error(`第${index + 1}行缺少会计科目`)
    }

    if (entry.debitCents > 0 && entry.creditCents > 0) {
      throw new Error(`第${index + 1}行借贷不能同时有值`)
    }

    if (entry.debitCents === 0 && entry.creditCents === 0) {
      throw new Error(`第${index + 1}行借贷金额不能同时为空`)
    }

    let subject = subjectByCode.get(entry.subjectCode)
    if (!subject) {
      subject = loadSubjectMeta(db, ledgerId, entry.subjectCode)
      if (!subject) {
        throw new Error(`第${index + 1}行科目不存在：${entry.subjectCode}`)
      }
      subjectByCode.set(entry.subjectCode, subject)
    }

    if (subject.has_children === 1) {
      throw new Error(`第${index + 1}行必须使用末级科目：${entry.subjectCode}`)
    }

    totalDebit += entry.debitCents
    totalCredit += entry.creditCents
  }

  if (totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
    throw new Error('借贷不平衡，无法保存')
  }

  const resolvedCashFlow = resolveVoucherCashFlowEntries(
    normalizedEntries,
    subjectByCode,
    listVoucherCashFlowRules(db, ledgerId)
  )
  if (resolvedCashFlow.error) {
    throw new Error(resolvedCashFlow.error)
  }
  normalizedEntries = resolvedCashFlow.entries

  for (const [index, entry] of normalizedEntries.entries()) {
    if (
      entry.cashFlowItemId !== null &&
      !ensureCashFlowItemExists(db, ledgerId, entry.cashFlowItemId)
    ) {
      throw new Error(`第${index + 1}行现金流量项目无效`)
    }
  }

  return normalizedEntries
}

export function createVoucherWithEntries(
  db: Database.Database,
  input: CreateVoucherLifecycleInput
): CreateVoucherLifecycleResult {
  const entries = prepareVoucherEntries(db, input.ledgerId, input.entries)

  const createVoucherTx = db.transaction(() => {
    const maxNumberRow = db
      .prepare(
        'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
      )
      .get(input.ledgerId, input.period) as { max_num: number }
    const nextNumber = maxNumberRow.max_num + 1

    const voucherWord = (input.voucherWord || '记').trim() || '记'
    const isCarryForward = input.isCarryForward === true
    const shouldAutoBookkeep = isCarryForward && input.allowSameMakerAuditor
    const status = shouldAutoBookkeep ? 2 : 0
    const auditorId = shouldAutoBookkeep ? input.creatorId : null
    const bookkeeperId = shouldAutoBookkeep ? input.creatorId : null

    const voucherResult = db
      .prepare(
        `INSERT INTO vouchers (
           ledger_id, period, voucher_date, voucher_number, voucher_word, status,
           creator_id, auditor_id, bookkeeper_id, is_carry_forward, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        input.ledgerId,
        input.period,
        input.voucherDate,
        nextNumber,
        voucherWord,
        status,
        input.creatorId,
        auditorId,
        bookkeeperId,
        isCarryForward ? 1 : 0
      )

    const voucherId = voucherResult.lastInsertRowid as number
    const insertEntryStmt = db.prepare(
      `INSERT INTO voucher_entries (
         voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (const [index, entry] of entries.entries()) {
      insertEntryStmt.run(
        voucherId,
        index + 1,
        entry.summary,
        entry.subjectCode,
        entry.debitCents,
        entry.creditCents,
        entry.cashFlowItemId
      )
    }

    return { voucherId, voucherNumber: nextNumber, status }
  })

  let result: CreateVoucherLifecycleResult | null = null
  const retryLimit = 5
  for (let attempt = 0; attempt < retryLimit; attempt += 1) {
    try {
      result = createVoucherTx()
      break
    } catch (error) {
      if (!isVoucherNumberConflictError(error)) {
        throw error
      }
    }
  }

  if (!result) {
    throw new Error('凭证编号冲突，请重试')
  }

  return result
}

export function updateVoucherWithEntries(
  db: Database.Database,
  input: UpdateVoucherLifecycleInput
): void {
  const entries = prepareVoucherEntries(db, input.ledgerId, input.entries)

  const updateVoucherTx = db.transaction(() => {
    db.prepare(
      `UPDATE vouchers
       SET period = ?, voucher_date = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(input.period, input.voucherDate, input.voucherId)

    db.prepare('DELETE FROM voucher_entries WHERE voucher_id = ?').run(input.voucherId)

    const insertEntryStmt = db.prepare(
      `INSERT INTO voucher_entries (
         voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (const [index, entry] of entries.entries()) {
      insertEntryStmt.run(
        input.voucherId,
        index + 1,
        entry.summary,
        entry.subjectCode,
        entry.debitCents,
        entry.creditCents,
        entry.cashFlowItemId
      )
    }
  })

  updateVoucherTx()
}

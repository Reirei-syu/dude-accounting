import type Database from 'better-sqlite3'

type CashFlowDirection = 'inflow' | 'outflow'

export type CashFlowMappingRow = {
  id: number
  ledger_id: number
  subject_code: string
  subject_name: string | null
  counterpart_subject_code: string
  counterpart_subject_name: string | null
  entry_direction: CashFlowDirection
  cash_flow_item_id: number
  cash_flow_item_code: string | null
  cash_flow_item_name: string | null
}

export type CashFlowAutoEntry = {
  subjectCode: string
  debitCents: number
  creditCents: number
  cashFlowItemId: number | null
  isCashFlow: boolean
}

export type CashFlowAutoRule = {
  subjectCode: string
  counterpartSubjectCode: string
  entryDirection: CashFlowDirection
  cashFlowItemId: number
}

export type CashFlowAutoApplyResult = {
  entries: CashFlowAutoEntry[]
  errors: string[]
}

function requireLedger(db: Database.Database, ledgerId: number): void {
  const row = db.prepare(`SELECT id FROM ledgers WHERE id = ?`).get(ledgerId) as
    | { id: number }
    | undefined
  if (!row) {
    throw new Error('账套不存在')
  }
}

function assertDirection(direction: string): asserts direction is CashFlowDirection {
  if (direction !== 'inflow' && direction !== 'outflow') {
    throw new Error('现金流方向不合法')
  }
}

function requireSubject(
  db: Database.Database,
  ledgerId: number,
  subjectCode: string
): { code: string; is_cash_flow: number } {
  const subject = db
    .prepare(`SELECT code, is_cash_flow FROM subjects WHERE ledger_id = ? AND code = ?`)
    .get(ledgerId, subjectCode) as
    | {
        code: string
        is_cash_flow: number
      }
    | undefined
  if (!subject) {
    throw new Error(`科目不存在：${subjectCode}`)
  }
  return subject
}

function requireCashFlowItem(
  db: Database.Database,
  ledgerId: number,
  cashFlowItemId: number
): { id: number } {
  const item = db
    .prepare(`SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?`)
    .get(ledgerId, cashFlowItemId) as { id: number } | undefined
  if (!item) {
    throw new Error('现金流量项目无效')
  }
  return item
}

export function listCashFlowMappings(
  db: Database.Database,
  ledgerId: number
): CashFlowMappingRow[] {
  requireLedger(db, ledgerId)
  return db
    .prepare(
      `SELECT
         m.id,
         m.ledger_id,
         m.subject_code,
         s.name AS subject_name,
         m.counterpart_subject_code,
         cp.name AS counterpart_subject_name,
         m.entry_direction,
         m.cash_flow_item_id,
         cfi.code AS cash_flow_item_code,
         cfi.name AS cash_flow_item_name
       FROM cash_flow_mappings m
       LEFT JOIN subjects s
         ON s.ledger_id = m.ledger_id AND s.code = m.subject_code
       LEFT JOIN subjects cp
         ON cp.ledger_id = m.ledger_id AND cp.code = m.counterpart_subject_code
       LEFT JOIN cash_flow_items cfi
         ON cfi.id = m.cash_flow_item_id
       WHERE m.ledger_id = ?
         AND m.counterpart_subject_code <> ''
       ORDER BY m.subject_code, m.counterpart_subject_code, m.entry_direction`
    )
    .all(ledgerId) as CashFlowMappingRow[]
}

export function createCashFlowMapping(
  db: Database.Database,
  data: {
    ledgerId: number
    subjectCode: string
    counterpartSubjectCode: string
    entryDirection: string
    cashFlowItemId: number
  }
): number {
  requireLedger(db, data.ledgerId)
  const subjectCode = data.subjectCode.trim()
  const counterpartSubjectCode = data.counterpartSubjectCode.trim()
  assertDirection(data.entryDirection)

  if (!subjectCode) {
    throw new Error('现金流科目不能为空')
  }
  if (!counterpartSubjectCode) {
    throw new Error('对方科目不能为空')
  }

  const subject = requireSubject(db, data.ledgerId, subjectCode)
  if (subject.is_cash_flow !== 1) {
    throw new Error('现金流科目必须是已启用现金流标记的科目')
  }

  requireSubject(db, data.ledgerId, counterpartSubjectCode)
  requireCashFlowItem(db, data.ledgerId, data.cashFlowItemId)

  const result = db
    .prepare(
      `INSERT INTO cash_flow_mappings (
         ledger_id,
         subject_code,
         counterpart_subject_code,
         entry_direction,
         cash_flow_item_id
       ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      data.ledgerId,
      subjectCode,
      counterpartSubjectCode,
      data.entryDirection,
      data.cashFlowItemId
    )

  return Number(result.lastInsertRowid)
}

export function updateCashFlowMapping(
  db: Database.Database,
  data: {
    id: number
    subjectCode: string
    counterpartSubjectCode: string
    entryDirection: string
    cashFlowItemId: number
  }
): void {
  const existing = db.prepare(`SELECT id, ledger_id FROM cash_flow_mappings WHERE id = ?`).get(data.id) as
    | { id: number; ledger_id: number }
    | undefined
  if (!existing) {
    throw new Error('现金流匹配规则不存在')
  }

  const subjectCode = data.subjectCode.trim()
  const counterpartSubjectCode = data.counterpartSubjectCode.trim()
  assertDirection(data.entryDirection)

  if (!subjectCode) {
    throw new Error('现金流科目不能为空')
  }
  if (!counterpartSubjectCode) {
    throw new Error('对方科目不能为空')
  }

  const subject = requireSubject(db, existing.ledger_id, subjectCode)
  if (subject.is_cash_flow !== 1) {
    throw new Error('现金流科目必须是已启用现金流标记的科目')
  }
  requireSubject(db, existing.ledger_id, counterpartSubjectCode)
  requireCashFlowItem(db, existing.ledger_id, data.cashFlowItemId)

  db.prepare(
    `UPDATE cash_flow_mappings
     SET subject_code = ?, counterpart_subject_code = ?, entry_direction = ?, cash_flow_item_id = ?
     WHERE id = ?`
  ).run(subjectCode, counterpartSubjectCode, data.entryDirection, data.cashFlowItemId, data.id)
}

export function deleteCashFlowMapping(db: Database.Database, id: number): void {
  db.prepare(`DELETE FROM cash_flow_mappings WHERE id = ?`).run(id)
}

function getEntryDirection(entry: Pick<CashFlowAutoEntry, 'debitCents' | 'creditCents'>): CashFlowDirection {
  return entry.debitCents > 0 ? 'inflow' : 'outflow'
}

function isOppositeSide(
  source: Pick<CashFlowAutoEntry, 'debitCents' | 'creditCents'>,
  target: Pick<CashFlowAutoEntry, 'debitCents' | 'creditCents'>
): boolean {
  return (
    (source.debitCents > 0 && target.creditCents > 0) ||
    (source.creditCents > 0 && target.debitCents > 0)
  )
}

function getRuleKey(
  subjectCode: string,
  counterpartSubjectCode: string,
  entryDirection: CashFlowDirection
): string {
  return `${subjectCode}|${counterpartSubjectCode}|${entryDirection}`
}

export function applyCashFlowMappings(
  entries: CashFlowAutoEntry[],
  rules: CashFlowAutoRule[]
): CashFlowAutoApplyResult {
  const errors: string[] = []
  const nextEntries = entries.map((entry) => ({ ...entry }))
  const ruleMap = new Map<string, number>()
  for (const rule of rules) {
    ruleMap.set(
      getRuleKey(rule.subjectCode, rule.counterpartSubjectCode, rule.entryDirection),
      rule.cashFlowItemId
    )
  }

  for (const [index, entry] of nextEntries.entries()) {
    if (!entry.isCashFlow) {
      continue
    }

    const direction = getEntryDirection(entry)
    const counterparts = nextEntries.filter((candidate, candidateIndex) => {
      return candidateIndex !== index && isOppositeSide(entry, candidate)
    })

    if (counterparts.length === 0) {
      errors.push(`第${index + 1}行缺少对方科目，无法匹配现金流量项目`)
      continue
    }

    const isInternalTransfer = counterparts.every((counterpart) => counterpart.isCashFlow)
    if (isInternalTransfer) {
      if (entry.cashFlowItemId !== null) {
        errors.push(`第${index + 1}行为内部现金互转，不应指定现金流量项目`)
      }
      entry.cashFlowItemId = null
      continue
    }

    if (entry.cashFlowItemId !== null) {
      continue
    }

    const counterpartCodes = Array.from(
      new Set(
        counterparts
          .filter((counterpart) => !counterpart.isCashFlow)
          .map((counterpart) => counterpart.subjectCode)
      )
    )

    const matchedItemIds = new Set<number>()
    let hasMissingRule = false
    for (const counterpartCode of counterpartCodes) {
      const key = getRuleKey(entry.subjectCode, counterpartCode, direction)
      const cashFlowItemId = ruleMap.get(key)
      if (!cashFlowItemId) {
        hasMissingRule = true
        break
      }
      matchedItemIds.add(cashFlowItemId)
    }

    if (hasMissingRule) {
      errors.push(`第${index + 1}行未命中现金流量匹配规则，请手工指定`)
      continue
    }
    if (matchedItemIds.size !== 1) {
      errors.push(`第${index + 1}行命中多个现金流量项目，请手工指定`)
      continue
    }

    entry.cashFlowItemId = Array.from(matchedItemIds)[0]
  }

  return { entries: nextEntries, errors }
}


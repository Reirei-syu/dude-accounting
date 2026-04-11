import Database from 'better-sqlite3'

import {
  isCarryForwardSourceCategory,
  isCarryForwardTargetCategory
} from '../database/subjectCategoryRules'

export interface PLCarryForwardRuleView {
  id: number
  fromSubjectCode: string
  fromSubjectName: string
  toSubjectCode: string
  toSubjectName: string
}

export interface PLCarryForwardEntryView {
  summary: string
  subjectCode: string
  subjectName: string
  debitAmount: number
  creditAmount: number
}

export interface ExistingCarryForwardVoucher {
  id: number
  voucherNumber: number
  voucherDate: string
  status: number
}

export interface PLCarryForwardPreview {
  period: string
  voucherDate: string
  summary: string
  voucherWord: string
  includeUnpostedVouchers: boolean
  required: boolean
  canExecute: boolean
  blockedReason?: string
  totalDebit: number
  totalCredit: number
  entries: PLCarryForwardEntryView[]
  existingVouchers: ExistingCarryForwardVoucher[]
  draftVoucherIds: number[]
}

export interface ExecutePLCarryForwardResult {
  voucherId: number
  voucherNumber: number
  status: number
  voucherDate: string
  removedDraftVoucherIds: number[]
}

export interface SavePLCarryForwardRuleItem {
  fromSubjectCode: string
  toSubjectCode: string
}

export interface SavePLCarryForwardRulesParams {
  ledgerId: number
  rules: SavePLCarryForwardRuleItem[]
}

export interface PreviewPLCarryForwardParams {
  ledgerId: number
  period: string
  includeUnpostedVouchers?: boolean
}

export interface ExecutePLCarryForwardParams extends PreviewPLCarryForwardParams {
  operatorId: number
}

type RuleMovementRow = {
  rule_id: number
  from_subject_code: string
  from_subject_name: string
  to_subject_code: string
  to_subject_name: string
  debit_sum: number | null
  credit_sum: number | null
}

type ExistingVoucherRow = {
  id: number
  voucher_number: number
  voucher_date: string
  status: number
}

type LedgerRow = {
  id: number
  standard_type: 'enterprise' | 'npo'
}

type SubjectWithChildrenRow = {
  code: string
  name: string
  category: string
  has_children: number
}

type StoredCarryForwardRuleRow = {
  id: number
  from_subject_code: string
  to_subject_code: string
}

function assertPeriodFormat(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

function assertLedgerExists(db: Database.Database, ledgerId: number): void {
  const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ?').get(ledgerId)
  if (!ledger) {
    throw new Error('账套不存在')
  }
}

function getLedgerRow(db: Database.Database, ledgerId: number): LedgerRow {
  const ledger = db
    .prepare('SELECT id, standard_type FROM ledgers WHERE id = ?')
    .get(ledgerId) as LedgerRow | undefined

  if (!ledger) {
    throw new Error('账套不存在')
  }

  return ledger
}

function listLedgerSubjectsWithChildren(
  db: Database.Database,
  ledgerId: number
): SubjectWithChildrenRow[] {
  return db
    .prepare(
      `SELECT
         s.code,
         s.name,
         s.category,
         EXISTS (
           SELECT 1
             FROM subjects child
            WHERE child.ledger_id = s.ledger_id
              AND child.code <> s.code
              AND (child.parent_code = s.code OR child.code LIKE s.code || '%')
         ) AS has_children
       FROM subjects s
       WHERE s.ledger_id = ?
       ORDER BY s.code ASC`
    )
    .all(ledgerId) as SubjectWithChildrenRow[]
}

function listStoredCarryForwardRules(
  db: Database.Database,
  ledgerId: number
): StoredCarryForwardRuleRow[] {
  return db
    .prepare(
      `SELECT id, from_subject_code, to_subject_code
       FROM pl_carry_forward_rules
       WHERE ledger_id = ?
       ORDER BY from_subject_code ASC, id ASC`
    )
    .all(ledgerId) as StoredCarryForwardRuleRow[]
}

function getLeafSourceSubjects(
  subjects: SubjectWithChildrenRow[],
  standardType: 'enterprise' | 'npo'
): SubjectWithChildrenRow[] {
  return subjects.filter(
    (subject) =>
      isCarryForwardSourceCategory(standardType, subject.category) && subject.has_children === 0
  )
}

function getLeafTargetSubjects(
  subjects: SubjectWithChildrenRow[],
  standardType: 'enterprise' | 'npo'
): SubjectWithChildrenRow[] {
  const targetPrefixes = getAllowedTargetPrefixes(standardType)

  return subjects.filter(
    (subject) =>
      isCarryForwardTargetCategory(standardType, subject.category) &&
      subject.has_children === 0 &&
      isSubjectWithinPrefixes(subject.code, targetPrefixes)
  )
}

function resolveEffectiveCarryForwardTargetCode(
  targetCode: string,
  standardType: 'enterprise' | 'npo',
  subjectByCode: Map<string, SubjectWithChildrenRow>,
  leafTargets: SubjectWithChildrenRow[]
): string | null {
  if (leafTargets.some((subject) => subject.code === targetCode)) {
    return targetCode
  }

  const targetSubject = subjectByCode.get(targetCode)
  if (!targetSubject) {
    return null
  }

  if (!isCarryForwardTargetCategory(standardType, targetSubject.category)) {
    return null
  }

  if (!isSubjectWithinPrefixes(targetCode, getAllowedTargetPrefixes(standardType))) {
    return null
  }

  const descendantLeafTargets = leafTargets.filter(
    (subject) => subject.code !== targetCode && subject.code.startsWith(targetCode)
  )

  return descendantLeafTargets.length === 1 ? descendantLeafTargets[0].code : null
}

function normalizeStoredCarryForwardRules(
  db: Database.Database,
  ledgerId: number,
  ledger?: LedgerRow,
  subjects?: SubjectWithChildrenRow[]
): {
  ledger: LedgerRow
  subjects: SubjectWithChildrenRow[]
  rules: StoredCarryForwardRuleRow[]
} {
  const currentLedger = ledger ?? getLedgerRow(db, ledgerId)
  const currentSubjects = subjects ?? listLedgerSubjectsWithChildren(db, ledgerId)
  const subjectByCode = new Map(currentSubjects.map((subject) => [subject.code, subject]))
  const leafSourceByCode = new Map(
    getLeafSourceSubjects(currentSubjects, currentLedger.standard_type).map((subject) => [
      subject.code,
      subject
    ])
  )
  const leafTargets = getLeafTargetSubjects(currentSubjects, currentLedger.standard_type)
  const storedRules = listStoredCarryForwardRules(db, ledgerId)
  const effectiveRulesBySource = new Map<string, StoredCarryForwardRuleRow>()
  const conflictingTargetsBySource = new Map<string, Set<string>>()

  for (const rule of storedRules) {
    if (!leafSourceByCode.has(rule.from_subject_code)) {
      continue
    }

    const effectiveTargetCode =
      resolveEffectiveCarryForwardTargetCode(
        rule.to_subject_code,
        currentLedger.standard_type,
        subjectByCode,
        leafTargets
      ) ?? rule.to_subject_code
    const normalizedRule =
      effectiveTargetCode === rule.to_subject_code
        ? rule
        : {
            ...rule,
            to_subject_code: effectiveTargetCode
          }

    const existingRule = effectiveRulesBySource.get(rule.from_subject_code)
    if (!existingRule) {
      effectiveRulesBySource.set(rule.from_subject_code, normalizedRule)
      continue
    }

    if (existingRule.to_subject_code === normalizedRule.to_subject_code) {
      continue
    }

    const targetSet = conflictingTargetsBySource.get(rule.from_subject_code) ?? new Set<string>()
    targetSet.add(existingRule.to_subject_code)
    targetSet.add(normalizedRule.to_subject_code)
    conflictingTargetsBySource.set(rule.from_subject_code, targetSet)
  }

  if (conflictingTargetsBySource.size > 0) {
    const firstConflict = [...conflictingTargetsBySource.entries()].sort((left, right) =>
      left[0].localeCompare(right[0])
    )[0]
    const [sourceCode, targetCodes] = firstConflict
    const sourceText = formatSubjectList([sourceCode], subjectByCode)
    const targetText = formatSubjectList(
      [...targetCodes].sort((left, right) => left.localeCompare(right)),
      subjectByCode
    )
    throw new Error(`末级结转来源科目 ${sourceText} 同时配置了多个结转目标：${targetText}`)
  }

  return {
    ledger: currentLedger,
    subjects: currentSubjects,
    rules: [...effectiveRulesBySource.values()].sort((left, right) =>
      left.from_subject_code.localeCompare(right.from_subject_code)
    )
  }
}

function findClosestAncestorCode(
  subjectCode: string,
  subjectByCode: Map<string, SubjectWithChildrenRow>
): string | null {
  let closestAncestorCode: string | null = null

  for (const candidateCode of subjectByCode.keys()) {
    if (candidateCode === subjectCode || !subjectCode.startsWith(candidateCode)) {
      continue
    }

    if (!closestAncestorCode || candidateCode.length > closestAncestorCode.length) {
      closestAncestorCode = candidateCode
    }
  }

  return closestAncestorCode
}

function resolveInheritedTargetFromRules(
  parentCode: string,
  rules: StoredCarryForwardRuleRow[]
): string | null {
  const directRule = rules.find((rule) => rule.from_subject_code === parentCode)
  if (directRule) {
    return directRule.to_subject_code
  }

  const descendantTargets = Array.from(
    new Set(
      rules
        .filter(
          (rule) =>
            rule.from_subject_code !== parentCode && rule.from_subject_code.startsWith(parentCode)
        )
        .map((rule) => rule.to_subject_code)
    )
  )

  return descendantTargets.length === 1 ? descendantTargets[0] : null
}

function autoAttachInheritedCarryForwardRules(db: Database.Database, ledgerId: number): void {
  const ledger = getLedgerRow(db, ledgerId)
  const subjects = listLedgerSubjectsWithChildren(db, ledgerId)
  const sourceSubjects = getLeafSourceSubjects(subjects, ledger.standard_type)
  const rules = listStoredCarryForwardRules(db, ledgerId)
  const existingSourceCodes = new Set(rules.map((rule) => rule.from_subject_code))
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))

  const insert = db.prepare(
    `INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code)
     VALUES (?, ?, ?)`
  )

  const fill = db.transaction(() => {
    for (const subject of sourceSubjects) {
      if (existingSourceCodes.has(subject.code)) {
        continue
      }

      const parentCode = findClosestAncestorCode(subject.code, subjectByCode)
      if (!parentCode) {
        continue
      }

      const parent = subjectByCode.get(parentCode)
      if (!parent || !isCarryForwardSourceCategory(ledger.standard_type, parent.category)) {
        continue
      }

      const inferredTargetCode = resolveInheritedTargetFromRules(parent.code, rules)
      if (!inferredTargetCode) {
        continue
      }

      const insertResult = insert.run(ledgerId, subject.code, inferredTargetCode)
      rules.push({
        id: Number(insertResult.lastInsertRowid ?? 0),
        from_subject_code: subject.code,
        to_subject_code: inferredTargetCode
      })
      existingSourceCodes.add(subject.code)
    }
  })

  fill()
}

function getAllowedTargetPrefixes(standardType: 'enterprise' | 'npo'): string[] {
  return standardType === 'npo' ? ['3101', '3102'] : ['4103']
}

function isSubjectWithinPrefixes(subjectCode: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => subjectCode === prefix || subjectCode.startsWith(prefix))
}

function formatSubjectList(
  subjectCodes: string[],
  subjectByCode: Map<string, Pick<SubjectWithChildrenRow, 'code' | 'name'>>
): string {
  return subjectCodes
    .map((subjectCode) => {
      const subject = subjectByCode.get(subjectCode)
      return subject ? `${subject.code} ${subject.name}` : subjectCode
    })
    .join('、')
}

function normalizeSaveRules(
  rules: SavePLCarryForwardRuleItem[]
): SavePLCarryForwardRuleItem[] {
  const normalizedRules = rules.map((rule) => ({
    fromSubjectCode: rule.fromSubjectCode.trim(),
    toSubjectCode: rule.toSubjectCode.trim()
  }))

  const blankSourceRule = normalizedRules.find((rule) => !rule.fromSubjectCode)
  if (blankSourceRule) {
    throw new Error('存在未选择的损益科目，无法保存')
  }

  const blankTargetRule = normalizedRules.find((rule) => !rule.toSubjectCode)
  if (blankTargetRule) {
    throw new Error(`请先为科目 ${blankTargetRule.fromSubjectCode} 选择结转目标`)
  }

  const duplicatedSourceCode = normalizedRules.find(
    (rule, index) =>
      normalizedRules.findIndex((candidate) => candidate.fromSubjectCode === rule.fromSubjectCode) !==
      index
  )?.fromSubjectCode

  if (duplicatedSourceCode) {
    throw new Error(`损益科目 ${duplicatedSourceCode} 重复配置了结转目标`)
  }

  return normalizedRules
}

function assertCarryForwardRulesConfigured(
  db: Database.Database,
  ledgerId: number,
  rules: SavePLCarryForwardRuleItem[],
  context?: {
    ledger: LedgerRow
    subjects: SubjectWithChildrenRow[]
  }
): void {
  const ledger = context?.ledger ?? getLedgerRow(db, ledgerId)
  const subjects = context?.subjects ?? listLedgerSubjectsWithChildren(db, ledgerId)
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))
  const sourceSubjects = getLeafSourceSubjects(subjects, ledger.standard_type)
  const targetSubjects = getLeafTargetSubjects(subjects, ledger.standard_type)
  const sourceByCode = new Map(sourceSubjects.map((subject) => [subject.code, subject]))
  const targetByCode = new Map(targetSubjects.map((subject) => [subject.code, subject]))
  const normalizedRules = normalizeSaveRules(rules)

  const missingSourceCodes = sourceSubjects
    .filter((subject) => !normalizedRules.some((rule) => rule.fromSubjectCode === subject.code))
    .map((subject) => subject.code)
  if (missingSourceCodes.length > 0) {
    throw new Error(
      `以下损益科目尚未配置结转目标：${formatSubjectList(missingSourceCodes, subjectByCode)}`
    )
  }

  const invalidSourceCodes = normalizedRules
    .map((rule) => rule.fromSubjectCode)
    .filter((code) => !sourceByCode.has(code))
  if (invalidSourceCodes.length > 0) {
    throw new Error(
      `以下结转来源科目无效或不是末级损益科目：${formatSubjectList(invalidSourceCodes, subjectByCode)}`
    )
  }

  const invalidTargetRules = normalizedRules.filter((rule) => !targetByCode.has(rule.toSubjectCode))
  if (invalidTargetRules.length > 0) {
    const invalidTargetText = invalidTargetRules
      .map((rule) => `${rule.fromSubjectCode} -> ${rule.toSubjectCode}`)
      .join('、')
    throw new Error(`以下结转目标科目无效或不是允许的末级科目：${invalidTargetText}`)
  }
}

function getPeriodLastDay(period: string): string {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const lastDay = new Date(year, month, 0).getDate()
  return `${period}-${String(lastDay).padStart(2, '0')}`
}

function getExistingCarryForwardVouchers(
  db: Database.Database,
  ledgerId: number,
  period: string
): ExistingCarryForwardVoucher[] {
  return db
    .prepare(
      `SELECT id, voucher_number, voucher_date, status
       FROM vouchers
       WHERE ledger_id = ?
         AND period = ?
         AND is_carry_forward = 1
       ORDER BY id ASC`
    )
    .all(ledgerId, period)
    .map((row) => {
      const typedRow = row as ExistingVoucherRow
      return {
        id: typedRow.id,
        voucherNumber: typedRow.voucher_number,
        voucherDate: typedRow.voucher_date,
        status: typedRow.status
      }
    })
}

function getStatusLabel(status: number): string {
  if (status === 2) return '已记账'
  if (status === 1) return '已审核'
  return '未审核'
}

function getRuleMovements(
  db: Database.Database,
  ledgerId: number,
  period: string,
  includeUnpostedVouchers: boolean,
  rules: StoredCarryForwardRuleRow[],
  subjects: SubjectWithChildrenRow[]
): RuleMovementRow[] {
  const voucherStatusCondition = includeUnpostedVouchers ? '' : 'AND v.status = 2'
  const subjectMovements = db
    .prepare(
      `SELECT
       ve.subject_code AS subject_code,
       s.name AS subject_name,
       COALESCE(SUM(ve.debit_amount), 0) AS debit_sum,
       COALESCE(SUM(ve.credit_amount), 0) AS credit_sum
     FROM vouchers v
     INNER JOIN voucher_entries ve
       ON ve.voucher_id = v.id
     INNER JOIN subjects s
       ON s.ledger_id = v.ledger_id
      AND s.code = ve.subject_code
     WHERE v.ledger_id = ?
       AND v.period = ?
       ${voucherStatusCondition}
       AND v.is_carry_forward = 0
     GROUP BY ve.subject_code, s.name
     ORDER BY ve.subject_code ASC`
    )
    .all(ledgerId, period) as Array<{
    subject_code: string
    subject_name: string
    debit_sum: number | null
    credit_sum: number | null
  }>
  const movementBySubjectCode = new Map(subjectMovements.map((row) => [row.subject_code, row]))
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))

  return rules.map((rule) => {
    const movement = movementBySubjectCode.get(rule.from_subject_code)
    return {
      rule_id: rule.id,
      from_subject_code: rule.from_subject_code,
      from_subject_name: subjectByCode.get(rule.from_subject_code)?.name ?? '',
      to_subject_code: rule.to_subject_code,
      to_subject_name: subjectByCode.get(rule.to_subject_code)?.name ?? '',
      debit_sum: movement?.debit_sum ?? 0,
      credit_sum: movement?.credit_sum ?? 0
    }
  })
}

function buildPreviewEntries(movements: RuleMovementRow[]): PLCarryForwardEntryView[] {
  const entries: PLCarryForwardEntryView[] = []
  const offsetMap = new Map<
    string,
    {
      subjectCode: string
      subjectName: string
      debitAmount: number
      creditAmount: number
    }
  >()

  for (const row of movements) {
    const debitSum = row.debit_sum ?? 0
    const creditSum = row.credit_sum ?? 0
    const net = creditSum - debitSum
    if (net === 0) continue

    if (net > 0) {
      entries.push({
        summary: '期末损益结转',
        subjectCode: row.from_subject_code,
        subjectName: row.from_subject_name,
        debitAmount: net,
        creditAmount: 0
      })
      const offsetKey = `${row.to_subject_code}:credit`
      const current = offsetMap.get(offsetKey) ?? {
        subjectCode: row.to_subject_code,
        subjectName: row.to_subject_name,
        debitAmount: 0,
        creditAmount: 0
      }
      current.creditAmount += net
      offsetMap.set(offsetKey, current)
    } else {
      const amount = Math.abs(net)
      entries.push({
        summary: '期末损益结转',
        subjectCode: row.from_subject_code,
        subjectName: row.from_subject_name,
        debitAmount: 0,
        creditAmount: amount
      })
      const offsetKey = `${row.to_subject_code}:debit`
      const current = offsetMap.get(offsetKey) ?? {
        subjectCode: row.to_subject_code,
        subjectName: row.to_subject_name,
        debitAmount: 0,
        creditAmount: 0
      }
      current.debitAmount += amount
      offsetMap.set(offsetKey, current)
    }
  }

  const groupedBySubject = new Map<
    string,
    {
      subjectName: string
      debitAmount: number
      creditAmount: number
    }
  >()

  for (const offset of offsetMap.values()) {
    const current = groupedBySubject.get(offset.subjectCode) ?? {
      subjectName: offset.subjectName,
      debitAmount: 0,
      creditAmount: 0
    }
    current.debitAmount += offset.debitAmount
    current.creditAmount += offset.creditAmount
    groupedBySubject.set(offset.subjectCode, current)
  }

  const orderedSubjectCodes = [...groupedBySubject.keys()].sort((left, right) =>
    left.localeCompare(right)
  )

  for (const subjectCode of orderedSubjectCodes) {
    const offset = groupedBySubject.get(subjectCode)
    if (!offset) continue

    if (offset.debitAmount > 0) {
      entries.push({
        summary: '期末损益结转',
        subjectCode,
        subjectName: offset.subjectName,
        debitAmount: offset.debitAmount,
        creditAmount: 0
      })
    }
    if (offset.creditAmount > 0) {
      entries.push({
        summary: '期末损益结转',
        subjectCode,
        subjectName: offset.subjectName,
        debitAmount: 0,
        creditAmount: offset.creditAmount
      })
    }
  }

  return entries
}

export function listPLCarryForwardRules(
  db: Database.Database,
  ledgerId: number
): PLCarryForwardRuleView[] {
  assertLedgerExists(db, ledgerId)
  autoAttachInheritedCarryForwardRules(db, ledgerId)
  const { rules, subjects } = normalizeStoredCarryForwardRules(db, ledgerId)
  const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))

  return rules.map((rule) => ({
    id: rule.id,
    fromSubjectCode: rule.from_subject_code,
    fromSubjectName: subjectByCode.get(rule.from_subject_code)?.name ?? '',
    toSubjectCode: rule.to_subject_code,
    toSubjectName: subjectByCode.get(rule.to_subject_code)?.name ?? ''
  }))
}

export function savePLCarryForwardRules(
  db: Database.Database,
  params: SavePLCarryForwardRulesParams
): number {
  const { ledgerId } = params
  assertCarryForwardRulesConfigured(db, ledgerId, params.rules)
  const normalizedRules = normalizeSaveRules(params.rules).sort((left, right) =>
    left.fromSubjectCode.localeCompare(right.fromSubjectCode)
  )

  const run = db.transaction(() => {
    db.prepare('DELETE FROM pl_carry_forward_rules WHERE ledger_id = ?').run(ledgerId)
    const insertRule = db.prepare(
      `INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code)
       VALUES (?, ?, ?)`
    )

    for (const rule of normalizedRules) {
      insertRule.run(ledgerId, rule.fromSubjectCode, rule.toSubjectCode)
    }
  })

  run()
  return normalizedRules.length
}

export function previewPLCarryForward(
  db: Database.Database,
  params: PreviewPLCarryForwardParams
): PLCarryForwardPreview {
  const { ledgerId, period, includeUnpostedVouchers = false } = params
  assertLedgerExists(db, ledgerId)
  assertPeriodFormat(period)
  autoAttachInheritedCarryForwardRules(db, ledgerId)
  const normalizedStoredRules = normalizeStoredCarryForwardRules(db, ledgerId)
  assertCarryForwardRulesConfigured(
    db,
    ledgerId,
    normalizedStoredRules.rules.map((rule) => ({
      fromSubjectCode: rule.from_subject_code,
      toSubjectCode: rule.to_subject_code
    })),
    {
      ledger: normalizedStoredRules.ledger,
      subjects: normalizedStoredRules.subjects
    }
  )

  const movements = getRuleMovements(
    db,
    ledgerId,
    period,
    includeUnpostedVouchers,
    normalizedStoredRules.rules,
    normalizedStoredRules.subjects
  )
  const entries = buildPreviewEntries(movements)
  const existingVouchers = getExistingCarryForwardVouchers(db, ledgerId, period)
  const draftVoucherIds = existingVouchers
    .filter((voucher) => voucher.status === 0)
    .map((voucher) => voucher.id)
  const blockingVoucher = existingVouchers.find(
    (voucher) => voucher.status === 1 || voucher.status === 2
  )
  const totalDebit = entries.reduce((sum, entry) => sum + entry.debitAmount, 0)
  const totalCredit = entries.reduce((sum, entry) => sum + entry.creditAmount, 0)
  const required = entries.length > 0
  const canExecute = required && !blockingVoucher

  return {
    period,
    voucherDate: getPeriodLastDay(period),
    summary: '期末损益结转',
    voucherWord: '结',
    includeUnpostedVouchers,
    required,
    canExecute,
    blockedReason: blockingVoucher
      ? `当前期间已存在${getStatusLabel(blockingVoucher.status)}的损益结转凭证，禁止重跑`
      : undefined,
    totalDebit,
    totalCredit,
    entries,
    existingVouchers,
    draftVoucherIds
  }
}

export function executePLCarryForward(
  db: Database.Database,
  params: ExecutePLCarryForwardParams
): ExecutePLCarryForwardResult {
  const { ledgerId, period, operatorId, includeUnpostedVouchers = false } = params
  const preview = previewPLCarryForward(db, { ledgerId, period, includeUnpostedVouchers })

  if (!preview.required) {
    throw new Error('当前期间无可结转的损益金额')
  }
  if (!preview.canExecute) {
    throw new Error('当前期间已存在已审核或已记账的损益结转凭证，禁止重跑')
  }

  const allowSameMakerAuditor =
    (
      db
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get('allow_same_maker_auditor') as { value: string } | undefined
    )?.value === '1'

  const run = db.transaction(() => {
    if (preview.draftVoucherIds.length > 0) {
      const draftPlaceholders = preview.draftVoucherIds.map(() => '?').join(',')
      db.prepare(`DELETE FROM voucher_entries WHERE voucher_id IN (${draftPlaceholders})`).run(
        ...preview.draftVoucherIds
      )
      db.prepare(`DELETE FROM vouchers WHERE id IN (${draftPlaceholders})`).run(
        ...preview.draftVoucherIds
      )
    }

    const maxNumberRow = db
      .prepare(
        `SELECT COALESCE(MAX(voucher_number), 0) AS max_num
         FROM vouchers
         WHERE ledger_id = ? AND period = ? AND voucher_word = ?`
      )
      .get(ledgerId, period, preview.voucherWord) as { max_num: number }
    const nextNumber = (maxNumberRow?.max_num ?? 0) + 1
    const status = allowSameMakerAuditor ? 2 : 0
    const voucherDate = preview.voucherDate

    const voucherResult = db
      .prepare(
        `INSERT INTO vouchers (
          ledger_id, period, voucher_date, voucher_number, voucher_word, status,
          creator_id, auditor_id, bookkeeper_id, is_carry_forward, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`
      )
      .run(
        ledgerId,
        period,
        voucherDate,
        nextNumber,
        preview.voucherWord,
        status,
        operatorId,
        allowSameMakerAuditor ? operatorId : null,
        allowSameMakerAuditor ? operatorId : null
      )

    const voucherId = Number(voucherResult.lastInsertRowid)
    const insertEntry = db.prepare(
      `INSERT INTO voucher_entries (
        voucher_id, row_order, summary, subject_code, debit_amount, credit_amount
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )

    preview.entries.forEach((entry, index) => {
      insertEntry.run(
        voucherId,
        index + 1,
        entry.summary,
        entry.subjectCode,
        entry.debitAmount,
        entry.creditAmount
      )
    })

    return {
      voucherId,
      voucherNumber: nextNumber,
      status,
      voucherDate,
      removedDraftVoucherIds: [...preview.draftVoucherIds]
    }
  })

  return run()
}

export function assertPLCarryForwardCompleted(
  db: Database.Database,
  params: { ledgerId: number; period: string }
): void {
  const { ledgerId, period } = params
  const preview = previewPLCarryForward(db, { ledgerId, period, includeUnpostedVouchers: false })
  if (!preview.required) {
    return
  }

  const hasPostedCarryForward = preview.existingVouchers.some((voucher) => voucher.status === 2)
  if (hasPostedCarryForward) {
    return
  }

  const hasAuditedCarryForward = preview.existingVouchers.some((voucher) => voucher.status === 1)
  if (hasAuditedCarryForward) {
    throw new Error('当前期间损益结转凭证尚未记账，不能结账')
  }

  const hasDraftCarryForward = preview.existingVouchers.some((voucher) => voucher.status === 0)
  if (hasDraftCarryForward) {
    throw new Error('当前期间损益结转凭证尚未审核、记账，不能结账')
  }

  throw new Error('当前期间尚未执行损益结转，不能结账')
}

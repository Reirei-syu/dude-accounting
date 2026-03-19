import type Database from 'better-sqlite3'
import {
  seedCashFlowItemsForLedger,
  seedCashFlowMappingsForLedger,
  seedPLCarryForwardRulesForLedger,
  seedSubjectsForLedger
} from '../database/seed'
import { assertLedgerNameAvailable, normalizeLedgerName } from './ledgerNaming'
import { applyCustomTopLevelSubjectTemplate } from './subjectTemplate'
import { grantUserLedgerAccess } from './userLedgerAccess'

export type LedgerStandardType = 'enterprise' | 'npo'

export interface LedgerLifecycleRow {
  id: number
  name: string
  standard_type: LedgerStandardType
  start_period: string
  current_period: string
  created_at?: string
}

export interface CreateLedgerInput {
  name: string
  standardType: LedgerStandardType
  startPeriod: string
  operatorUserId: number
  operatorIsAdmin: boolean
}

export interface CreateLedgerResult {
  ledgerId: number
  normalizedName: string
  customSubjectCount: number
}

export interface UpdateLedgerInput {
  ledgerId: number
  name?: string
  currentPeriod?: string
}

export interface UpdateLedgerResult {
  normalizedName?: string
  currentPeriod?: string
  nextStartPeriod?: string
}

export interface ApplyStandardTemplateInput {
  ledgerId: number
  standardType: LedgerStandardType
}

export interface ApplyStandardTemplateResult {
  updatedLedger: LedgerLifecycleRow | undefined
  subjectCount: number
  customSubjectCount: number
}

export interface LedgerLifecycleDependencies {
  seedSubjectsForLedger: typeof seedSubjectsForLedger
  seedCashFlowItemsForLedger: typeof seedCashFlowItemsForLedger
  seedCashFlowMappingsForLedger: typeof seedCashFlowMappingsForLedger
  seedPLCarryForwardRulesForLedger: typeof seedPLCarryForwardRulesForLedger
  applyCustomTopLevelSubjectTemplate: typeof applyCustomTopLevelSubjectTemplate
  grantUserLedgerAccess: typeof grantUserLedgerAccess
}

const defaultLedgerLifecycleDependencies: LedgerLifecycleDependencies = {
  seedSubjectsForLedger,
  seedCashFlowItemsForLedger,
  seedCashFlowMappingsForLedger,
  seedPLCarryForwardRulesForLedger,
  applyCustomTopLevelSubjectTemplate,
  grantUserLedgerAccess
}

export function createLedgerWithTemplate(
  db: Database.Database,
  input: CreateLedgerInput,
  dependencies: LedgerLifecycleDependencies = defaultLedgerLifecycleDependencies
): CreateLedgerResult {
  const normalizedName = normalizeLedgerName(input.name)
  assertLedgerNameAvailable(db, normalizedName)

  const result = db
    .prepare(
      `INSERT INTO ledgers (name, standard_type, start_period, current_period)
       VALUES (?, ?, ?, ?)`
    )
    .run(normalizedName, input.standardType, input.startPeriod, input.startPeriod)

  const ledgerId = Number(result.lastInsertRowid)
  dependencies.seedSubjectsForLedger(db, ledgerId, input.standardType)
  const customSubjectCount = dependencies.applyCustomTopLevelSubjectTemplate(
    db,
    ledgerId,
    input.standardType
  )
  dependencies.seedCashFlowItemsForLedger(db, ledgerId)
  dependencies.seedCashFlowMappingsForLedger(db, ledgerId, input.standardType)
  dependencies.seedPLCarryForwardRulesForLedger(db, ledgerId, input.standardType)
  db.prepare('INSERT INTO periods (ledger_id, period) VALUES (?, ?)').run(
    ledgerId,
    input.startPeriod
  )

  if (!input.operatorIsAdmin) {
    dependencies.grantUserLedgerAccess(db, input.operatorUserId, ledgerId)
  }

  return {
    ledgerId,
    normalizedName,
    customSubjectCount
  }
}

export function updateLedgerConfiguration(
  db: Database.Database,
  input: UpdateLedgerInput
): UpdateLedgerResult {
  const result: UpdateLedgerResult = {}

  if (input.name !== undefined) {
    const normalizedName = normalizeLedgerName(input.name)
    assertLedgerNameAvailable(db, normalizedName, input.ledgerId)
    db.prepare('UPDATE ledgers SET name = ? WHERE id = ?').run(normalizedName, input.ledgerId)
    result.normalizedName = normalizedName
  }

  if (input.currentPeriod !== undefined) {
    const ledger = db
      .prepare('SELECT start_period FROM ledgers WHERE id = ?')
      .get(input.ledgerId) as { start_period: string } | undefined

    if (!ledger) {
      throw new Error('账套不存在')
    }

    const nextStartPeriod =
      input.currentPeriod < ledger.start_period ? input.currentPeriod : ledger.start_period

    db.prepare('UPDATE ledgers SET start_period = ?, current_period = ? WHERE id = ?').run(
      nextStartPeriod,
      input.currentPeriod,
      input.ledgerId
    )
    db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
      input.ledgerId,
      input.currentPeriod
    )

    result.currentPeriod = input.currentPeriod
    result.nextStartPeriod = nextStartPeriod
  }

  return result
}

export function applyLedgerStandardTemplate(
  db: Database.Database,
  input: ApplyStandardTemplateInput,
  dependencies: LedgerLifecycleDependencies = defaultLedgerLifecycleDependencies
): ApplyStandardTemplateResult {
  const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ?').get(input.ledgerId) as
    | { id: number }
    | undefined

  if (!ledger) {
    throw new Error('账套不存在')
  }

  const voucherCount = Number(
    (
      db
        .prepare('SELECT COUNT(1) AS count FROM vouchers WHERE ledger_id = ?')
        .get(input.ledgerId) as { count: number }
    ).count
  )
  const nonZeroInitialBalanceCount = Number(
    (
      db
        .prepare(
          `SELECT COUNT(1) AS count
           FROM initial_balances
           WHERE ledger_id = ? AND (debit_amount <> 0 OR credit_amount <> 0)`
        )
        .get(input.ledgerId) as { count: number }
    ).count
  )

  if (voucherCount > 0 || nonZeroInitialBalanceCount > 0) {
    throw new Error('账套已有业务数据，暂不允许切换会计准则模板')
  }

  let customSubjectCount = 0
  const replaceTemplate = db.transaction(() => {
    db.prepare('DELETE FROM cash_flow_mappings WHERE ledger_id = ?').run(input.ledgerId)
    db.prepare('DELETE FROM cash_flow_items WHERE ledger_id = ? AND is_system = 1').run(
      input.ledgerId
    )
    db.prepare('DELETE FROM pl_carry_forward_rules WHERE ledger_id = ?').run(input.ledgerId)
    db.prepare('DELETE FROM subjects WHERE ledger_id = ?').run(input.ledgerId)

    db.prepare('UPDATE ledgers SET standard_type = ? WHERE id = ?').run(
      input.standardType,
      input.ledgerId
    )

    dependencies.seedSubjectsForLedger(db, input.ledgerId, input.standardType)
    customSubjectCount = dependencies.applyCustomTopLevelSubjectTemplate(
      db,
      input.ledgerId,
      input.standardType
    )
    dependencies.seedCashFlowItemsForLedger(db, input.ledgerId)
    dependencies.seedCashFlowMappingsForLedger(db, input.ledgerId, input.standardType)
    dependencies.seedPLCarryForwardRulesForLedger(db, input.ledgerId, input.standardType)
  })

  replaceTemplate()

  const updatedLedger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(input.ledgerId) as
    | LedgerLifecycleRow
    | undefined
  const subjectCount = Number(
    (
      db
        .prepare('SELECT COUNT(1) AS count FROM subjects WHERE ledger_id = ?')
        .get(input.ledgerId) as { count: number }
    ).count
  )

  return {
    updatedLedger,
    subjectCount,
    customSubjectCount
  }
}

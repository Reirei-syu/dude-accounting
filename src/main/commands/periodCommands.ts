import { appendOperationLog } from '../services/auditLog'
import {
  assertPeriodReopenAllowed,
  getNextPeriod,
  getPeriodStatusSummary
} from '../services/periodState'
import {
  assertPLCarryForwardCompleted,
  executePLCarryForward,
  listPLCarryForwardRules,
  previewPLCarryForward,
  savePLCarryForwardRules
} from '../services/plCarryForward'
import { requireCommandActor, requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import {
  asCommandPayloadRecord,
  normalizeBooleanField,
  normalizePositiveInteger,
  normalizeStringField
} from './payloadNormalizers'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function normalizeCodeLikeField(value: unknown, fieldName: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  throw new CommandError('VALIDATION_ERROR', `${fieldName} 必须为字符串`, { field: fieldName }, 2)
}

function normalizeLedgerPeriodPayload(payload: unknown, message: string) {
  const rawPayload = asCommandPayloadRecord(payload, message)
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    period: normalizeStringField(rawPayload.period, 'period', '缺少会计期间 period')
  }
}

function normalizeLedgerIdPayload(payload: unknown, message: string) {
  const rawPayload = asCommandPayloadRecord(payload, message)
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId')
  }
}

function normalizeCarryForwardRulesPayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '保存损益结转规则 payload 格式不正确')
  if (!Array.isArray(rawPayload.rules)) {
    throw new CommandError('VALIDATION_ERROR', 'rules 必须为数组', { field: 'rules' }, 2)
  }
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    rules: rawPayload.rules.map((item, index) => {
      const rule = asCommandPayloadRecord(item, `第 ${index + 1} 条损益结转规则格式不正确`, {
        row: index + 1
      })
      return {
        fromSubjectCode: normalizeCodeLikeField(rule.fromSubjectCode, 'fromSubjectCode'),
        toSubjectCode: normalizeCodeLikeField(rule.toSubjectCode, 'toSubjectCode')
      }
    })
  }
}

function normalizeCarryForwardExecutePayload(payload: unknown) {
  const rawPayload = asCommandPayloadRecord(payload, '损益结转 payload 格式不正确')
  return {
    ledgerId: normalizePositiveInteger(rawPayload.ledgerId, 'ledgerId', '缺少账套 ledgerId'),
    period: normalizeStringField(rawPayload.period, 'period', '缺少会计期间 period'),
    includeUnpostedVouchers: normalizeBooleanField(
      rawPayload.includeUnpostedVouchers,
      'includeUnpostedVouchers',
      false
    )
  }
}

function getPeriodParts(period: string): { year: number; month: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
  const [yearStr, monthStr] = period.split('-')
  return { year: Number(yearStr), month: Number(monthStr) }
}

function getStartPeriodForYear(ledgerStartPeriod: string, year: number): string {
  const startYear = Number(ledgerStartPeriod.slice(0, 4))
  if (Number.isNaN(startYear)) {
    throw new Error('账套启用年月格式不正确')
  }
  if (year < startYear) {
    throw new Error('无法结转早于账套启用年份的期末余额')
  }
  return year === startYear ? ledgerStartPeriod : `${year}-01`
}

function carryForwardYear(
  context: CommandContext,
  ledgerId: number,
  ledgerStartPeriod: string,
  year: number
): { nextPeriod: string; carriedCount: number } {
  const startPeriod = getStartPeriodForYear(ledgerStartPeriod, year)
  const endPeriod = `${year}-12`
  const nextPeriod = `${year + 1}-01`

  context.db
    .prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)')
    .run(ledgerId, nextPeriod)

  const openingRows = context.db
    .prepare(
      'SELECT subject_code, debit_amount, credit_amount FROM initial_balances WHERE ledger_id = ? AND period = ?'
    )
    .all(ledgerId, startPeriod) as Array<{
    subject_code: string
    debit_amount: number
    credit_amount: number
  }>

  const openingMap = new Map(
    openingRows.map((row) => [
      row.subject_code,
      { debit: row.debit_amount, credit: row.credit_amount }
    ])
  )

  const movementRows = context.db
    .prepare(
      `SELECT
         ve.subject_code AS subject_code,
         SUM(ve.debit_amount) AS debit_sum,
         SUM(ve.credit_amount) AS credit_sum
       FROM voucher_entries ve
       INNER JOIN vouchers v ON v.id = ve.voucher_id
       WHERE v.ledger_id = ?
         AND v.status = 2
         AND v.period >= ?
         AND v.period <= ?
       GROUP BY ve.subject_code`
    )
    .all(ledgerId, startPeriod, endPeriod) as Array<{
    subject_code: string
    debit_sum: number | null
    credit_sum: number | null
  }>

  const movementMap = new Map(
    movementRows.map((row) => [
      row.subject_code,
      {
        debit: row.debit_sum ?? 0,
        credit: row.credit_sum ?? 0
      }
    ])
  )

  const subjects = context.db
    .prepare('SELECT code FROM subjects WHERE ledger_id = ? ORDER BY code')
    .all(ledgerId) as Array<{ code: string }>

  const upsertStmt = context.db.prepare(
    `INSERT INTO initial_balances (ledger_id, period, subject_code, debit_amount, credit_amount)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ledger_id, period, subject_code)
     DO UPDATE SET debit_amount = excluded.debit_amount,
                   credit_amount = excluded.credit_amount`
  )
  const deleteStmt = context.db.prepare(
    'DELETE FROM initial_balances WHERE ledger_id = ? AND period = ? AND subject_code = ?'
  )

  let carriedCount = 0
  for (const subject of subjects) {
    const opening = openingMap.get(subject.code) ?? { debit: 0, credit: 0 }
    const movement = movementMap.get(subject.code) ?? { debit: 0, credit: 0 }
    const net = opening.debit - opening.credit + (movement.debit - movement.credit)

    if (net === 0) {
      deleteStmt.run(ledgerId, nextPeriod, subject.code)
      continue
    }

    if (net > 0) {
      upsertStmt.run(ledgerId, nextPeriod, subject.code, net, 0)
    } else {
      upsertStmt.run(ledgerId, nextPeriod, subject.code, 0, Math.abs(net))
    }
    carriedCount += 1
  }

  return { nextPeriod, carriedCount }
}

export async function getPeriodStatusCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<ReturnType<typeof getPeriodStatusSummary>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerPeriodPayload(payload, '查询期间状态 payload 格式不正确')
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return getPeriodStatusSummary(context.db, normalizedPayload.ledgerId, normalizedPayload.period)
  })
}

export async function closePeriodCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<{ carriedForward: boolean; nextPeriod: string; carriedCount: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerPeriodPayload(payload, '结账 payload 格式不正确')
    const actor = requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const { year, month } = getPeriodParts(normalizedPayload.period)
    const nextPeriod = getNextPeriod(normalizedPayload.period)
    const ledger = context.db
      .prepare('SELECT start_period FROM ledgers WHERE id = ?')
      .get(normalizedPayload.ledgerId) as { start_period: string } | undefined
    if (!ledger) {
      throw new Error('账套不存在')
    }
    assertPLCarryForwardCompleted(context.db, {
      ledgerId: normalizedPayload.ledgerId,
      period: normalizedPayload.period
    })

    let carriedForward = false
    let carriedCount = 0
    context.db.transaction(() => {
      context.db
        .prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)')
        .run(normalizedPayload.ledgerId, normalizedPayload.period)
      context.db
        .prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)')
        .run(normalizedPayload.ledgerId, nextPeriod)
      const status = context.db
        .prepare('SELECT is_closed FROM periods WHERE ledger_id = ? AND period = ?')
        .get(normalizedPayload.ledgerId, normalizedPayload.period) as { is_closed: number } | undefined
      if (status?.is_closed === 1) {
        return
      }
      context.db
        .prepare(
          `UPDATE periods
           SET is_closed = 1, closed_at = datetime('now')
           WHERE ledger_id = ? AND period = ?`
        )
        .run(normalizedPayload.ledgerId, normalizedPayload.period)

      if (month === 12) {
        const result = carryForwardYear(context, normalizedPayload.ledgerId, ledger.start_period, year)
        carriedForward = true
        carriedCount = result.carriedCount
      }
    })()

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: normalizedPayload.ledgerId,
        module: 'period',
        action: 'close',
        targetType: 'period',
        targetId: normalizedPayload.period,
        details: {
          nextPeriod,
          carriedForward,
          carriedCount
        }
      }
    )

    return {
      carriedForward,
      nextPeriod,
      carriedCount
    }
  })
}

export async function reopenPeriodCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<CommandResult<{ period: string }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerPeriodPayload(payload, '反结账 payload 格式不正确')
    requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    getPeriodParts(normalizedPayload.period)
    assertPeriodReopenAllowed(context.db, normalizedPayload.ledgerId, normalizedPayload.period)

    context.db
      .prepare(
        `UPDATE periods
         SET is_closed = 0, closed_at = NULL
         WHERE ledger_id = ? AND period = ?`
      )
      .run(normalizedPayload.ledgerId, normalizedPayload.period)

    appendActorOperationLog(context, {
      ledgerId: normalizedPayload.ledgerId,
      module: 'period',
      action: 'reopen',
      targetType: 'period',
      targetId: normalizedPayload.period
    })

    return { period: normalizedPayload.period }
  })
}

export async function listCarryForwardRulesCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listPLCarryForwardRules>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeLedgerIdPayload(payload, '查询损益结转规则 payload 格式不正确')
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return listPLCarryForwardRules(context.db, normalizedPayload.ledgerId)
  })
}

export async function saveCarryForwardRulesCommand(
  context: CommandContext,
  payload: Parameters<typeof savePLCarryForwardRules>[1]
): Promise<CommandResult<{ savedCount: number }>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeCarryForwardRulesPayload(payload)
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    const savedCount = savePLCarryForwardRules(context.db, normalizedPayload)
    appendOperationLog(context.db, {
      ledgerId: normalizedPayload.ledgerId,
      userId: context.actor?.id ?? null,
      username: context.actor?.username ?? null,
      module: 'plCarryForward',
      action: 'saveRules',
      targetType: 'ledger',
      targetId: normalizedPayload.ledgerId,
      details: {
        savedCount
      }
    })
    return { savedCount }
  })
}

export async function previewCarryForwardCommand(
  context: CommandContext,
  payload: Parameters<typeof previewPLCarryForward>[1]
): Promise<CommandResult<ReturnType<typeof previewPLCarryForward>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeCarryForwardExecutePayload(payload)
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return previewPLCarryForward(context.db, normalizedPayload)
  })
}

export async function executeCarryForwardCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }
): Promise<CommandResult<ReturnType<typeof executePLCarryForward>>> {
  return withCommandResult(context, () => {
    const normalizedPayload = normalizeCarryForwardExecutePayload(payload)
    const actor = requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, normalizedPayload.ledgerId)
    return executePLCarryForward(context.db, {
      ledgerId: normalizedPayload.ledgerId,
      period: normalizedPayload.period,
      operatorId: actor.id,
      includeUnpostedVouchers: normalizedPayload.includeUnpostedVouchers
    })
  })
}

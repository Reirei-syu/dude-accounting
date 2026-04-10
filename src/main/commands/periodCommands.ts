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
import {
  requireCommandActor,
  requireCommandLedgerAccess,
  requireCommandPermission
} from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

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

  context.db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
    ledgerId,
    nextPeriod
  )

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
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return getPeriodStatusSummary(context.db, payload.ledgerId, payload.period)
  })
}

export async function closePeriodCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string }
): Promise<
  CommandResult<{ carriedForward: boolean; nextPeriod: string; carriedCount: number }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const { year, month } = getPeriodParts(payload.period)
    const nextPeriod = getNextPeriod(payload.period)
    const ledger = context.db
      .prepare('SELECT start_period FROM ledgers WHERE id = ?')
      .get(payload.ledgerId) as { start_period: string } | undefined
    if (!ledger) {
      throw new Error('账套不存在')
    }
    assertPLCarryForwardCompleted(context.db, { ledgerId: payload.ledgerId, period: payload.period })

    let carriedForward = false
    let carriedCount = 0
    context.db.transaction(() => {
      context.db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
        payload.ledgerId,
        payload.period
      )
      context.db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
        payload.ledgerId,
        nextPeriod
      )
      const status = context.db
        .prepare('SELECT is_closed FROM periods WHERE ledger_id = ? AND period = ?')
        .get(payload.ledgerId, payload.period) as { is_closed: number } | undefined
      if (status?.is_closed === 1) {
        return
      }
      context.db
        .prepare(
          `UPDATE periods
           SET is_closed = 1, closed_at = datetime('now')
           WHERE ledger_id = ? AND period = ?`
        )
        .run(payload.ledgerId, payload.period)

      if (month === 12) {
        const result = carryForwardYear(context, payload.ledgerId, ledger.start_period, year)
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
        ledgerId: payload.ledgerId,
        module: 'period',
        action: 'close',
        targetType: 'period',
        targetId: payload.period,
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
    requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    getPeriodParts(payload.period)
    assertPeriodReopenAllowed(context.db, payload.ledgerId, payload.period)

    context.db
      .prepare(
        `UPDATE periods
         SET is_closed = 0, closed_at = NULL
         WHERE ledger_id = ? AND period = ?`
      )
      .run(payload.ledgerId, payload.period)

    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'period',
      action: 'reopen',
      targetType: 'period',
      targetId: payload.period
    })

    return { period: payload.period }
  })
}

export async function listCarryForwardRulesCommand(
  context: CommandContext,
  payload: { ledgerId: number }
): Promise<CommandResult<ReturnType<typeof listPLCarryForwardRules>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return listPLCarryForwardRules(context.db, payload.ledgerId)
  })
}

export async function saveCarryForwardRulesCommand(
  context: CommandContext,
  payload: Parameters<typeof savePLCarryForwardRules>[1]
): Promise<CommandResult<{ savedCount: number }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const savedCount = savePLCarryForwardRules(context.db, payload)
    appendOperationLog(context.db, {
      ledgerId: payload.ledgerId,
      userId: context.actor?.id ?? null,
      username: context.actor?.username ?? null,
      module: 'plCarryForward',
      action: 'saveRules',
      targetType: 'ledger',
      targetId: payload.ledgerId,
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
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return previewPLCarryForward(context.db, payload)
  })
}

export async function executeCarryForwardCommand(
  context: CommandContext,
  payload: { ledgerId: number; period: string; includeUnpostedVouchers?: boolean }
): Promise<CommandResult<ReturnType<typeof executePLCarryForward>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'bookkeeping')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    return executePLCarryForward(context.db, {
      ledgerId: payload.ledgerId,
      period: payload.period,
      operatorId: actor.id,
      includeUnpostedVouchers: payload.includeUnpostedVouchers
    })
  })
}

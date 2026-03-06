import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { assertPLCarryForwardCompleted } from '../services/plCarryForward'
import { requireAuth, requirePermission } from './session'

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
  db: ReturnType<typeof getDatabase>,
  ledgerId: number,
  ledgerStartPeriod: string,
  year: number
): { nextPeriod: string; carriedCount: number } {
  const startPeriod = getStartPeriodForYear(ledgerStartPeriod, year)
  const endPeriod = `${year}-12`
  const nextPeriod = `${year + 1}-01`

  db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
    ledgerId,
    nextPeriod
  )

  const openingRows = db
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

  const movementRows = db
    .prepare(
      `SELECT ve.subject_code AS subject_code,
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

  const subjects = db
    .prepare('SELECT code FROM subjects WHERE ledger_id = ? ORDER BY code')
    .all(ledgerId) as Array<{ code: string }>

  const upsertStmt = db.prepare(
    `INSERT INTO initial_balances (ledger_id, period, subject_code, debit_amount, credit_amount)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ledger_id, period, subject_code)
     DO UPDATE SET debit_amount = excluded.debit_amount,
                   credit_amount = excluded.credit_amount`
  )
  const deleteStmt = db.prepare(
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

export function registerPeriodHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('period:getStatus', (event, ledgerId: number, period: string) => {
    requireAuth(event)
    if (!ledgerId || !period) {
      return { period, is_closed: 0, closed_at: null }
    }

    const row = db
      .prepare('SELECT is_closed, closed_at FROM periods WHERE ledger_id = ? AND period = ?')
      .get(ledgerId, period) as { is_closed: number; closed_at: string | null } | undefined

    if (!row) {
      return { period, is_closed: 0, closed_at: null }
    }

    return { period, is_closed: row.is_closed, closed_at: row.closed_at }
  })

  ipcMain.handle('period:close', (event, payload: { ledgerId: number; period: string }) => {
    try {
      requirePermission(event, 'bookkeeping')
      const { ledgerId, period } = payload

      if (!ledgerId) {
        return { success: false, error: '请选择账套' }
      }

      const { year, month } = getPeriodParts(period)

      const ledger = db.prepare('SELECT start_period FROM ledgers WHERE id = ?').get(ledgerId) as
        | { start_period: string }
        | undefined
      if (!ledger) {
        return { success: false, error: '账套不存在' }
      }

      assertPLCarryForwardCompleted(db, { ledgerId, period })

      let carriedForward = false
      let nextPeriod: string | undefined
      let carriedCount = 0

      const closeTx = db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
          ledgerId,
          period
        )
        const status = db
          .prepare('SELECT is_closed FROM periods WHERE ledger_id = ? AND period = ?')
          .get(ledgerId, period) as { is_closed: number }

        if (status?.is_closed === 1) {
          return
        }

        db.prepare(
          `UPDATE periods
             SET is_closed = 1, closed_at = datetime('now')
             WHERE ledger_id = ? AND period = ?`
        ).run(ledgerId, period)

        if (month === 12) {
          const result = carryForwardYear(db, ledgerId, ledger.start_period, year)
          carriedForward = true
          nextPeriod = result.nextPeriod
          carriedCount = result.carriedCount
        }
      })

      closeTx()

      return {
        success: true,
        carriedForward,
        nextPeriod,
        carriedCount
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '结账失败'
      }
    }
  })
}

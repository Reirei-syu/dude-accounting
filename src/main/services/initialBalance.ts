import Decimal from 'decimal.js'
import type Database from 'better-sqlite3'
import { ensureInitialBalanceSchema } from '../database/init'

export interface InitialBalanceEntryInput {
  subjectCode: string
  debitAmount: string
  creditAmount: string
}

const AMOUNT_PATTERN = /^\d+(\.\d{0,2})?$/

function parseAmountToCents(raw: string, field: string): number {
  const value = raw.trim()
  if (value === '') return 0

  if (!AMOUNT_PATTERN.test(value)) {
    throw new Error(`${field}格式不正确，仅支持最多两位小数`)
  }

  const amount = new Decimal(value)
  if (amount.isNegative()) {
    throw new Error(`${field}不能为负数`)
  }

  return amount.mul(100).toNumber()
}

export function listInitialBalances(
  db: Database.Database,
  ledgerId: number,
  period: string
): Array<{
  subject_code: string
  subject_name: string
  balance_direction: number
  debit_amount: number
  credit_amount: number
}> {
  ensureInitialBalanceSchema(db)
  return db
    .prepare(
      `SELECT
         s.code AS subject_code,
         s.name AS subject_name,
         s.balance_direction,
         COALESCE(ib.debit_amount, 0) AS debit_amount,
         COALESCE(ib.credit_amount, 0) AS credit_amount
       FROM subjects s
       LEFT JOIN initial_balances ib
         ON ib.ledger_id = s.ledger_id
        AND ib.subject_code = s.code
        AND ib.period = ?
       WHERE s.ledger_id = ?
       ORDER BY s.code`
    )
    .all(period, ledgerId) as Array<{
    subject_code: string
    subject_name: string
    balance_direction: number
    debit_amount: number
    credit_amount: number
  }>
}

export function saveInitialBalances(
  db: Database.Database,
  payload: {
    ledgerId: number
    period: string
    entries: InitialBalanceEntryInput[]
  }
): void {
  ensureInitialBalanceSchema(db)

  const { ledgerId, period, entries } = payload
  if (!ledgerId) {
    throw new Error('请选择账套')
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('期初期间格式应为 YYYY-MM')
  }

  const ledger = db.prepare('SELECT start_period FROM ledgers WHERE id = ?').get(ledgerId) as
    | { start_period: string }
    | undefined
  if (!ledger) {
    throw new Error('账套不存在')
  }

  const startYear = Number(ledger.start_period.slice(0, 4))
  const targetYear = Number(period.slice(0, 4))
  if (Number.isNaN(startYear) || Number.isNaN(targetYear)) {
    throw new Error('期初期间或账套启用年月格式不正确')
  }
  if (targetYear < startYear) {
    throw new Error('期初期间不得早于账套启用年份')
  }

  const allowedPeriod = targetYear === startYear ? ledger.start_period : `${targetYear}-01`
  if (period !== allowedPeriod) {
    throw new Error('期初期间需与账套启用年月一致，后续年度仅允许 1 月')
  }
  if (!Array.isArray(entries)) {
    throw new Error('期初数据格式不正确')
  }

  const normalized = entries.map((entry, index) => {
    const subjectCode = entry.subjectCode.trim()
    if (!subjectCode) {
      throw new Error(`第 ${index + 1} 行缺少会计科目`)
    }

    const debitCents = parseAmountToCents(entry.debitAmount, '借方金额')
    const creditCents = parseAmountToCents(entry.creditAmount, '贷方金额')

    if (debitCents > 0 && creditCents > 0) {
      throw new Error(`科目 ${subjectCode} 借贷不可同时有值`)
    }

    return { subjectCode, debitCents, creditCents }
  })

  const saveTx = db.transaction(() => {
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
    const ensurePeriodStmt = db.prepare(
      'INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)'
    )

    ensurePeriodStmt.run(ledgerId, period)

    for (const entry of normalized) {
      if (entry.debitCents === 0 && entry.creditCents === 0) {
        deleteStmt.run(ledgerId, period, entry.subjectCode)
        continue
      }
      upsertStmt.run(ledgerId, period, entry.subjectCode, entry.debitCents, entry.creditCents)
    }
  })

  saveTx()
}

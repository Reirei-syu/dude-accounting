import Database from 'better-sqlite3'

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
  period: string
): RuleMovementRow[] {
  return db
    .prepare(
      `SELECT
       r.id AS rule_id,
       r.from_subject_code AS from_subject_code,
       fs.name AS from_subject_name,
       r.to_subject_code AS to_subject_code,
       ts.name AS to_subject_name,
       COALESCE(SUM(ve.debit_amount), 0) AS debit_sum,
       COALESCE(SUM(ve.credit_amount), 0) AS credit_sum
     FROM pl_carry_forward_rules r
     INNER JOIN subjects fs
       ON fs.ledger_id = r.ledger_id
      AND fs.code = r.from_subject_code
     INNER JOIN subjects ts
       ON ts.ledger_id = r.ledger_id
      AND ts.code = r.to_subject_code
     LEFT JOIN vouchers v
       ON v.ledger_id = r.ledger_id
      AND v.period = ?
      AND v.status = 2
      AND v.is_carry_forward = 0
     LEFT JOIN voucher_entries ve
       ON ve.voucher_id = v.id
      AND ve.subject_code = r.from_subject_code
     WHERE r.ledger_id = ?
     GROUP BY r.id, r.from_subject_code, fs.name, r.to_subject_code, ts.name
     ORDER BY r.from_subject_code ASC, r.to_subject_code ASC`
    )
    .all(period, ledgerId) as RuleMovementRow[]
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

  return db
    .prepare(
      `SELECT
         r.id AS id,
         r.from_subject_code AS from_subject_code,
         fs.name AS from_subject_name,
         r.to_subject_code AS to_subject_code,
         ts.name AS to_subject_name
       FROM pl_carry_forward_rules r
       INNER JOIN subjects fs
         ON fs.ledger_id = r.ledger_id
        AND fs.code = r.from_subject_code
       INNER JOIN subjects ts
         ON ts.ledger_id = r.ledger_id
        AND ts.code = r.to_subject_code
       WHERE r.ledger_id = ?
       ORDER BY r.from_subject_code ASC, r.to_subject_code ASC`
    )
    .all(ledgerId)
    .map((row) => {
      const typedRow = row as {
        id: number
        from_subject_code: string
        from_subject_name: string
        to_subject_code: string
        to_subject_name: string
      }
      return {
        id: typedRow.id,
        fromSubjectCode: typedRow.from_subject_code,
        fromSubjectName: typedRow.from_subject_name,
        toSubjectCode: typedRow.to_subject_code,
        toSubjectName: typedRow.to_subject_name
      }
    })
}

export function previewPLCarryForward(
  db: Database.Database,
  params: { ledgerId: number; period: string }
): PLCarryForwardPreview {
  const { ledgerId, period } = params
  assertLedgerExists(db, ledgerId)
  assertPeriodFormat(period)

  const movements = getRuleMovements(db, ledgerId, period)
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
  params: { ledgerId: number; period: string; operatorId: number }
): ExecutePLCarryForwardResult {
  const { ledgerId, period, operatorId } = params
  const preview = previewPLCarryForward(db, { ledgerId, period })

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
         WHERE ledger_id = ? AND period = ?`
      )
      .get(ledgerId, period) as { max_num: number }
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
  const preview = previewPLCarryForward(db, { ledgerId, period })
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

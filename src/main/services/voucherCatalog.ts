import type Database from 'better-sqlite3'

export type VoucherListStatusFilter = 'all' | 0 | 1 | 2 | 3

export interface VoucherListQuery {
  ledgerId: number
  voucherId?: number
  period?: string
  dateFrom?: string
  dateTo?: string
  keyword?: string
  status?: VoucherListStatusFilter
}

export interface VoucherSummaryRow {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: number
  first_summary: string
  creator_id: number | null
  auditor_id: number | null
  bookkeeper_id: number | null
  creator_name: string | null
  auditor_name: string | null
  bookkeeper_name: string | null
  total_debit: number
  total_credit: number
}

export interface VoucherEntryDetailRow {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
  auxiliary_item_id: number | null
  cash_flow_item_id: number | null
  subject_name: string | null
  cash_flow_code: string | null
  cash_flow_name: string | null
}

export function getNextVoucherNumber(
  db: Database.Database,
  ledgerId: number,
  period: string
): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
    )
    .get(ledgerId, period) as { max_num: number }

  return row.max_num + 1
}

export function listVoucherSummaries(
  db: Database.Database,
  query: VoucherListQuery
): VoucherSummaryRow[] {
  const whereClauses = ['v.ledger_id = ?']
  const params: Array<string | number> = [query.ledgerId]

  if (typeof query.voucherId === 'number') {
    whereClauses.push('v.id = ?')
    params.push(query.voucherId)
  }

  if (query.status === 'all') {
    // Explicitly include all voucher states, including deleted.
  } else if (typeof query.status === 'number') {
    whereClauses.push('v.status = ?')
    params.push(query.status)
  } else {
    whereClauses.push('v.status IN (0, 1, 2)')
  }

  if (query.period) {
    whereClauses.push('v.period = ?')
    params.push(query.period)
  }
  if (query.dateFrom) {
    whereClauses.push('v.voucher_date >= ?')
    params.push(query.dateFrom)
  }
  if (query.dateTo) {
    whereClauses.push('v.voucher_date <= ?')
    params.push(query.dateTo)
  }
  if (query.keyword) {
    whereClauses.push(
      `EXISTS (
         SELECT 1 FROM voucher_entries ve
         WHERE ve.voucher_id = v.id AND ve.summary LIKE ?
       )`
    )
    params.push(`%${query.keyword}%`)
  }

  const sql = `
    SELECT
      v.id,
      v.ledger_id,
      v.period,
      v.voucher_date,
      v.voucher_number,
      v.voucher_word,
      v.status,
      COALESCE(
        (
          SELECT ve_first.summary
          FROM voucher_entries ve_first
          WHERE ve_first.voucher_id = v.id
          ORDER BY ve_first.row_order ASC, ve_first.id ASC
          LIMIT 1
        ),
        ''
      ) AS first_summary,
      v.creator_id,
      v.auditor_id,
      v.bookkeeper_id,
      COALESCE(uc.real_name, uc.username) AS creator_name,
      COALESCE(ua.real_name, ua.username) AS auditor_name,
      COALESCE(ub.real_name, ub.username) AS bookkeeper_name,
      SUM(ve.debit_amount) AS total_debit,
      SUM(ve.credit_amount) AS total_credit
    FROM vouchers v
    INNER JOIN voucher_entries ve ON ve.voucher_id = v.id
    LEFT JOIN users uc ON uc.id = v.creator_id
    LEFT JOIN users ua ON ua.id = v.auditor_id
    LEFT JOIN users ub ON ub.id = v.bookkeeper_id
    WHERE ${whereClauses.join(' AND ')}
    GROUP BY v.id
    ORDER BY v.voucher_date DESC, v.voucher_number DESC
  `

  return db.prepare(sql).all(...params) as VoucherSummaryRow[]
}

export function getVoucherLedgerId(db: Database.Database, voucherId: number): number | null {
  const voucher = db.prepare('SELECT ledger_id FROM vouchers WHERE id = ?').get(voucherId) as
    | { ledger_id: number }
    | undefined

  return voucher?.ledger_id ?? null
}

export function listVoucherEntries(
  db: Database.Database,
  voucherId: number
): VoucherEntryDetailRow[] {
  return db
    .prepare(
      `SELECT
         ve.*,
         s.name AS subject_name,
         cfi.code AS cash_flow_code,
         cfi.name AS cash_flow_name
       FROM voucher_entries ve
       LEFT JOIN subjects s
         ON s.code = ve.subject_code
        AND s.ledger_id = (SELECT ledger_id FROM vouchers WHERE id = ve.voucher_id)
       LEFT JOIN cash_flow_items cfi
         ON cfi.id = ve.cash_flow_item_id
       WHERE ve.voucher_id = ?
       ORDER BY ve.row_order ASC`
    )
    .all(voucherId) as VoucherEntryDetailRow[]
}

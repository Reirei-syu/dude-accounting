import type Database from 'better-sqlite3'

export interface PendingVoucherSummaryItem {
  id: number
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2
  voucher_label: string
}

export interface PeriodStatusSummary {
  period: string
  is_closed: number
  closed_at: string | null
  pending_audit_vouchers: PendingVoucherSummaryItem[]
  pending_bookkeep_vouchers: PendingVoucherSummaryItem[]
}

function parsePeriod(period: string): { year: number; month: number } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
  if (!match) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }

  return {
    year: Number(match[1]),
    month: Number(match[2])
  }
}

function toVoucherLabel(voucherWord: string, voucherNumber: number): string {
  return `${voucherWord}-${String(voucherNumber).padStart(4, '0')}`
}

function mapPendingVoucherRows(
  rows: Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: number
  }>
): PendingVoucherSummaryItem[] {
  return rows.map((row) => ({
    id: row.id,
    voucher_number: row.voucher_number,
    voucher_word: row.voucher_word,
    status: row.status as 0 | 1 | 2,
    voucher_label: toVoucherLabel(row.voucher_word, row.voucher_number)
  }))
}

export function getNextPeriod(period: string): string {
  const { year, month } = parsePeriod(period)
  if (month === 12) {
    return `${year + 1}-01`
  }

  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export function buildClosedPeriodVoucherEditMessage(period: string): string {
  return `当前会计期间（${period}）已结账，本期凭证不能新增或编辑；未审核、未记账凭证仅可删除，如需继续编辑请先反结账。`
}

export function getPeriodStatusSummary(
  db: Database.Database,
  ledgerId: number,
  period: string
): PeriodStatusSummary {
  const periodRow = db
    .prepare('SELECT is_closed, closed_at FROM periods WHERE ledger_id = ? AND period = ?')
    .get(ledgerId, period) as { is_closed: number; closed_at: string | null } | undefined

  const pendingRows = db
    .prepare(
      `SELECT id, voucher_number, voucher_word, status
       FROM vouchers
       WHERE ledger_id = ? AND period = ? AND status IN (0, 1)
       ORDER BY voucher_date ASC, voucher_number ASC, id ASC`
    )
    .all(ledgerId, period) as Array<{
    id: number
    voucher_number: number
    voucher_word: string
    status: number
  }>

  return {
    period,
    is_closed: periodRow?.is_closed ?? 0,
    closed_at: periodRow?.closed_at ?? null,
    pending_audit_vouchers: mapPendingVoucherRows(pendingRows.filter((row) => row.status === 0)),
    pending_bookkeep_vouchers: mapPendingVoucherRows(
      pendingRows.filter((row) => row.status === 1)
    )
  }
}

export function buildClosedPeriodPendingVoucherMessage(
  summary: Pick<
    PeriodStatusSummary,
    'pending_audit_vouchers' | 'pending_bookkeep_vouchers' | 'period'
  >
): string | null {
  const sections: string[] = []

  if (summary.pending_audit_vouchers.length > 0) {
    sections.push(
      `未审核凭证：${summary.pending_audit_vouchers.map((item) => item.voucher_label).join('、')}`
    )
  }

  if (summary.pending_bookkeep_vouchers.length > 0) {
    sections.push(
      `已审核未记账凭证：${summary.pending_bookkeep_vouchers
        .map((item) => item.voucher_label)
        .join('、')}`
    )
  }

  if (sections.length === 0) {
    return null
  }

  return `当前期间存在${sections.join('；')}。结账后这些凭证仅可删除，如需继续编辑请先反结账。`
}

export function assertPeriodWritable(
  db: Database.Database,
  ledgerId: number,
  period: string
): void {
  const summary = getPeriodStatusSummary(db, ledgerId, period)
  if (summary.is_closed === 1) {
    throw new Error(buildClosedPeriodVoucherEditMessage(period))
  }
}

export function assertPeriodReopenAllowed(
  db: Database.Database,
  ledgerId: number,
  period: string
): void {
  const currentSummary = getPeriodStatusSummary(db, ledgerId, period)
  if (currentSummary.is_closed !== 1) {
    throw new Error('当前期间尚未结账，不能反结账')
  }

  const laterClosedPeriod = db
    .prepare(
      `SELECT period
       FROM periods
       WHERE ledger_id = ? AND period > ? AND is_closed = 1
       ORDER BY period ASC
       LIMIT 1`
    )
    .get(ledgerId, period) as { period: string } | undefined

  if (laterClosedPeriod) {
    throw new Error(`存在后续已结账期间（${laterClosedPeriod.period}），请先反结账后续期间。`)
  }
}

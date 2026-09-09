import type Database from 'better-sqlite3'
import type { LedgerYearOverview } from '../../shared/contracts/ledgerOverview'

/** 同一只读事务内取得账套、期间与凭证汇总，不创建缺失期间。 */
export function getLedgerYearOverview(
  db: Database.Database,
  ledgerId: number,
  year: number
): LedgerYearOverview | null {
  return db.transaction((): LedgerYearOverview | null => {
    const ledger = db
      .prepare(
        'SELECT id, name, standard_type, start_period, current_period FROM ledgers WHERE id = ?'
      )
      .get(ledgerId) as LedgerYearOverview['ledger'] | undefined
    if (!ledger) return null

    const yearText = String(year).padStart(4, '0')
    const bounds = [ledgerId, `${yearText}-01`, `${yearText}-12`]
    const periods = db
      .prepare(
        'SELECT period, is_closed FROM periods WHERE ledger_id = ? AND period BETWEEN ? AND ?'
      )
      .all(...bounds) as Array<{ period: string; is_closed: number }>
    const counts = db
      .prepare(
        `SELECT period, COUNT(*) AS voucher_count FROM vouchers
         WHERE ledger_id = ? AND period BETWEEN ? AND ? AND status IN (0, 1, 2)
         GROUP BY period`
      )
      .all(...bounds) as Array<{ period: string; voucher_count: number }>
    const closedPeriods = new Set(
      periods.filter((row) => row.is_closed === 1).map((row) => row.period)
    )
    const voucherCounts = new Map(counts.map((row) => [row.period, row.voucher_count]))

    return {
      ledger,
      year,
      months: Array.from({ length: 12 }, (_, index) => {
        const period = `${yearText}-${String(index + 1).padStart(2, '0')}`
        return {
          period,
          status:
            period < ledger.start_period
              ? 'not_started'
              : closedPeriods.has(period)
                ? 'closed'
                : 'open',
          voucherCount: voucherCounts.get(period) ?? 0
        }
      })
    }
  })()
}

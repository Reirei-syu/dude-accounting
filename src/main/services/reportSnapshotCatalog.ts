import type Database from 'better-sqlite3'
import type {
  ReportSnapshotContent,
  ReportSnapshotDetail,
  ReportSnapshotScope,
  ReportSnapshotSummary,
  ReportListFilters
} from './reporting'

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

function getPeriodStartDate(period: string): string {
  assertPeriod(period)
  return `${period}-01`
}

function getPeriodEndDate(period: string): string {
  assertPeriod(period)
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const date = new Date(Date.UTC(year, month, 0))
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${period}-${day}`
}

function buildScopeFromRow(
  row: Pick<
    ReportSnapshotSummary,
    'period' | 'start_period' | 'end_period' | 'as_of_date' | 'include_unposted_vouchers'
  >
): ReportSnapshotScope {
  return {
    mode: row.as_of_date ? 'month' : 'range',
    startPeriod: row.start_period,
    endPeriod: row.end_period,
    periodLabel: row.period,
    startDate: getPeriodStartDate(row.start_period),
    endDate: row.as_of_date ?? getPeriodEndDate(row.end_period),
    asOfDate: row.as_of_date,
    includeUnpostedVouchers: row.include_unposted_vouchers === 1
  }
}

function parseSnapshotRow(
  row:
    | (ReportSnapshotSummary & {
        content_json?: string
      })
    | undefined
): ReportSnapshotDetail {
  if (!row) {
    throw new Error('报表快照不存在')
  }

  const parsedContent = row.content_json
    ? (JSON.parse(row.content_json) as Partial<ReportSnapshotContent>)
    : {}
  const scope = parsedContent.scope ?? buildScopeFromRow(row)

  return {
    id: row.id,
    ledger_id: row.ledger_id,
    report_type: row.report_type,
    report_name: row.report_name,
    period: row.period,
    start_period: row.start_period,
    end_period: row.end_period,
    as_of_date: row.as_of_date,
    include_unposted_vouchers: row.include_unposted_vouchers,
    generated_by: row.generated_by,
    generated_at: row.generated_at,
    ledger_name: row.ledger_name,
    standard_type: row.standard_type,
    content: {
      title: parsedContent.title ?? row.report_name,
      reportType: parsedContent.reportType ?? row.report_type,
      period: parsedContent.period ?? row.period,
      ledgerName: parsedContent.ledgerName ?? row.ledger_name,
      standardType: parsedContent.standardType ?? row.standard_type,
      generatedAt: parsedContent.generatedAt ?? row.generated_at,
      scope,
      formCode: parsedContent.formCode,
      tableColumns: parsedContent.tableColumns,
      tables: parsedContent.tables,
      sections: parsedContent.sections ?? [],
      totals: parsedContent.totals ?? []
    }
  }
}

export function listReportSnapshots(
  db: Database.Database,
  filters: ReportListFilters
): ReportSnapshotSummary[] {
  const whereClauses = ['rs.ledger_id = ?']
  const params: Array<number | string> = [filters.ledgerId]

  if (filters.reportTypes && filters.reportTypes.length > 0) {
    whereClauses.push(`rs.report_type IN (${filters.reportTypes.map(() => '?').join(', ')})`)
    params.push(...filters.reportTypes)
  }

  if (filters.periods && filters.periods.length > 0) {
    whereClauses.push(`rs.period IN (${filters.periods.map(() => '?').join(', ')})`)
    params.push(...filters.periods)
  }

  return db
    .prepare(
      `SELECT
         rs.id,
         rs.ledger_id,
         rs.report_type,
         rs.report_name,
         rs.period,
         rs.start_period,
         rs.end_period,
         rs.as_of_date,
         rs.include_unposted_vouchers,
         rs.generated_by,
         rs.generated_at,
         l.name AS ledger_name,
         l.standard_type
       FROM report_snapshots rs
       INNER JOIN ledgers l ON l.id = rs.ledger_id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY rs.generated_at DESC, rs.id DESC`
    )
    .all(...params) as ReportSnapshotSummary[]
}

export function getReportSnapshotDetail(
  db: Database.Database,
  snapshotId: number,
  ledgerId?: number
): ReportSnapshotDetail {
  const row = db
    .prepare(
      `SELECT
         rs.id,
         rs.ledger_id,
         rs.report_type,
         rs.report_name,
         rs.period,
         rs.start_period,
         rs.end_period,
         rs.as_of_date,
         rs.include_unposted_vouchers,
         rs.generated_by,
         rs.generated_at,
         rs.content_json,
         l.name AS ledger_name,
         l.standard_type
       FROM report_snapshots rs
       INNER JOIN ledgers l ON l.id = rs.ledger_id
       WHERE rs.id = ?`
    )
    .get(snapshotId) as
    | (ReportSnapshotSummary & {
        content_json: string
      })
    | undefined

  const detail = parseSnapshotRow(row)
  if (typeof ledgerId === 'number' && detail.ledger_id !== ledgerId) {
    throw new Error('报表快照不属于当前账套')
  }
  return detail
}

export function deleteReportSnapshot(
  db: Database.Database,
  snapshotId: number,
  ledgerId: number
): boolean {
  const result = db
    .prepare('DELETE FROM report_snapshots WHERE id = ? AND ledger_id = ?')
    .run(snapshotId, ledgerId)
  return result.changes > 0
}

import type Database from 'better-sqlite3'
import type {
  LedgerRow,
  ReportSnapshotScope,
  ReportType,
  BuildReportSnapshotContentOptions,
  ReportSnapshotContent,
  GenerateReportSnapshotParams,
  ReportSnapshotDetail,
  DuplicateReportSnapshotRow
} from './reporting/types'
import {
  getReportTitle,
  getLedger,
  normalizeTimestamp,
  buildScope
} from './reporting/common'
import {
  buildBalanceSheetSnapshot
} from './reporting/balanceSheet'
import {
  buildEnterpriseEquityStatementSnapshot
} from './reporting/equityStatement'
import {
  buildNgoActivityStatementSnapshot
} from './reporting/activityStatement'
import {
  buildNgoCashFlowStatementSnapshot,
  buildCashFlowSnapshot
} from './reporting/cashFlowStatement'
import {
  buildProfitLossSnapshot
} from './reporting/incomeStatement'
export type {
  AccountingStandardType,
  ReportType,
  ReportSnapshotLine,
  ReportSnapshotSection,
  ReportSnapshotTotal,
  ReportSnapshotTableColumn,
  ReportSnapshotTableCell,
  ReportSnapshotTableRow,
  ReportSnapshotTable,
  ReportSnapshotScope,
  ReportSnapshotContent,
  ReportSnapshotSummary,
  ReportSnapshotDetail,
  ReportListFilters,
  GenerateReportSnapshotParams,
  BuildReportSnapshotContentOptions,
  DuplicateReportSnapshotRow,
  ReportExportFormat
} from './reporting/types'

function buildSnapshotContent(
  db: Database.Database,
  ledger: LedgerRow,
  scope: ReportSnapshotScope,
  reportType: ReportType,
  generatedAt: string,
  options: BuildReportSnapshotContentOptions = {}
): ReportSnapshotContent {
  const title = getReportTitle(reportType, ledger.standard_type)
  if (reportType === 'balance_sheet') {
    return buildBalanceSheetSnapshot(db, ledger, scope, generatedAt)
  }
  if (reportType === 'equity_statement') {
    return buildEnterpriseEquityStatementSnapshot(db, ledger, scope, generatedAt)
  }
  if (ledger.standard_type === 'npo' && reportType === 'activity_statement') {
    return buildNgoActivityStatementSnapshot(
      db,
      ledger,
      scope,
      generatedAt,
      options.activityCurrentPeriod
    )
  }
  if (reportType === 'cashflow_statement') {
    if (ledger.standard_type === 'npo') {
      return buildNgoCashFlowStatementSnapshot(db, ledger, scope, generatedAt)
    }
    return buildCashFlowSnapshot(db, ledger, scope, generatedAt)
  }
  return buildProfitLossSnapshot(db, ledger, scope, generatedAt, title)
}

export function buildReportSnapshotContentForExport(
  db: Database.Database,
  params: GenerateReportSnapshotParams,
  options: BuildReportSnapshotContentOptions = {}
): ReportSnapshotContent {
  const ledger = getLedger(db, params.ledgerId)
  const generatedAt = normalizeTimestamp(params.now)
  const includeUnpostedVouchers = params.includeUnpostedVouchers === true
  const scope = buildScope(
    params.reportType,
    params.month,
    params.startPeriod,
    params.endPeriod,
    includeUnpostedVouchers
  )
  return buildSnapshotContent(db, ledger, scope, params.reportType, generatedAt, options)
}

function buildReportName(title: string, scope: ReportSnapshotScope): string {
  return `${title} ${scope.periodLabel}${scope.includeUnpostedVouchers ? '（含未记账凭证）' : ''}`
}

export function generateReportSnapshot(
  db: Database.Database,
  params: GenerateReportSnapshotParams
): ReportSnapshotDetail {
  const ledger = getLedger(db, params.ledgerId)
  const generatedAt = normalizeTimestamp(params.now)
  const includeUnpostedVouchers = params.includeUnpostedVouchers === true
  const scope = buildScope(
    params.reportType,
    params.month,
    params.startPeriod,
    params.endPeriod,
    includeUnpostedVouchers
  )
  const title = getReportTitle(params.reportType, ledger.standard_type)
  const content = buildSnapshotContent(db, ledger, scope, params.reportType, generatedAt)
  const reportName = buildReportName(title, scope)
  const duplicate = db
    .prepare(
      `SELECT id
       FROM report_snapshots
       WHERE ledger_id = ?
         AND report_type = ?
         AND period = ?
       LIMIT 1`
    )
    .get(params.ledgerId, params.reportType, scope.periodLabel) as
    | DuplicateReportSnapshotRow
    | undefined

  if (duplicate) {
    throw new Error('已存在同会计期间同类型的报表，请先删除原报表后再生成')
  }

  let result: { lastInsertRowid: number }
  try {
    result = db
      .prepare(
        `INSERT INTO report_snapshots (
           ledger_id,
           report_type,
           report_name,
           period,
           start_period,
           end_period,
           as_of_date,
           include_unposted_vouchers,
           generated_by,
           generated_at,
           content_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.ledgerId,
        params.reportType,
        reportName,
        scope.periodLabel,
        scope.startPeriod,
        scope.endPeriod,
        scope.asOfDate,
        includeUnpostedVouchers ? 1 : 0,
        params.generatedBy ?? null,
        generatedAt,
        JSON.stringify(content)
      ) as { lastInsertRowid: number }
  } catch (error) {
    if (error instanceof Error && error.message.includes('idx_report_snapshots_unique_scope')) {
      throw new Error('已存在同会计期间同类型的报表，请先删除原报表后再生成')
    }
    throw error
  }

  return {
    id: Number(result.lastInsertRowid),
    ledger_id: params.ledgerId,
    report_type: params.reportType,
    report_name: reportName,
    period: scope.periodLabel,
    start_period: scope.startPeriod,
    end_period: scope.endPeriod,
    as_of_date: scope.asOfDate,
    include_unposted_vouchers: includeUnpostedVouchers ? 1 : 0,
    generated_by: params.generatedBy ?? null,
    generated_at: generatedAt,
    ledger_name: ledger.name,
    standard_type: ledger.standard_type,
    content
  }
}

export {
  deleteReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots
} from './reportSnapshotCatalog'
export {
  buildDefaultReportExportFileName,
  buildReportSnapshotHtml,
  writeReportSnapshotExcel,
  writeReportSnapshotHtml,
  writeReportSnapshotPdf
} from './reportSnapshotOutput'

import Decimal from 'decimal.js'
import type { JSX } from 'react'

export type ReportType =
  | 'balance_sheet'
  | 'income_statement'
  | 'activity_statement'
  | 'cashflow_statement'

export interface ReportSnapshotLine {
  key: string
  label: string
  amountCents: number
  code?: string
}

export interface ReportSnapshotSection {
  key: string
  title: string
  rows: ReportSnapshotLine[]
}

export interface ReportSnapshotTotal {
  key: string
  label: string
  amountCents: number
}

export interface ReportSnapshotContent {
  title: string
  reportType: ReportType
  period: string
  ledgerName: string
  standardType: 'enterprise' | 'npo'
  generatedAt: string
  scope: {
    mode: 'month' | 'range'
    startPeriod: string
    endPeriod: string
    periodLabel: string
    startDate: string
    endDate: string
    asOfDate: string | null
    includeUnpostedVouchers: boolean
  }
  sections: ReportSnapshotSection[]
  totals: ReportSnapshotTotal[]
}

export interface ReportSnapshotSummary {
  id: number
  ledger_id: number
  report_type: ReportType
  report_name: string
  period: string
  start_period: string
  end_period: string
  as_of_date: string | null
  include_unposted_vouchers: number
  generated_by: number | null
  generated_at: string
  ledger_name: string
  standard_type: 'enterprise' | 'npo'
}

export interface ReportSnapshotDetail extends ReportSnapshotSummary {
  content: ReportSnapshotContent
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  balance_sheet: '资产负债表',
  income_statement: '利润表',
  activity_statement: '业务活动表',
  cashflow_statement: '现金流量表'
}

const COMPONENT_TYPE_TO_REPORT_TYPE: Record<string, ReportType> = {
  BalanceSheet: 'balance_sheet',
  IncomeStatement: 'income_statement',
  ActivityStatement: 'activity_statement',
  CashFlowStatement: 'cashflow_statement'
}

export function getReportTypeLabel(reportType: ReportType): string {
  return REPORT_TYPE_LABELS[reportType]
}

export function getReportTypeByComponent(componentType: string): ReportType | null {
  return COMPONENT_TYPE_TO_REPORT_TYPE[componentType] ?? null
}

export function formatAmountCents(amountCents: number): string {
  return new Decimal(amountCents).div(100).toFixed(2)
}

export function formatGeneratedAt(raw: string): string {
  const value = new Date(raw)
  if (Number.isNaN(value.getTime())) {
    return raw
  }
  return value.toLocaleString('zh-CN', { hour12: false })
}

interface ViewerProps {
  detail: ReportSnapshotDetail
}

export function ReportSnapshotViewer({ detail }: ViewerProps): JSX.Element {
  return (
    <div className="glass-panel-light p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3
            className="text-lg font-semibold"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {detail.report_name}
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            账套：{detail.ledger_name} | 期间：{detail.period} | 生成时间：
            {formatGeneratedAt(detail.generated_at)}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            取数范围：{detail.content.scope.startDate} 至 {detail.content.scope.endDate}
            {detail.content.scope.asOfDate ? ` | 截至时点：${detail.content.scope.asOfDate}` : ''}
            {' | '}
            口径：{detail.content.scope.includeUnpostedVouchers ? '含未记账凭证' : '仅已记账凭证'}
          </p>
        </div>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: 'rgba(15, 23, 42, 0.08)',
            color: 'var(--color-text-secondary)'
          }}
        >
          {getReportTypeLabel(detail.report_type)}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {detail.content.totals.map((total) => (
          <div
            key={total.key}
            className="rounded-2xl border p-3"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              background: 'rgba(255, 255, 255, 0.68)'
            }}
          >
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {total.label}
            </div>
            <div
              className="mt-2 text-lg font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {formatAmountCents(total.amountCents)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {detail.content.sections.map((section) => (
          <div
            key={section.key}
            className="rounded-2xl border overflow-hidden"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              background: 'rgba(255, 255, 255, 0.7)'
            }}
          >
            <div
              className="px-4 py-3 text-sm font-semibold border-b"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              {section.title}
            </div>

            {section.rows.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--color-glass-border-light)' }}>
                {section.rows.map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-sm">
                    <div style={{ color: 'var(--color-text-secondary)' }}>
                      {row.code ? `${row.code} ` : ''}
                      {row.label}
                    </div>
                    <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      {formatAmountCents(row.amountCents)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                本期暂无数据
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

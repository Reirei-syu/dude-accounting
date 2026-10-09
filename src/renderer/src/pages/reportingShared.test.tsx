import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReportSnapshotViewer, type ReportSnapshotDetail, type ReportType } from './reportingShared'

function createDetail(reportType: ReportType = 'balance_sheet'): ReportSnapshotDetail {
  return {
    id: 1,
    ledger_id: 1,
    report_type: reportType,
    report_name: '测试报表',
    period: '2026-09',
    start_period: '2026-09',
    end_period: '2026-09',
    as_of_date: null,
    include_unposted_vouchers: 0,
    generated_by: 1,
    generated_at: '2026-10-09T00:00:00Z',
    ledger_name: '测试账套',
    standard_type: 'enterprise',
    content: {
      title: '测试报表',
      reportType,
      period: '2026-09',
      ledgerName: '测试账套',
      standardType: 'enterprise',
      generatedAt: '2026-10-09T00:00:00Z',
      scope: {
        mode: 'month',
        startPeriod: '2026-09',
        endPeriod: '2026-09',
        periodLabel: '2026-09',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        asOfDate: null,
        includeUnpostedVouchers: false
      },
      sections: [],
      totals: [
        { key: 'zero', label: '零合计', amountCents: 0 },
        { key: 'nonzero', label: '非零合计', amountCents: 1 }
      ]
    }
  }
}

function zeroAmountCount(html: string): number {
  return (html.match(/<span class="query-zero-amount">-?0\.00<\/span>/g) ?? []).length
}

describe('ReportSnapshotViewer zero amounts', () => {
  it.each<ReportType>([
    'balance_sheet',
    'income_statement',
    'activity_statement',
    'cashflow_statement',
    'equity_statement'
  ])('marks only actual zero amounts in %s, including totals', (reportType) => {
    const detail = createDetail(reportType)
    detail.content.tables = [
      {
        key: 'main',
        columns: [{ key: 'label', label: '项目' }],
        rows: [
          {
            key: 'amounts',
            cells: [
              { value: '项目' },
              { value: 0, isAmount: true },
              { value: 1, isAmount: true },
              { value: -1, isAmount: true },
              { value: 0 },
              { value: '0.00' },
              { value: null, isAmount: true }
            ]
          }
        ]
      }
    ]

    const html = renderToStaticMarkup(<ReportSnapshotViewer detail={detail} />)

    expect(zeroAmountCount(html)).toBe(2)
    expect(html).toContain('<span>0.01</span>')
    expect(html).toContain('<span>-0.01</span>')
    expect(html).toMatch(/<td[^>]*>0<\/td>/)
    expect(html).toMatch(/<td[^>]*>0\.00<\/td>/)
    expect(html).toMatch(/<td[^>]*><\/td>/)
  })

  it('covers legacy single-column section amounts without fading labels', () => {
    const detail = createDetail()
    detail.content.sections = [
      {
        key: 'legacy',
        title: '历史报表',
        rows: [
          { key: 'zero', label: '零项目', lineNo: '0', amountCents: -0 },
          { key: 'negative', label: '负数', amountCents: -1 }
        ]
      }
    ]

    const html = renderToStaticMarkup(<ReportSnapshotViewer detail={detail} />)

    expect(zeroAmountCount(html)).toBe(2)
    expect(html).toContain('<span class="query-zero-amount">-0.00</span>')
    expect(html).toContain('<span>-0.01</span>')
    expect(html).toMatch(/<div[^>]*>0 零项目<\/div>/)
  })

  it('covers legacy multiple-column amounts including missing values displayed as zero', () => {
    const detail = createDetail('equity_statement')
    detail.content.tableColumns = [
      { key: 'current', label: '本期' },
      { key: 'previous', label: '上期' },
      { key: 'missing', label: '其他' }
    ]
    detail.content.sections = [
      {
        key: 'legacy',
        title: '历史多列表',
        rows: [{ key: 'row', label: '项目', amountCents: 0, cells: { current: 0, previous: 1 } }]
      }
    ]

    const html = renderToStaticMarkup(<ReportSnapshotViewer detail={detail} />)

    expect(zeroAmountCount(html)).toBe(3)
    expect(html).toContain('<span>0.01</span>')
  })
})

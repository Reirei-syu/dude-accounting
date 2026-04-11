import { describe, expect, it, vi } from 'vitest'

const reportingMocks = vi.hoisted(() => ({
  getReportSnapshotDetail: vi.fn()
}))

vi.mock('../services/reporting', async () => {
  const actual = await vi.importActual('../services/reporting')
  return {
    ...actual,
    getReportSnapshotDetail: reportingMocks.getReportSnapshotDetail
  }
})

import { createPrintDocument } from './print'

function createCashflowDetail(id: number) {
  return {
    id,
    ledger_id: 1,
    report_type: 'cashflow_statement' as const,
    report_name: `现金流量表-${id}`,
    period: '2026.01-2026.03',
    start_period: '2026-01',
    end_period: '2026-03',
    as_of_date: null,
    include_unposted_vouchers: 0,
    generated_by: 1,
    generated_at: '2026-04-11T10:00:00.000Z',
    ledger_name: '测试账套',
    standard_type: 'enterprise' as const,
    content: {
      title: '现金流量表',
      reportType: 'cashflow_statement' as const,
      period: '2026.01-2026.03',
      ledgerName: '测试账套',
      standardType: 'enterprise' as const,
      generatedAt: '2026-04-11T10:00:00.000Z',
      scope: {
        mode: 'range' as const,
        startPeriod: '2026-01',
        endPeriod: '2026-03',
        periodLabel: '2026.01-2026.03',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        asOfDate: null,
        includeUnpostedVouchers: false
      },
      tables: [
        {
          key: `cashflow-${id}`,
          columns: [
            { key: 'item', label: '项目' },
            { key: 'current', label: '本年金额' },
            { key: 'previous', label: '上年金额' }
          ],
          rows: [
            {
              key: `row-${id}`,
              cells: [
                { value: '经营活动产生的现金流量净额' },
                { value: 13000, isAmount: true },
                { value: 4500, isAmount: true }
              ]
            }
          ]
        }
      ],
      sections: [],
      totals: []
    }
  }
}

describe('print batch report document', () => {
  it('hides previous-year cashflow columns in batch print documents when requested', () => {
    reportingMocks.getReportSnapshotDetail
      .mockReturnValueOnce(createCashflowDetail(1))
      .mockReturnValueOnce(createCashflowDetail(2))

    const result = createPrintDocument({} as never, {
      type: 'batch',
      batchType: 'report',
      snapshotIds: [1, 2],
      ledgerId: 1,
      renderOptions: {
        showCashflowPreviousAmount: false
      }
    })

    const firstSegment = result.document.segments[0]
    expect(firstSegment?.kind).toBe('table')
    if (firstSegment?.kind === 'table') {
      expect(firstSegment.columns.map((column) => column.key)).toEqual(['item', 'current'])
      expect(firstSegment.rows[0]?.cells).toHaveLength(2)
    }
  })
})

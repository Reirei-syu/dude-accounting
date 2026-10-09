import { describe, expect, it } from 'vitest'

import { buildPresentedReportTables } from './reportTablePresentation'

describe('reportTablePresentation', () => {
  it('identifies enterprise cashflow comparison as the same interval in the prior year', () => {
    const tables = [{ key: 'enterprise-cashflow', columns: [
      { key: 'current', label: '本期金额' }, { key: 'previous', label: '上期金额' }
    ], rows: [] }]
    expect(buildPresentedReportTables('cashflow_statement', tables, undefined, 'cents',
      { startPeriod: '2026-07', endPeriod: '2026-09' })?.[0].columns[1].label).toBe('上年同期金额')
  })
  it('clarifies the actual periods when presenting an existing quarterly snapshot', () => {
    const scope = { startPeriod: '2026-07', endPeriod: '2026-09' }
    const activity = [
      {
        key: 'activity',
        columns: [
          { key: 'current_unrestricted', label: '本月数\n（非限定性）' },
          { key: 'cumulative_unrestricted', label: '本年累计数\n（非限定性）' }
        ],
        rows: []
      }
    ]
    expect(
      buildPresentedReportTables('activity_statement', activity, undefined, 'cents', scope)?.[0]
        .columns[0].label
    ).toBe('2026年9月数\n（非限定性）')
    const cashflow = [
      {
        key: 'cashflow',
        columns: [
          { key: 'current', label: '本年金额' },
          { key: 'previous', label: '上年金额' }
        ],
        rows: []
      }
    ]
    expect(
      buildPresentedReportTables(
        'cashflow_statement',
        cashflow,
        undefined,
        'cents',
        scope
      )?.[0].columns.map((c) => c.label)
    ).toEqual(['本期金额', '上年同期金额'])
    expect(activity[0].columns[0].label).toBe('本月数\n（非限定性）')
  })
  it('can hide cashflow previous columns while keeping current values', () => {
    const tables = [
      {
        key: 'cashflow',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本年金额' },
          { key: 'previous', label: '上年金额' }
        ],
        rows: [
          {
            key: 'row-1',
            cells: [
              { value: '业务活动产生的现金流量净额' },
              { value: 13_000, isAmount: true },
              { value: 4_500, isAmount: true }
            ]
          }
        ]
      }
    ]

    expect(
      buildPresentedReportTables('cashflow_statement', tables, {
        showCashflowPreviousAmount: false
      })
    ).toEqual([
      {
        key: 'cashflow',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本年金额' }
        ],
        rows: [
          {
            key: 'row-1',
            cells: [
              { value: '业务活动产生的现金流量净额' },
              { value: 13_000, isAmount: true }
            ]
          }
        ]
      }
    ])
  })

  it('can convert official table amounts from cents to yuan for print rendering', () => {
    const tables = [
      {
        key: 'activity',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本月数（合计）' }
        ],
        rows: [
          {
            key: 'row-1',
            cells: [
              { value: '其他收入' },
              { value: 18, isAmount: true }
            ]
          }
        ]
      }
    ]

    expect(buildPresentedReportTables('activity_statement', tables, undefined, 'yuan')).toEqual([
      {
        key: 'activity',
        columns: [
          { key: 'item', label: '项目' },
          { key: 'current', label: '本月数（合计）' }
        ],
        rows: [
          {
            key: 'row-1',
            cells: [
              { value: '其他收入' },
              { value: 0.18, isAmount: true }
            ]
          }
        ]
      }
    ])
  })
})

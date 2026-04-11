import { describe, expect, it } from 'vitest'

import { buildPresentedReportTables } from './reportTablePresentation'

describe('reportTablePresentation', () => {
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

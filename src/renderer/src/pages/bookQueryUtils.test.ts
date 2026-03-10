import { describe, expect, it } from 'vitest'
import {
  filterSubjectRowsByCodeRange,
  getBalanceSideLabel,
  getLeafSubjects,
  getPeriodDateRange
} from './bookQueryUtils'

describe('bookQueryUtils', () => {
  it('builds full month date range from period text', () => {
    expect(getPeriodDateRange('2026-02')).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28'
    })
  })

  it('extracts only leaf subjects while keeping code order', () => {
    expect(
      getLeafSubjects([
        { code: '1001', name: '库存现金' },
        { code: '5201', name: '业务活动成本' },
        { code: '520101', name: '办公费' },
        { code: '520102', name: '差旅费' }
      ])
    ).toEqual([
      { code: '1001', name: '库存现金' },
      { code: '520101', name: '办公费' },
      { code: '520102', name: '差旅费' }
    ])
  })

  it('maps balance side to display labels', () => {
    expect(getBalanceSideLabel('debit')).toBe('借')
    expect(getBalanceSideLabel('credit')).toBe('贷')
    expect(getBalanceSideLabel('flat')).toBe('平')
  })

  it('filters rows by optional subject code range', () => {
    const rows = [
      { subject_code: '1001' },
      { subject_code: '2201' },
      { subject_code: '3101' },
      { subject_code: '5301' }
    ]

    expect(filterSubjectRowsByCodeRange(rows, '', '')).toEqual(rows)
    expect(filterSubjectRowsByCodeRange(rows, '2201', '')).toEqual([
      { subject_code: '2201' },
      { subject_code: '3101' },
      { subject_code: '5301' }
    ])
    expect(filterSubjectRowsByCodeRange(rows, '', '3101')).toEqual([
      { subject_code: '1001' },
      { subject_code: '2201' },
      { subject_code: '3101' }
    ])
    expect(filterSubjectRowsByCodeRange(rows, '2201', '3101')).toEqual([
      { subject_code: '2201' },
      { subject_code: '3101' }
    ])
  })
})

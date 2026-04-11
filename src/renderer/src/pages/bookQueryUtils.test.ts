import { describe, expect, it } from 'vitest'
import {
  resolveAuxiliaryItemsForSubject,
  filterSubjectRowsByCodeRange,
  getBalanceSideLabel,
  getCurrentYearDateRange,
  getLeafSubjects,
  getPeriodDateRange
} from './bookQueryUtils'

describe('bookQueryUtils', () => {
  it('builds full month date range from period text', () => {
    expect(getPeriodDateRange('2026-02')).toEqual({
      startDate: '2026-02-01',
      endDate: '2026-02-28'
    })
    expect(getPeriodDateRange('2024-02')).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-02-29'
    })
    expect(getPeriodDateRange('2026-12')).toEqual({
      startDate: '2026-12-01',
      endDate: '2026-12-31'
    })
  })

  it('builds current-year date range from january first to today', () => {
    expect(getCurrentYearDateRange(new Date(2026, 2, 11))).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-03-11'
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

  it('resolves available auxiliary items from category and custom bindings', () => {
    expect(
      resolveAuxiliaryItemsForSubject(
        {
          code: '6601',
          name: 'expense',
          has_auxiliary: 1,
          auxiliary_categories: ['department', 'custom'],
          auxiliary_custom_items: [{ id: 3, category: 'custom', code: 'C001', name: 'custom-one' }]
        },
        [
          { id: 1, category: 'department', code: 'D001', name: 'admin' },
          { id: 2, category: 'employee', code: 'E001', name: 'alice' },
          { id: 3, category: 'custom', code: 'C001', name: 'custom-one' }
        ]
      )
    ).toEqual([
      { id: 3, category: 'custom', code: 'C001', name: 'custom-one' },
      { id: 1, category: 'department', code: 'D001', name: 'admin' }
    ])
  })
})

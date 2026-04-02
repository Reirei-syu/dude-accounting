import { describe, expect, it } from 'vitest'
import {
  getArchiveYearOptions,
  getBackupPeriodOptions,
  pickDefaultArchiveYear,
  pickDefaultBackupPeriod,
  resolveBackupPeriodSelection
} from './backupSelection'

const periods = [
  { period: '2026-01', is_closed: 1 },
  { period: '2026-02', is_closed: 0 },
  { period: '2026-03', is_closed: 1 },
  { period: '2025-12', is_closed: 1 }
]

describe('backup selection helpers', () => {
  it('lists all backup periods in descending order and defaults to latest period', () => {
    expect(getBackupPeriodOptions(periods)).toEqual(['2026-03', '2026-02', '2026-01', '2025-12'])
    expect(pickDefaultBackupPeriod(periods)).toBe('2026-03')
  })

  it('lists archive years from closed periods and defaults to the latest year', () => {
    expect(getArchiveYearOptions(periods)).toEqual(['2026', '2025'])
    expect(pickDefaultArchiveYear(periods)).toBe('2026')
  })

  it('returns backup defaults for unclosed periods and keeps archive year empty when none are closed', () => {
    expect(pickDefaultBackupPeriod([{ period: '2026-02', is_closed: 0 }])).toBe('2026-02')
    expect(pickDefaultArchiveYear([{ period: '2026-02', is_closed: 0 }])).toBe('')
  })

  it('prefers current period when resolving backup period selection', () => {
    expect(resolveBackupPeriodSelection(periods, '2026-02', '')).toBe('2026-02')
    expect(resolveBackupPeriodSelection(periods, '2026-04', '')).toBe('2026-03')
    expect(resolveBackupPeriodSelection([], '2026-04', '')).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import {
  getArchiveYearOptions,
  getBackupPeriodOptions,
  pickDefaultArchiveYear,
  pickDefaultBackupPeriod
} from './backupSelection'

const periods = [
  { period: '2026-01', is_closed: 1 },
  { period: '2026-02', is_closed: 0 },
  { period: '2026-03', is_closed: 1 },
  { period: '2025-12', is_closed: 1 }
]

describe('backup selection helpers', () => {
  it('lists closed backup periods in descending order and defaults to latest closed period', () => {
    expect(getBackupPeriodOptions(periods)).toEqual(['2026-03', '2026-01', '2025-12'])
    expect(pickDefaultBackupPeriod(periods)).toBe('2026-03')
  })

  it('lists archive years from closed periods and defaults to the latest year', () => {
    expect(getArchiveYearOptions(periods)).toEqual(['2026', '2025'])
    expect(pickDefaultArchiveYear(periods)).toBe('2026')
  })

  it('returns empty defaults when no closed periods exist', () => {
    expect(pickDefaultBackupPeriod([{ period: '2026-02', is_closed: 0 }])).toBe('')
    expect(pickDefaultArchiveYear([{ period: '2026-02', is_closed: 0 }])).toBe('')
  })
})

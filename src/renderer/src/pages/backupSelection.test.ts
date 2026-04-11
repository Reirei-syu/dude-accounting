import { describe, expect, it } from 'vitest'
import {
  getArchiveYearOptions,
  pickDefaultArchiveYear
} from './backupSelection'

const periods = [
  { period: '2026-01', is_closed: 1 },
  { period: '2026-02', is_closed: 0 },
  { period: '2026-03', is_closed: 1 },
  { period: '2025-12', is_closed: 1 }
]

describe('backup archive year helpers', () => {
  it('lists archive years from closed periods and defaults to the latest year', () => {
    expect(getArchiveYearOptions(periods)).toEqual(['2026', '2025'])
    expect(pickDefaultArchiveYear(periods)).toBe('2026')
  })

  it('keeps archive year empty when none are closed', () => {
    expect(pickDefaultArchiveYear([{ period: '2026-02', is_closed: 0 }])).toBe('')
  })
})

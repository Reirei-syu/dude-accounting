import { describe, expect, it } from 'vitest'
import { formatArchiveCardTitle, formatBackupCardTitle, getLatestRecordIdsByGroup } from './backupCardLayout'

describe('backup card layout helpers', () => {
  it('formats backup period as centered year-month title content', () => {
    expect(formatBackupCardTitle('2026-03')).toBe('2026年03月')
    expect(formatBackupCardTitle(null)).toBe('未设置期间')
  })

  it('formats archive year as year-only title when no month exists', () => {
    expect(formatArchiveCardTitle('2026')).toBe('2026年')
    expect(formatArchiveCardTitle('')).toBe('未设置年度')
  })

  it('computes latest record ids per logical period group', () => {
    expect(
      getLatestRecordIdsByGroup(
        [
          { id: 8, groupKey: '2026-03' },
          { id: 7, groupKey: '2026-03' },
          { id: 5, groupKey: '2025-12' }
        ],
        (item) => item.groupKey
      )
    ).toEqual(new Set([8, 5]))
  })

  it('can collapse all records into a single latest id when workflow only keeps one latest version', () => {
    expect(
      getLatestRecordIdsByGroup(
        [
          { id: 8, groupKey: '2026-03' },
          { id: 7, groupKey: '2026-02' },
          { id: 5, groupKey: '2025-12' }
        ],
        () => 'all'
      )
    ).toEqual(new Set([8]))
  })
})

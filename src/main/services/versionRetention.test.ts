import { describe, expect, it } from 'vitest'
import { assertHistoricalVersionDeletable } from './versionRetention'

describe('versionRetention service', () => {
  it('allows deleting non-latest versions when a newer version exists', () => {
    expect(() =>
      assertHistoricalVersionDeletable(3, [5, 3, 2], '备份')
    ).not.toThrow()
  })

  it('blocks deleting the latest version', () => {
    expect(() => assertHistoricalVersionDeletable(5, [5, 3, 2], '归档')).toThrow(
      '请保留最新归档，仅允许删除旧版本'
    )
  })
})

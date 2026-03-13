import { describe, expect, it } from 'vitest'
import { getArchivePackageName, getBackupPackageName } from './backupRecordDisplay'

describe('backup record display helpers', () => {
  it('uses the backup package directory name as the display name', () => {
    expect(
      getBackupPackageName(
        'D:\\coding\\completed\\demo\\ledger-8-2026-20260308-091011\\ledger-8-2026-20260308-091011.db'
      )
    ).toBe('ledger-8-2026-20260308-091011')
  })

  it('uses the archive export directory name as the display name', () => {
    expect(
      getArchivePackageName('D:\\coding\\completed\\demo\\ledger-8-2026-20260308-091011')
    ).toBe('ledger-8-2026-20260308-091011')
  })

  it('returns a stable fallback when path is empty', () => {
    expect(getBackupPackageName('')).toBe('未命名包件')
    expect(getArchivePackageName('')).toBe('未命名包件')
  })
})

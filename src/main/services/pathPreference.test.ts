import { describe, expect, it } from 'vitest'
import {
  getPathPreference,
  getPathPreferenceWithFallback,
  rememberPathPreference
} from './pathPreference'

class FakePathPreferenceDb {
  settings = new Map<string, string>()

  prepare(sql: string): {
    get: (key: string) => { value: string } | undefined
    run: (key: string, value: string) => void
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key) => {
          const value = this.settings.get(key)
          return value === undefined ? undefined : { value }
        },
        run: () => undefined
      }
    }

    if (
      normalized ===
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ) {
      return {
        get: () => undefined,
        run: (key, value) => {
          this.settings.set(key, value)
        }
      }
    }

    throw new Error(`Unhandled SQL in FakePathPreferenceDb: ${normalized}`)
  }
}

describe('pathPreference service', () => {
  it('returns null when no path preference has been stored', () => {
    const db = new FakePathPreferenceDb()
    expect(getPathPreference(db as never, 'backup_last_dir')).toBeNull()
  })

  it('stores directory paths and collapses file paths to their parent directory', () => {
    const db = new FakePathPreferenceDb()

    rememberPathPreference(db as never, 'backup_last_dir', 'D:/exports/backup-root')
    expect(getPathPreference(db as never, 'backup_last_dir')).toBe('D:/exports/backup-root')

    rememberPathPreference(db as never, 'backup_last_dir', 'D:/exports/backup-root/package/manifest.json')
    expect(getPathPreference(db as never, 'backup_last_dir')).toBe('D:/exports/backup-root/package')
  })

  it('returns the first available remembered path from a fallback list', () => {
    const db = new FakePathPreferenceDb()

    rememberPathPreference(db as never, 'report_export_last_dir', 'D:/exports/report.pdf')

    expect(
      getPathPreferenceWithFallback(db as never, [
        'report_export_batch_last_dir',
        'report_export_last_dir'
      ])
    ).toBe('D:/exports')
    expect(
      getPathPreferenceWithFallback(db as never, ['missing_1', 'missing_2'])
    ).toBeNull()
  })
})

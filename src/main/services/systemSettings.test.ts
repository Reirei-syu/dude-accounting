import { describe, expect, it } from 'vitest'
import {
  getRuntimeDefaultsSnapshot,
  getSystemParamSnapshot,
  isSystemParamKey,
  normalizeSystemParamValue,
  updateSystemParam
} from './systemSettings'

class FakeSystemSettingsDb {
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

    throw new Error(`Unhandled SQL in FakeSystemSettingsDb: ${normalized}`)
  }
}

describe('systemSettings service', () => {
  it('returns normalized defaults for editable system params', () => {
    const db = new FakeSystemSettingsDb()

    expect(getSystemParamSnapshot(db as never)).toEqual({
      allow_same_maker_auditor: '0',
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
    expect(getRuntimeDefaultsSnapshot(db as never)).toEqual({
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
  })

  it('falls back to defaults when stored values are invalid', () => {
    const db = new FakeSystemSettingsDb()
    db.settings.set('default_voucher_word', '无效值')
    db.settings.set('voucher_list_default_status', 'broken')

    expect(getSystemParamSnapshot(db as never)).toMatchObject({
      default_voucher_word: '记',
      voucher_list_default_status: 'all'
    })
  })

  it('validates and persists only supported system params', () => {
    const db = new FakeSystemSettingsDb()

    const result = updateSystemParam(db as never, 'default_voucher_word', ' 转 ')

    expect(result).toEqual({
      previousValue: null,
      nextValue: '转',
      changed: true
    })
    expect(db.settings.get('default_voucher_word')).toBe('转')
  })

  it('skips writes when the normalized value is unchanged', () => {
    const db = new FakeSystemSettingsDb()
    db.settings.set('voucher_list_default_status', 'all')

    const result = updateSystemParam(db as never, 'voucher_list_default_status', ' all ')

    expect(result).toEqual({
      previousValue: 'all',
      nextValue: 'all',
      changed: false
    })
  })

  it('rejects invalid system param values and unknown keys', () => {
    expect(isSystemParamKey('default_voucher_word')).toBe(true)
    expect(isSystemParamKey('subject_template.enterprise')).toBe(false)
    expect(() => normalizeSystemParamValue('default_voucher_word', '无效值')).toThrow(
      '系统参数 default_voucher_word 的值无效'
    )
  })
})

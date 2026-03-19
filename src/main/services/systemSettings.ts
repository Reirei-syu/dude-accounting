import type Database from 'better-sqlite3'

export const SYSTEM_PARAM_KEYS = [
  'allow_same_maker_auditor',
  'default_voucher_word',
  'new_voucher_date_strategy',
  'voucher_list_default_status'
] as const

export const RUNTIME_DEFAULT_KEYS = [
  'default_voucher_word',
  'new_voucher_date_strategy',
  'voucher_list_default_status'
] as const

export type SystemParamKey = (typeof SYSTEM_PARAM_KEYS)[number]
export type RuntimeDefaultKey = (typeof RUNTIME_DEFAULT_KEYS)[number]

export interface SystemParamSnapshot {
  allow_same_maker_auditor: string
  default_voucher_word: string
  new_voucher_date_strategy: string
  voucher_list_default_status: string
}

export interface RuntimeDefaultsSnapshot {
  default_voucher_word: string
  new_voucher_date_strategy: string
  voucher_list_default_status: string
}

interface SettingDefinition {
  defaultValue: string
  normalize: (value: string) => string
  validate: (value: string) => void
}

const SYSTEM_PARAM_DEFINITIONS: Record<SystemParamKey, SettingDefinition> = {
  allow_same_maker_auditor: {
    defaultValue: '0',
    normalize: (value) => value.trim(),
    validate: (value) => {
      if (value !== '0' && value !== '1') {
        throw new Error('系统参数 allow_same_maker_auditor 的值无效')
      }
    }
  },
  default_voucher_word: {
    defaultValue: '记',
    normalize: (value) => value.trim(),
    validate: (value) => {
      if (!['记', '转', '收', '付'].includes(value)) {
        throw new Error('系统参数 default_voucher_word 的值无效')
      }
    }
  },
  new_voucher_date_strategy: {
    defaultValue: 'last_voucher_date',
    normalize: (value) => value.trim(),
    validate: (value) => {
      if (value !== 'last_voucher_date' && value !== 'period_start') {
        throw new Error('系统参数 new_voucher_date_strategy 的值无效')
      }
    }
  },
  voucher_list_default_status: {
    defaultValue: 'all',
    normalize: (value) => value.trim(),
    validate: (value) => {
      if (!['all', 'pending', 'audited', 'posted'].includes(value)) {
        throw new Error('系统参数 voucher_list_default_status 的值无效')
      }
    }
  }
}

function getStoredSystemSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined

  return row?.value ?? null
}

function setStoredSystemSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value)
}

function normalizeReadableValue(key: SystemParamKey, value: string | null): string {
  const definition = SYSTEM_PARAM_DEFINITIONS[key]
  const candidate = value === null ? definition.defaultValue : definition.normalize(value)

  try {
    definition.validate(candidate)
    return candidate
  } catch {
    return definition.defaultValue
  }
}

export function isSystemParamKey(key: string): key is SystemParamKey {
  return SYSTEM_PARAM_KEYS.includes(key as SystemParamKey)
}

export function normalizeSystemParamValue(key: SystemParamKey, value: string): string {
  const definition = SYSTEM_PARAM_DEFINITIONS[key]
  const normalized = definition.normalize(value)
  definition.validate(normalized)
  return normalized
}

export function getSystemParamSnapshot(db: Database.Database): SystemParamSnapshot {
  return {
    allow_same_maker_auditor: normalizeReadableValue(
      'allow_same_maker_auditor',
      getStoredSystemSetting(db, 'allow_same_maker_auditor')
    ),
    default_voucher_word: normalizeReadableValue(
      'default_voucher_word',
      getStoredSystemSetting(db, 'default_voucher_word')
    ),
    new_voucher_date_strategy: normalizeReadableValue(
      'new_voucher_date_strategy',
      getStoredSystemSetting(db, 'new_voucher_date_strategy')
    ),
    voucher_list_default_status: normalizeReadableValue(
      'voucher_list_default_status',
      getStoredSystemSetting(db, 'voucher_list_default_status')
    )
  }
}

export function getRuntimeDefaultsSnapshot(db: Database.Database): RuntimeDefaultsSnapshot {
  const snapshot = getSystemParamSnapshot(db)
  return {
    default_voucher_word: snapshot.default_voucher_word,
    new_voucher_date_strategy: snapshot.new_voucher_date_strategy,
    voucher_list_default_status: snapshot.voucher_list_default_status
  }
}

export function updateSystemParam(
  db: Database.Database,
  key: SystemParamKey,
  value: string
): {
  previousValue: string | null
  nextValue: string
  changed: boolean
} {
  const previousValue = getStoredSystemSetting(db, key)
  const nextValue = normalizeSystemParamValue(key, value)

  if (previousValue === nextValue) {
    return {
      previousValue,
      nextValue,
      changed: false
    }
  }

  setStoredSystemSetting(db, key, nextValue)

  return {
    previousValue,
    nextValue,
    changed: true
  }
}

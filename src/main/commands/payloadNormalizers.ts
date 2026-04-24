import { CommandError } from './types'

export function asCommandPayloadRecord(
  value: unknown,
  message: string,
  details: Record<string, unknown> | null = null
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CommandError('VALIDATION_ERROR', message, details, 2)
  }
  return value as Record<string, unknown>
}

export function normalizePositiveInteger(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为正整数`,
  details: Record<string, unknown> | null = null
): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed)
    }
  }

  throw new CommandError('VALIDATION_ERROR', message, details ?? { field: fieldName }, 2)
}

export function normalizeOptionalPositiveInteger(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为正整数`
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return normalizePositiveInteger(value, fieldName, message)
}

export function normalizePositiveIntegerArray(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为正整数数组`
): number[] {
  if (!Array.isArray(value)) {
    throw new CommandError('VALIDATION_ERROR', message, { field: fieldName }, 2)
  }
  return value.map((item, index) =>
    normalizePositiveInteger(item, `${fieldName}[${index}]`, message, {
      field: fieldName,
      index,
      received: item
    })
  )
}

export function normalizeStringField(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为字符串`,
  options: { allowEmpty?: boolean } = {}
): string {
  if (typeof value !== 'string') {
    throw new CommandError('VALIDATION_ERROR', message, { field: fieldName }, 2)
  }

  const normalized = value.trim()
  if (!options.allowEmpty && !normalized) {
    throw new CommandError('VALIDATION_ERROR', message, { field: fieldName }, 2)
  }
  return options.allowEmpty ? value : normalized
}

export function normalizeOptionalStringField(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为字符串`,
  options: { trim?: boolean; emptyAsUndefined?: boolean } = {}
): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new CommandError('VALIDATION_ERROR', message, { field: fieldName }, 2)
  }

  const normalized = options.trim === false ? value : value.trim()
  if (options.emptyAsUndefined !== false && normalized === '') {
    return undefined
  }
  return normalized
}

export function normalizeStringArray(
  value: unknown,
  fieldName: string,
  message = `${fieldName} 必须为字符串数组`
): string[] {
  if (!Array.isArray(value)) {
    throw new CommandError('VALIDATION_ERROR', message, { field: fieldName }, 2)
  }

  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new CommandError('VALIDATION_ERROR', message, {
        field: fieldName,
        index,
        received: item
      }, 2)
    }
    return item.trim()
  })
}

export function normalizeBooleanField(value: unknown, fieldName: string, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
  }
  throw new CommandError('VALIDATION_ERROR', `${fieldName} 必须为布尔值`, { field: fieldName }, 2)
}

export function normalizeAmountText(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === '') {
    return '0'
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || '0'
  }
  throw new CommandError('VALIDATION_ERROR', `${fieldName} 金额格式不正确`, {
    field: fieldName,
    received: value
  }, 2)
}

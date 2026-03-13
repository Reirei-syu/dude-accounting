import { describe, expect, it } from 'vitest'
import { formatLocalDateTime } from './localTime'

describe('localTime service', () => {
  it('formats local datetime strings in YYYY-MM-DD HH:mm:ss', () => {
    const value = formatLocalDateTime(new Date(2026, 2, 13, 15, 4, 5))
    expect(value).toBe('2026-03-13 15:04:05')
  })
})

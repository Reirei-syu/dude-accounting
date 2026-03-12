import { describe, expect, it } from 'vitest'

import { ensureUserPreferenceSchema } from './init'

class MockUserPreferenceDb {
  userPreferenceColumns: Array<{ name: string }> = []

  exec(sql: string): void {
    if (sql.includes('CREATE TABLE IF NOT EXISTS user_preferences')) {
      this.userPreferenceColumns = [
        { name: 'user_id' },
        { name: 'key' },
        { name: 'value' },
        { name: 'updated_at' }
      ]
    }
  }

  prepare(sql: string): { all: () => unknown[]; run: () => void } {
    if (sql === "PRAGMA table_info('user_preferences')") {
      return {
        all: () => this.userPreferenceColumns,
        run: () => undefined
      }
    }

    return {
      all: () => [],
      run: () => undefined
    }
  }
}

describe('user preference schema', () => {
  it('creates the user preferences table when it is missing', () => {
    const db = new MockUserPreferenceDb()

    ensureUserPreferenceSchema(db as never)

    expect(db.userPreferenceColumns.map((column) => column.name)).toEqual([
      'user_id',
      'key',
      'value',
      'updated_at'
    ])
  })
})

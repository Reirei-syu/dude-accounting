import { describe, expect, it } from 'vitest'

import { ensureUserLedgerAccessSchema } from './init'

class MockLedgerAccessDb {
  userLedgerColumns: Array<{ name: string }> = []
  userLedgerPermissions: Array<{ user_id: number; ledger_id: number }> = []
  readonly users: Array<{ id: number; is_admin: number }>
  readonly ledgers: Array<{ id: number }>

  constructor(payload: {
    users: Array<{ id: number; is_admin: number }>
    ledgers: Array<{ id: number }>
  }) {
    this.users = payload.users
    this.ledgers = payload.ledgers
  }

  exec(sql: string): void {
    if (sql.includes('CREATE TABLE IF NOT EXISTS user_ledger_permissions')) {
      this.userLedgerColumns = [
        { name: 'user_id' },
        { name: 'ledger_id' },
        { name: 'created_at' }
      ]
    }
  }

  prepare(sql: string): { all: () => unknown[]; run: () => void } {
    if (sql === "PRAGMA table_info('user_ledger_permissions')") {
      return {
        all: () => this.userLedgerColumns,
        run: () => undefined
      }
    }

    if (
      sql.includes(
        'INSERT OR IGNORE INTO user_ledger_permissions (user_id, ledger_id)'
      )
    ) {
      return {
        all: () => [],
        run: () => {
          for (const user of this.users.filter((item) => item.is_admin === 0)) {
            for (const ledger of this.ledgers) {
              if (
                !this.userLedgerPermissions.some(
                  (item) => item.user_id === user.id && item.ledger_id === ledger.id
                )
              ) {
                this.userLedgerPermissions.push({ user_id: user.id, ledger_id: ledger.id })
              }
            }
          }
        }
      }
    }

    return {
      all: () => [],
      run: () => undefined
    }
  }
}

describe('user ledger access schema', () => {
  it('creates user ledger permission rows for existing non-admin users during migration', () => {
    const db = new MockLedgerAccessDb({
      users: [
        { id: 1, is_admin: 1 },
        { id: 2, is_admin: 0 },
        { id: 3, is_admin: 0 }
      ],
      ledgers: [{ id: 11 }, { id: 12 }]
    })

    ensureUserLedgerAccessSchema(db as never)

    expect(db.userLedgerPermissions).toEqual([
      { user_id: 2, ledger_id: 11 },
      { user_id: 2, ledger_id: 12 },
      { user_id: 3, ledger_id: 11 },
      { user_id: 3, ledger_id: 12 }
    ])
  })
})

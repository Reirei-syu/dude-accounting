import { describe, expect, it } from 'vitest'
import { ensureLedgerSchema } from './init'

class MockLedgerSchemaDb {
  columns: Array<{ name: string }> = [
    { name: 'id' },
    { name: 'name' },
    { name: 'standard_type' },
    { name: 'start_period' },
    { name: 'current_period' },
    { name: 'created_at' }
  ]
  execSql: string[] = []

  prepare(sql: string): { all: () => Array<{ name: string }> } {
    if (sql === "PRAGMA table_info('ledgers')") {
      return {
        all: () => this.columns
      }
    }
    throw new Error(`Unhandled SQL in MockLedgerSchemaDb: ${sql}`)
  }

  exec(sql: string): void {
    this.execSql.push(sql)
    if (sql.includes('taxpayer_identification_number')) {
      this.columns.push({ name: 'taxpayer_identification_number' })
    }
  }
}

describe('ledger schema', () => {
  it('adds taxpayer identification number to legacy ledgers', () => {
    const db = new MockLedgerSchemaDb()

    ensureLedgerSchema(db as never)

    expect(db.columns.map((column) => column.name)).toContain('taxpayer_identification_number')
    expect(db.execSql.join('\n')).toContain('ALTER TABLE ledgers ADD COLUMN taxpayer_identification_number')
  })
})

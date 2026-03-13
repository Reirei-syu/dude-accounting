import { describe, expect, it } from 'vitest'
import { assertLedgerNameAvailable, normalizeLedgerName } from './ledgerNaming'

class FakeLedgerNamingDb {
  constructor(
    private readonly ledgers: Array<{
      id: number
      name: string
    }>
  ) {}

  prepare(sql: string): { get: (...params: unknown[]) => { id: number } | undefined } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT id FROM ledgers WHERE name = ? LIMIT 1') {
      return {
        get: (name) => this.ledgers.find((ledger) => ledger.name === String(name))
      }
    }

    if (normalized === 'SELECT id FROM ledgers WHERE name = ? AND id <> ? LIMIT 1') {
      return {
        get: (name, ledgerId) =>
          this.ledgers.find(
            (ledger) => ledger.name === String(name) && ledger.id !== Number(ledgerId)
          )
      }
    }

    throw new Error(`Unhandled SQL in FakeLedgerNamingDb: ${normalized}`)
  }
}

describe('ledgerNaming service', () => {
  it('normalizes ledger names by trimming surrounding whitespace', () => {
    expect(normalizeLedgerName('  杜小德科技  ')).toBe('杜小德科技')
  })

  it('blocks creating a ledger with the same name as an existing ledger', () => {
    const db = new FakeLedgerNamingDb([
      { id: 1, name: '杜小德科技' },
      { id: 2, name: '示例民非' }
    ])

    expect(() => assertLedgerNameAvailable(db as never, '杜小德科技')).toThrow(
      '已存在同名账套，请使用其他名称'
    )
  })

  it('allows updating the current ledger without changing its name, but blocks renaming to another existing name', () => {
    const db = new FakeLedgerNamingDb([
      { id: 1, name: '杜小德科技' },
      { id: 2, name: '示例民非' }
    ])

    expect(() => assertLedgerNameAvailable(db as never, '杜小德科技', 1)).not.toThrow()
    expect(() => assertLedgerNameAvailable(db as never, '示例民非', 1)).toThrow(
      '已存在同名账套，请使用其他名称'
    )
  })
})

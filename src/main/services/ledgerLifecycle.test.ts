import { describe, expect, it, vi } from 'vitest'
import {
  applyLedgerStandardTemplate,
  createLedgerWithTemplate,
  updateLedgerConfiguration,
  type LedgerLifecycleDependencies
} from './ledgerLifecycle'

type LedgerRow = {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  created_at: string
}

class FakeLedgerLifecycleDb {
  ledgers: LedgerRow[] = []
  periods: Array<{ ledger_id: number; period: string }> = []
  voucherCountByLedger = new Map<number, number>()
  nonZeroInitialBalanceCountByLedger = new Map<number, number>()
  subjectCountByLedger = new Map<number, number>()
  deletedModules: Array<{ table: string; ledgerId: number }> = []
  private nextLedgerId = 1

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT id FROM ledgers WHERE name = ? LIMIT 1') {
      return {
        get: (name) => this.ledgers.find((ledger) => ledger.name === String(name)),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT id FROM ledgers WHERE name = ? AND id <> ? LIMIT 1') {
      return {
        get: (name, excludeLedgerId) =>
          this.ledgers.find(
            (ledger) => ledger.name === String(name) && ledger.id !== Number(excludeLedgerId)
          ),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'INSERT INTO ledgers (name, standard_type, start_period, current_period) VALUES (?, ?, ?, ?)'
    ) {
      return {
        get: () => undefined,
        run: (name, standardType, startPeriod, currentPeriod) => {
          const id = this.nextLedgerId++
          this.ledgers.push({
            id,
            name: String(name),
            standard_type: String(standardType) as 'enterprise' | 'npo',
            start_period: String(startPeriod),
            current_period: String(currentPeriod),
            created_at: '2026-03-19 12:00:00'
          })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (normalized === 'INSERT INTO periods (ledger_id, period) VALUES (?, ?)') {
      return {
        get: () => undefined,
        run: (ledgerId, period) => {
          this.periods.push({
            ledger_id: Number(ledgerId),
            period: String(period)
          })
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'UPDATE ledgers SET name = ? WHERE id = ?') {
      return {
        get: () => undefined,
        run: (name, ledgerId) => {
          const ledger = this.ledgers.find((item) => item.id === Number(ledgerId))
          if (!ledger) {
            return { lastInsertRowid: 0, changes: 0 }
          }
          ledger.name = String(name)
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT start_period FROM ledgers WHERE id = ?') {
      return {
        get: (ledgerId) => {
          const ledger = this.ledgers.find((item) => item.id === Number(ledgerId))
          return ledger ? { start_period: ledger.start_period } : undefined
        },
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'UPDATE ledgers SET start_period = ?, current_period = ? WHERE id = ?') {
      return {
        get: () => undefined,
        run: (startPeriod, currentPeriod, ledgerId) => {
          const ledger = this.ledgers.find((item) => item.id === Number(ledgerId))
          if (!ledger) {
            return { lastInsertRowid: 0, changes: 0 }
          }
          ledger.start_period = String(startPeriod)
          ledger.current_period = String(currentPeriod)
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)') {
      return {
        get: () => undefined,
        run: (ledgerId, period) => {
          const exists = this.periods.some(
            (item) => item.ledger_id === Number(ledgerId) && item.period === String(period)
          )
          if (!exists) {
            this.periods.push({
              ledger_id: Number(ledgerId),
              period: String(period)
            })
          }
          return { lastInsertRowid: 0, changes: exists ? 0 : 1 }
        }
      }
    }

    if (normalized === 'SELECT id FROM ledgers WHERE id = ?') {
      return {
        get: (ledgerId) => this.ledgers.find((item) => item.id === Number(ledgerId)),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT COUNT(1) AS count FROM vouchers WHERE ledger_id = ?') {
      return {
        get: (ledgerId) => ({
          count: this.voucherCountByLedger.get(Number(ledgerId)) ?? 0
        }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT COUNT(1) AS count FROM initial_balances WHERE ledger_id = ? AND (debit_amount <> 0 OR credit_amount <> 0)'
    ) {
      return {
        get: (ledgerId) => ({
          count: this.nonZeroInitialBalanceCountByLedger.get(Number(ledgerId)) ?? 0
        }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'DELETE FROM cash_flow_mappings WHERE ledger_id = ?') {
      return this.createDeleteRecorder('cash_flow_mappings')
    }

    if (normalized === 'DELETE FROM cash_flow_items WHERE ledger_id = ? AND is_system = 1') {
      return this.createDeleteRecorder('cash_flow_items')
    }

    if (normalized === 'DELETE FROM pl_carry_forward_rules WHERE ledger_id = ?') {
      return this.createDeleteRecorder('pl_carry_forward_rules')
    }

    if (normalized === 'DELETE FROM subjects WHERE ledger_id = ?') {
      return this.createDeleteRecorder('subjects')
    }

    if (normalized === 'UPDATE ledgers SET standard_type = ? WHERE id = ?') {
      return {
        get: () => undefined,
        run: (standardType, ledgerId) => {
          const ledger = this.ledgers.find((item) => item.id === Number(ledgerId))
          if (!ledger) {
            return { lastInsertRowid: 0, changes: 0 }
          }
          ledger.standard_type = String(standardType) as 'enterprise' | 'npo'
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT * FROM ledgers WHERE id = ?') {
      return {
        get: (ledgerId) => this.ledgers.find((item) => item.id === Number(ledgerId)),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT COUNT(1) AS count FROM subjects WHERE ledger_id = ?') {
      return {
        get: (ledgerId) => ({
          count: this.subjectCountByLedger.get(Number(ledgerId)) ?? 0
        }),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    throw new Error(`Unhandled SQL in FakeLedgerLifecycleDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }

  private createDeleteRecorder(table: string): {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    return {
      get: () => undefined,
      run: (ledgerId) => {
        this.deletedModules.push({ table, ledgerId: Number(ledgerId) })
        return { lastInsertRowid: 0, changes: 1 }
      }
    }
  }
}

function createDependencies(
  db: FakeLedgerLifecycleDb,
  customSubjectCount = 2
): LedgerLifecycleDependencies {
  return {
    seedSubjectsForLedger: vi.fn((_db, ledgerId) => {
      db.subjectCountByLedger.set(ledgerId, 100)
    }),
    seedCashFlowItemsForLedger: vi.fn(),
    seedCashFlowMappingsForLedger: vi.fn(),
    seedPLCarryForwardRulesForLedger: vi.fn(),
    applyCustomTopLevelSubjectTemplate: vi.fn((_db, ledgerId) => {
      db.subjectCountByLedger.set(
        ledgerId,
        (db.subjectCountByLedger.get(ledgerId) ?? 0) + customSubjectCount
      )
      return customSubjectCount
    }),
    grantUserLedgerAccess: vi.fn()
  }
}

describe('ledgerLifecycle service', () => {
  it('creates ledger with seeded setup and grants access for non-admin user', () => {
    const db = new FakeLedgerLifecycleDb()
    const dependencies = createDependencies(db, 3)

    const result = createLedgerWithTemplate(
      db as never,
      {
        name: '  新账套  ',
        standardType: 'enterprise',
        startPeriod: '2026-03',
        operatorUserId: 8,
        operatorIsAdmin: false
      },
      dependencies
    )

    expect(result).toEqual({
      ledgerId: 1,
      normalizedName: '新账套',
      customSubjectCount: 3
    })
    expect(db.ledgers[0]).toMatchObject({
      id: 1,
      name: '新账套',
      standard_type: 'enterprise',
      start_period: '2026-03',
      current_period: '2026-03'
    })
    expect(db.periods).toContainEqual({ ledger_id: 1, period: '2026-03' })
    expect(dependencies.grantUserLedgerAccess).toHaveBeenCalledWith(db, 8, 1)
  })

  it('updates ledger name and current period while lowering start period when needed', () => {
    const db = new FakeLedgerLifecycleDb()
    db.ledgers.push({
      id: 1,
      name: '旧账套',
      standard_type: 'enterprise',
      start_period: '2026-03',
      current_period: '2026-03',
      created_at: '2026-03-19 12:00:00'
    })

    const result = updateLedgerConfiguration(db as never, {
      ledgerId: 1,
      name: '新账套',
      currentPeriod: '2026-01'
    })

    expect(result).toEqual({
      normalizedName: '新账套',
      currentPeriod: '2026-01',
      nextStartPeriod: '2026-01'
    })
    expect(db.ledgers[0]).toMatchObject({
      name: '新账套',
      start_period: '2026-01',
      current_period: '2026-01'
    })
    expect(db.periods).toContainEqual({ ledger_id: 1, period: '2026-01' })
  })

  it('refuses to apply template when business data already exists', () => {
    const db = new FakeLedgerLifecycleDb()
    db.ledgers.push({
      id: 1,
      name: '旧账套',
      standard_type: 'enterprise',
      start_period: '2026-03',
      current_period: '2026-03',
      created_at: '2026-03-19 12:00:00'
    })
    db.voucherCountByLedger.set(1, 2)

    expect(() =>
      applyLedgerStandardTemplate(
        db as never,
        {
          ledgerId: 1,
          standardType: 'npo'
        },
        createDependencies(db)
      )
    ).toThrow('账套已有业务数据，暂不允许切换会计准则模板')
  })

  it('applies standard template by clearing old setup and reseeding new setup', () => {
    const db = new FakeLedgerLifecycleDb()
    db.ledgers.push({
      id: 1,
      name: '旧账套',
      standard_type: 'enterprise',
      start_period: '2026-03',
      current_period: '2026-03',
      created_at: '2026-03-19 12:00:00'
    })
    const dependencies = createDependencies(db, 4)

    const result = applyLedgerStandardTemplate(
      db as never,
      {
        ledgerId: 1,
        standardType: 'npo'
      },
      dependencies
    )

    expect(result.subjectCount).toBe(104)
    expect(result.customSubjectCount).toBe(4)
    expect(result.updatedLedger).toMatchObject({
      id: 1,
      standard_type: 'npo'
    })
    expect(db.deletedModules).toEqual([
      { table: 'cash_flow_mappings', ledgerId: 1 },
      { table: 'cash_flow_items', ledgerId: 1 },
      { table: 'pl_carry_forward_rules', ledgerId: 1 },
      { table: 'subjects', ledgerId: 1 }
    ])
    expect(dependencies.seedSubjectsForLedger).toHaveBeenCalledWith(db, 1, 'npo')
  })
})

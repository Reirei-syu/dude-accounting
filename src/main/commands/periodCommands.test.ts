import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const periodCommandMocks = vi.hoisted(() => ({
  appendOperationLog: vi.fn(),
  appendActorOperationLog: vi.fn(),
  assertPLCarryForwardCompleted: vi.fn()
}))

vi.mock('../services/auditLog', () => ({
  appendOperationLog: periodCommandMocks.appendOperationLog
}))

vi.mock('../services/plCarryForward', () => ({
  assertPLCarryForwardCompleted: periodCommandMocks.assertPLCarryForwardCompleted,
  executePLCarryForward: vi.fn(),
  listPLCarryForwardRules: vi.fn(),
  previewPLCarryForward: vi.fn(),
  savePLCarryForwardRules: vi.fn()
}))

vi.mock('./operationLog', () => ({
  appendActorOperationLog: periodCommandMocks.appendActorOperationLog
}))

import { closePeriodCommand, reopenPeriodCommand } from './periodCommands'
import type { CommandContext } from './types'

let db: Database.Database

function createContext(): CommandContext {
  const context: CommandContext = {
    db,
    runtime: {} as CommandContext['runtime'],
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli'
    },
    outputMode: 'json',
    now: new Date('2026-08-27T00:00:00.000Z')
  }
  authenticateMockContext({ db: context.db, actor: context.actor! })
  return context
}

function insertLedger(currentPeriod: string): void {
  db.prepare(
    `INSERT INTO ledgers (id, name, start_period, current_period)
     VALUES (5, '千千结账套', '2026-01', ?)`
  ).run(currentPeriod)
}

describe('periodCommands current period synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE pl_carry_forward_rules (
        id INTEGER PRIMARY KEY, ledger_id INTEGER, from_subject_code TEXT, to_subject_code TEXT
      );
      CREATE TABLE ledgers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        start_period TEXT NOT NULL,
        current_period TEXT NOT NULL
      );
      CREATE TABLE periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        period TEXT NOT NULL,
        is_closed INTEGER NOT NULL DEFAULT 0,
        closed_at TEXT,
        UNIQUE (ledger_id, period)
      );
      CREATE TABLE vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL,
        period TEXT NOT NULL,
        voucher_date TEXT NOT NULL,
        voucher_number INTEGER NOT NULL,
        voucher_word TEXT NOT NULL,
        status INTEGER NOT NULL
      );
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('advances a stale ledger current period in the same transaction as closing', async () => {
    insertLedger('2026-06')
    db.prepare('INSERT INTO periods (ledger_id, period) VALUES (?, ?)').run(5, '2026-07')

    const result = await closePeriodCommand(createContext(), {
      ledgerId: 5,
      period: '2026-07'
    })

    expect(result).toMatchObject({
      status: 'success',
      data: {
        nextPeriod: '2026-08'
      }
    })
    expect(db.prepare('SELECT current_period FROM ledgers WHERE id = ?').get(5)).toEqual({
      current_period: '2026-08'
    })
    expect(
      db.prepare('SELECT period, is_closed FROM periods WHERE ledger_id = ? ORDER BY period').all(5)
    ).toEqual([
      { period: '2026-07', is_closed: 1 },
      { period: '2026-08', is_closed: 0 }
    ])
  })

  it('repairs current period when the requested close is already complete without moving a later period backwards', async () => {
    insertLedger('2026-06')
    db.prepare(
      `INSERT INTO periods (ledger_id, period, is_closed, closed_at)
       VALUES (?, ?, 1, '2026-08-04 07:31:04')`
    ).run(5, '2026-07')

    await closePeriodCommand(createContext(), { ledgerId: 5, period: '2026-07' })
    expect(db.prepare('SELECT current_period FROM ledgers WHERE id = ?').get(5)).toEqual({
      current_period: '2026-08'
    })
    expect(
      db
        .prepare('SELECT is_closed, closed_at FROM periods WHERE ledger_id = ? AND period = ?')
        .get(5, '2026-07')
    ).toEqual({ is_closed: 1, closed_at: '2026-08-04 07:31:04' })

    db.prepare('UPDATE ledgers SET current_period = ? WHERE id = ?').run('2026-09', 5)
    await closePeriodCommand(createContext(), { ledgerId: 5, period: '2026-07' })
    expect(db.prepare('SELECT current_period FROM ledgers WHERE id = ?').get(5)).toEqual({
      current_period: '2026-09'
    })
  })

  it('moves current period back to the period reopened for editing', async () => {
    insertLedger('2026-08')
    db.prepare(
      `INSERT INTO periods (ledger_id, period, is_closed, closed_at)
       VALUES (?, ?, 1, '2026-08-04 07:31:04')`
    ).run(5, '2026-07')
    db.prepare('INSERT INTO periods (ledger_id, period) VALUES (?, ?)').run(5, '2026-08')

    const result = await reopenPeriodCommand(createContext(), {
      ledgerId: 5,
      period: '2026-07'
    })

    expect(result).toMatchObject({
      status: 'success',
      data: {
        period: '2026-07'
      }
    })
    expect(db.prepare('SELECT current_period FROM ledgers WHERE id = ?').get(5)).toEqual({
      current_period: '2026-07'
    })
    expect(
      db
        .prepare('SELECT is_closed, closed_at FROM periods WHERE ledger_id = ? AND period = ?')
        .get(5, '2026-07')
    ).toEqual({ is_closed: 0, closed_at: null })
  })
})
import { authenticateMockContext } from './testSupport/sessionContext'

import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createHistoricalFixture } from './migrationFixtures'
import { runDatabaseMigrations } from './migrations'

it('历史账套补充税号字段且保留原资料', () => {
  const db = new Database(':memory:')
  try {
    createHistoricalFixture(db, 'minimal')
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT id,name,taxpayer_identification_number FROM ledgers').get())
      .toEqual({ id: 7, name: '历史账套', taxpayer_identification_number: '' })
  } finally { db.close() }
})

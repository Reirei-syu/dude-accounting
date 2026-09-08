import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createHistoricalFixture } from './migrationFixtures'
import { runDatabaseMigrations } from './migrations'

it('仅首次迁移缺失权限表时回填普通用户，不在重启时扩大权限', () => {
  const db = new Database(':memory:')
  try {
    createHistoricalFixture(db, 'minimal')
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT user_id,ledger_id FROM user_ledger_permissions').all()).toEqual([{ user_id: 2, ledger_id: 7 }])
    db.exec('DELETE FROM user_ledger_permissions')
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT * FROM user_ledger_permissions').all()).toEqual([])
  } finally { db.close() }
})

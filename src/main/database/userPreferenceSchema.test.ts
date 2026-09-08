import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createHistoricalFixture } from './migrationFixtures'
import { runDatabaseMigrations } from './migrations'

it('历史库创建用户偏好表并保留后续写入', () => {
  const db = new Database(':memory:')
  try {
    createHistoricalFixture(db, 'minimal')
    runDatabaseMigrations(db)
    db.prepare('INSERT INTO user_preferences(user_id,key,value) VALUES(2,?,?)').run('theme','dark')
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT value FROM user_preferences WHERE user_id=2').get()).toEqual({ value: 'dark' })
  } finally { db.close() }
})

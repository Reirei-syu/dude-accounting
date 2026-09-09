import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createCurrentSchema } from './schema'
import { runDatabaseMigrations } from './migrations'

describe('授权版本迁移', () => {
  it('版本 2 升级后为既有用户设置 revision 1，幂等启动', () => {
    const db = new Database(':memory:')
    try {
      createCurrentSchema(db, 2)
      db.exec("PRAGMA user_version=2; INSERT INTO users(username) VALUES('alice')")
      expect(runDatabaseMigrations(db).applied).toEqual([3, 4, 5, 6])
      expect(db.prepare('SELECT auth_revision, is_enabled FROM users').get()).toEqual({
        auth_revision: 1,
        is_enabled: 1
      })
      expect(runDatabaseMigrations(db).applied).toEqual([])
    } finally {
      db.close()
    }
  })
  it('迁移提交失败保持原版本和原结构', () => {
    const db = new Database(':memory:')
    try {
      createCurrentSchema(db, 2)
      db.pragma('user_version=2')
      expect(() =>
        runDatabaseMigrations(db, {
          checkpoint: () => {
            throw new Error('模拟失败')
          }
        })
      ).toThrow('模拟失败')
      expect(db.pragma('user_version', { simple: true })).toBe(2)
      expect(() => db.prepare('SELECT auth_revision FROM users')).toThrow()
      expect(runDatabaseMigrations(db).applied).toEqual([3, 4, 5, 6])
    } finally {
      db.close()
    }
  })
  it.each(['username', 'password_hash', 'permissions', 'is_admin', 'is_enabled'])(
    '安全字段 %s 变更同事务撤销会话',
    (field) => {
      const db = new Database(':memory:')
      try {
        runDatabaseMigrations(db)
        db.exec("INSERT INTO users(id,username) VALUES(1,'alice')")
        db.prepare('INSERT INTO auth_sessions VALUES(?,1,1,?)').run('a'.repeat(64), '2026-09-08')
        const next = field === 'is_admin' ? 1 : field === 'is_enabled' ? 0 : 'changed'
        db.prepare(`UPDATE users SET ${field}=? WHERE id=1`).run(next)
        expect(db.prepare('SELECT auth_revision FROM users').get()).toEqual({ auth_revision: 2 })
        expect(db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({
          count: 0
        })
      } finally {
        db.close()
      }
    }
  )
  it('普通姓名变更不撤销，回滚安全变更也回滚 revision', () => {
    const db = new Database(':memory:')
    try {
      runDatabaseMigrations(db)
      db.exec(
        "INSERT INTO users(id,username) VALUES(1,'alice'); UPDATE users SET real_name='新姓名' WHERE id=1"
      )
      expect(db.prepare('SELECT auth_revision FROM users').get()).toEqual({ auth_revision: 1 })
      db.exec('BEGIN; UPDATE users SET is_enabled=0 WHERE id=1; ROLLBACK')
      expect(db.prepare('SELECT auth_revision,is_enabled FROM users').get()).toEqual({
        auth_revision: 1,
        is_enabled: 1
      })
    } finally {
      db.close()
    }
  })
})

import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import {
  issueSession,
  resolveSessionActor,
  revokeSession,
  SESSION_DENIED_MESSAGE
} from './sessionAuthority'

describe('每请求会话授权', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys=ON')
    runDatabaseMigrations(db)
    db.exec(
      `INSERT INTO users(id,username,permissions) VALUES(1,'alice','{"audit":true}'),(2,'bob','{}')`
    )
  })
  afterEach(() => {
    if (db.open) db.close()
  })
  it.each([
    "UPDATE users SET permissions='{}' WHERE id=1",
    'UPDATE users SET is_admin=1 WHERE id=1',
    "UPDATE users SET password_hash='changed' WHERE id=1",
    'UPDATE users SET is_enabled=0 WHERE id=1',
    'DELETE FROM users WHERE id=1'
  ])('变更后所有 CLI/IPC 会话同时失效：%s', (sql) => {
    const sessions = [issueSession(db, 1), issueSession(db, 1), issueSession(db, 1)]
    expect(resolveSessionActor(db, sessions[0], 'cli').permissions.audit).toBe(true)
    db.exec(sql)
    for (const session of sessions)
      for (const source of ['cli', 'ipc'] as const) {
        expect(() => resolveSessionActor(db, session, source)).toThrow(SESSION_DENIED_MESSAGE)
      }
  })
  it('普通资料变更保持会话，注销仅撤销指定会话', () => {
    const first = issueSession(db, 1)
    const second = issueSession(db, 1)
    expect(first.token).not.toBe(second.token)
    db.exec("UPDATE users SET real_name='新姓名' WHERE id=1")
    expect(resolveSessionActor(db, first, 'ipc').id).toBe(1)
    revokeSession(db, first)
    expect(() => resolveSessionActor(db, first, 'ipc')).toThrow(SESSION_DENIED_MESSAGE)
    expect(resolveSessionActor(db, second, 'cli').id).toBe(1)
  })
  it('篡改身份、版本、时间或随机标识不能冒用授权', () => {
    const session = issueSession(db, 1)
    for (const tampered of [
      { ...session, userId: 2 },
      { ...session, authRevision: 999 },
      { ...session, token: 'f'.repeat(64) },
      { ...session, createdAt: '2000-01-01' },
      null,
      { actor: { isAdmin: true } }
    ]) {
      expect(() => resolveSessionActor(db, tampered, 'cli')).toThrow(SESSION_DENIED_MESSAGE)
    }
  })
  it('数据库不可用时失败关闭', () => {
    const session = issueSession(db, 1)
    db.close()
    expect(() => resolveSessionActor(db, session, 'ipc')).toThrow(SESSION_DENIED_MESSAGE)
  })
  it('撤销账套访问权后所有旧会话均失效', () => {
    db.exec(
      "INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'测试账套','2026-01','2026-01'); INSERT INTO user_ledger_permissions(user_id,ledger_id) VALUES(1,1)"
    )
    const sessions = [issueSession(db, 1), issueSession(db, 1)]
    db.exec('DELETE FROM user_ledger_permissions WHERE user_id=1 AND ledger_id=1')
    for (const session of sessions)
      for (const source of ['cli', 'ipc'] as const)
        expect(() => resolveSessionActor(db, session, source)).toThrow(SESSION_DENIED_MESSAGE)
  })
})

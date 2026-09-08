import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { hashPassword } from '../security/password'
import { SESSION_DENIED_MESSAGE } from '../security/sessionAuthority'
import { resolveSessionActor, revokeSession } from '../security/sessionAuthority'
import { createBackupArtifact, restoreBackupArtifact } from '../services/backupRecovery'
import { loginCommand, updateUserCommand, whoamiCommand, deleteUserCommand } from './authCommands'
import type { CommandActor, CommandContext } from './types'
import type { RuntimeContext } from '../runtime/runtimeContext'

describe('真实命令会话即时失效', () => {
  let db: Database.Database
  const context = (actor: CommandActor | null = null): CommandContext => ({
    db,
    actor,
    runtime: {} as RuntimeContext,
    outputMode: 'json',
    now: new Date()
  })
  const login = async (username: string): Promise<CommandActor> => {
    const result = await loginCommand(context(), { username, password: 'secret' })
    if (result.status !== 'success' || !result.data) throw new Error(JSON.stringify(result.error))
    return result.data.actor
  }
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys=ON')
    runDatabaseMigrations(db)
    const insert = db.prepare(
      'INSERT INTO users(id,username,password_hash,is_admin,permissions) VALUES(?,?,?,?,?)'
    )
    insert.run(1, 'admin', hashPassword('secret'), 1, '{}')
    insert.run(2, 'user', hashPassword('secret'), 0, '{"audit":true}')
  })
  afterEach(() => db.close())
  it.each([{ permissions: {} }, { isAdmin: true }, { password: 'changed' }, { isEnabled: false }])(
    '安全修改 %j 使全部旧命令身份失效',
    async (change) => {
      const admin = await login('admin')
      const first = await login('user')
      const second = await login('user')
      second.source = 'ipc'
      expect((await updateUserCommand(context(admin), { id: 2, ...change })).status).toBe('success')
      for (const actor of [first, second])
        expect((await whoamiCommand(context(actor))).error).toMatchObject({
          code: 'UNAUTHORIZED',
          message: SESSION_DENIED_MESSAGE,
          details: null
        })
    }
  )
  it('普通资料修改保留会话，删除用户后拒绝旧身份', async () => {
    const admin = await login('admin')
    const user = await login('user')
    expect((await updateUserCommand(context(admin), { id: 2, realName: '新姓名' })).status).toBe(
      'success'
    )
    expect((await whoamiCommand(context(user))).status).toBe('success')
    expect((await deleteUserCommand(context(admin), { userId: 2 })).status).toBe('success')
    expect((await whoamiCommand(context(user))).error?.message).toBe(SESSION_DENIED_MESSAGE)
  })
  it('未登记的缓存管理员 actor 不能绕过命令入口', async () => {
    const result = await updateUserCommand(
      context({ id: 1, username: 'admin', isAdmin: true, permissions: {}, source: 'cli' }),
      { id: 2, isAdmin: true }
    )
    expect(result.error?.message).toBe(SESSION_DENIED_MESSAGE)
    expect(db.prepare('SELECT is_admin FROM users WHERE id=2').get()).toEqual({ is_admin: 0 })
  })
  it('恢复旧备份不能复活已注销的管理员会话', async () => {
    const actor = await login('admin')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-auth-restore-'))
    try {
      const source = path.join(root, 'snapshot.db')
      const target = path.join(root, 'target.db')
      db.prepare('VACUUM INTO ?').run(source)
      const backup = createBackupArtifact({
        sourcePath: source,
        backupDir: path.join(root, 'backups'),
        ledgerId: 1
      })
      revokeSession(db, actor.session!)
      expect(() => resolveSessionActor(db, actor.session, 'cli')).toThrow(SESSION_DENIED_MESSAGE)
      db.prepare('VACUUM INTO ?').run(target)
      restoreBackupArtifact({
        backupPath: backup.backupPath,
        manifestPath: backup.manifestPath,
        expectedChecksum: backup.checksum,
        targetPath: target
      })
      const restored = new Database(target)
      try {
        expect(() => resolveSessionActor(restored, actor.session, 'ipc')).toThrow(
          SESSION_DENIED_MESSAGE
        )
        expect(restored.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({
          count: 0
        })
      } finally {
        restored.close()
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it.each([false, true])('读取密码时并发重置被串行化，明文升级=%s', async (legacy) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-login-race-'))
    const file = path.join(root, 'database.db')
    db.prepare('VACUUM INTO ?').run(file)
    const first = new Database(file)
    const second = new Database(file, { timeout: 0 })
    try {
      if (legacy) first.prepare('UPDATE users SET password_hash=? WHERE id=1').run('secret')
      let blocked = false
      const prepare = first.prepare.bind(first)
      const spy = vi.spyOn(first, 'prepare').mockImplementation((sql: string) => {
        const statement = prepare(sql)
        if (sql === 'SELECT password_hash FROM users WHERE id = ?') {
          const get = statement.get.bind(statement)
          vi.spyOn(statement, 'get').mockImplementation((...args: unknown[]) => {
            const value = get(...args)
            try {
              second
                .prepare('UPDATE users SET password_hash=? WHERE id=1')
                .run(hashPassword('new-password'))
            } catch (error) {
              blocked = (error as { code?: string }).code === 'SQLITE_BUSY'
            }
            return value
          })
        }
        return statement
      })
      const result = await loginCommand(
        { ...context(), db: first },
        { username: 'admin', password: 'secret' }
      )
      spy.mockRestore()
      expect(blocked).toBe(true)
      expect(result.status).toBe('success')
      second
        .prepare('UPDATE users SET password_hash=? WHERE id=1')
        .run(hashPassword('new-password'))
      expect(() => resolveSessionActor(first, result.data?.actor.session, 'cli')).toThrow(
        SESSION_DENIED_MESSAGE
      )
      expect(
        (await loginCommand({ ...context(), db: first }, { username: 'admin', password: 'secret' }))
          .status
      ).toBe('error')
    } finally {
      vi.restoreAllMocks()
      first.close()
      second.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

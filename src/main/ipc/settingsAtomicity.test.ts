import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'

const fixture = vi.hoisted(() => ({
  db: null as unknown,
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => 'D:/isolated-audit-test' },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(name, handler)
  },
  BrowserWindow: {},
  dialog: {},
  shell: {}
}))
vi.mock('../database/init', () => ({ getDatabase: () => fixture.db }))
vi.mock('./session', () => ({
  requireAuth: () => ({ id: 1, username: 'admin' }),
  requireAdmin: () => ({ id: 1, username: 'admin' }),
  requirePermission: () => ({ id: 1, username: 'admin' })
}))
import { registerSettingsHandlers } from './settings'

describe('设置 IPC 真实数据库审计原子性', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runDatabaseMigrations(db)
    db.exec("INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1)")
    fixture.db = db
    fixture.handlers.clear()
    registerSettingsHandlers()
  })
  afterEach(() => db.close())
  const event = { sender: { id: 1 } }
  function call(name: string, ...args: unknown[]): unknown {
    return fixture.handlers.get(`settings:${name}`)!(event, ...args)
  }
  it('系统参数日志失败回滚，成功一次与重试无重复日志', () => {
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(call('setSystemParam', 'default_voucher_word', '转')).toEqual({
      success: false,
      error: 'audit failed'
    })
    expect(
      db.prepare("SELECT * FROM system_settings WHERE key='default_voucher_word'").all()
    ).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(call('setSystemParam', 'default_voucher_word', '转')).toMatchObject({ success: true })
    expect(call('setSystemParam', 'default_voucher_word', '转')).toMatchObject({ changed: false })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('偏好多键写入失败一起回滚，重复值不新增日志', () => {
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(() => call('setUserPreferences', { a: '1', b: '2' })).toThrow('audit failed')
    expect(db.prepare('SELECT * FROM user_preferences').all()).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(call('setUserPreferences', { a: '1', b: '2' })).toEqual({ success: true })
    expect(call('setUserPreferences', { a: '1', b: '2' })).toEqual({ success: true })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('模板保存失败回滚，已清空模板不重复记录成功日志', () => {
    const payload = {
      standardType: 'npo',
      entries: [{ code: '1001', name: '现金', category: 'asset', balanceDirection: 1 }]
    }
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(call('saveSubjectTemplate', payload)).toMatchObject({
      success: false,
      error: 'audit failed'
    })
    expect(db.prepare('SELECT * FROM system_settings').all()).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(call('saveSubjectTemplate', payload)).toMatchObject({ success: true })
    expect(call('clearSubjectTemplate', 'npo')).toEqual({ success: true })
    expect(call('clearSubjectTemplate', 'npo')).toEqual({ success: true })
    expect(db.prepare('SELECT action FROM operation_logs ORDER BY id').all()).toEqual([
      { action: 'save_subject_template' },
      { action: 'clear_subject_template' }
    ])
  })
})

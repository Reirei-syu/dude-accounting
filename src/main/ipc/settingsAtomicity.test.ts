import Database from 'better-sqlite3'
import path from 'node:path'
import {
  createNodeRuntimeContext,
  setRuntimeContext,
  clearRuntimeContext
} from '../runtime/runtimeContext'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import type { CommandActor } from '../commands/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'

const fixture = vi.hoisted(() => ({
  db: null as unknown,
  actor: null as CommandActor | null,
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
  getSessionByEvent: () =>
    fixture.actor
      ? resolveSessionActor(fixture.db as Database.Database, fixture.actor.session, 'ipc')
      : null,
  requireAuth: () => ({ id: 1, username: 'admin' }),
  requireAdmin: () => ({ id: 1, username: 'admin' }),
  requirePermission: () => ({ id: 1, username: 'admin' })
}))
import { registerSettingsHandlers } from './settings'
import {
  getSystemParamsCommand,
  getUserPreferencesCommand,
  getSubjectTemplateCommand,
  listCustomTemplatesCommand
} from '../commands/settingsCommands'
import { createCommandContext } from '../commands/context'

describe('设置 IPC 真实数据库审计原子性', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    runDatabaseMigrations(db)
    db.exec("INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1)")
    fixture.db = db
    fixture.actor = resolveSessionActor(db, issueSession(db, 1), 'ipc')
    setRuntimeContext(
      createNodeRuntimeContext({ userDataPath: path.resolve('.tmp/settings-atomicity') })
    )
    fixture.handlers.clear()
    registerSettingsHandlers()
  })
  afterEach(() => {
    db.close()
    clearRuntimeContext()
  })
  const event = { sender: { id: 1 } }
  function call(name: string, ...args: unknown[]): unknown {
    return fixture.handlers.get(`settings:${name}`)!(event, ...args)
  }
  it('GUI与CLI使用同一权限规则拒绝无系统设置权限的用户', async () => {
    db.exec("INSERT INTO users(id,username,is_admin) VALUES(2,'limited',0)")
    fixture.actor = resolveSessionActor(db, issueSession(db, 2), 'ipc')
    const command = await getSystemParamsCommand(
      createCommandContext({ db, actor: { ...fixture.actor, source: 'cli' } })
    )
    expect(command.status).toBe('error')
    expect(command.error?.code).toBe('FORBIDDEN')
    await expect(call('getSystemParams')).rejects.toThrow(command.error!.message)
    await expect(call('getErrorLogStatus')).rejects.toThrow(command.error!.message)
  })
  it('登录页仍可免登录读取公共壁纸，但不能读取用户偏好', async () => {
    fixture.actor = null
    expect(await call('getLoginWallpaperState')).toBeTruthy()
    await expect(call('getUserPreferences')).rejects.toThrow('登录态已失效')
  })
  it('不存在的独立模板仍返回合法空结果', async () => {
    expect(await call('getIndependentCustomSubjectTemplate', 'missing-template')).toBeNull()
  })
  it.each([
    ['applyWallpaperCrop', { extension: 'png', bytes: [] }],
    ['restoreDefaultWallpaper', undefined],
    ['restoreDefaultDiagnosticsLogDirectory', undefined],
    ['openErrorLogDirectory', undefined],
    ['saveSubjectTemplate', { standardType: 'npo', entries: [] }],
    [
      'saveIndependentCustomSubjectTemplate',
      { baseStandardType: 'npo', templateName: 'test', entries: [] }
    ],
    ['clearSubjectTemplate', 'npo'],
    ['clearIndependentCustomSubjectTemplateEntries', 'missing'],
    ['deleteIndependentCustomSubjectTemplate', 'missing']
  ])('撤销会话后 %s 仍返回GUI错误对象而非拒绝Promise', async (name, payload) => {
    db.exec('DELETE FROM auth_sessions')
    await expect(call(String(name), payload)).resolves.toMatchObject({
      success: false,
      error: '登录态已失效或无权访问，请重新登录'
    })
  })
  it('查询入口与CLI共用实际数据库及返回内容', async () => {
    db.prepare('INSERT INTO user_preferences(user_id,key,value) VALUES(1,?,?)').run(
      'default_ledger_id',
      '7'
    )
    const context = createCommandContext({ db, actor: { ...fixture.actor!, source: 'cli' } })
    expect(await call('getUserPreferences')).toEqual(
      (await getUserPreferencesCommand(context)).data
    )
    expect(await call('getSystemParams')).toEqual((await getSystemParamsCommand(context)).data)
    expect(await call('getSubjectTemplate', 'npo')).toEqual(
      (await getSubjectTemplateCommand(context, { standardType: 'npo' })).data
    )
    expect(await call('listIndependentCustomSubjectTemplates')).toEqual(
      (await listCustomTemplatesCommand(context)).data
    )
  })
  it('系统参数日志失败回滚，成功一次与重试无重复日志', async () => {
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(await call('setSystemParam', 'default_voucher_word', '转')).toEqual({
      success: false,
      error: 'audit failed'
    })
    expect(
      db.prepare("SELECT * FROM system_settings WHERE key='default_voucher_word'").all()
    ).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(await call('setSystemParam', 'default_voucher_word', '转')).toMatchObject({
      success: true
    })
    expect(await call('setSystemParam', 'default_voucher_word', '转')).toMatchObject({
      changed: false
    })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('偏好多键写入失败一起回滚，重复值不新增日志', async () => {
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    await expect(call('setUserPreferences', { a: '1', b: '2' })).rejects.toThrow('audit failed')
    expect(db.prepare('SELECT * FROM user_preferences').all()).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(await call('setUserPreferences', { a: '1', b: '2' })).toEqual({ success: true })
    expect(await call('setUserPreferences', { a: '1', b: '2' })).toEqual({ success: true })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('模板保存失败回滚，已清空模板不重复记录成功日志', async () => {
    const payload = {
      standardType: 'npo',
      entries: [{ code: '1001', name: '现金', category: 'asset', balanceDirection: 1 }]
    }
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(await call('saveSubjectTemplate', payload)).toMatchObject({
      success: false,
      error: 'audit failed'
    })
    expect(db.prepare('SELECT * FROM system_settings').all()).toHaveLength(0)
    db.exec('DROP TRIGGER fail_audit')
    expect(await call('saveSubjectTemplate', payload)).toMatchObject({ success: true })
    expect(await call('clearSubjectTemplate', 'npo')).toEqual({ success: true })
    expect(await call('clearSubjectTemplate', 'npo')).toEqual({ success: true })
    expect(db.prepare('SELECT action FROM operation_logs ORDER BY id').all()).toEqual([
      { action: 'save_subject_template' },
      { action: 'clear_subject_template' }
    ])
  })
})

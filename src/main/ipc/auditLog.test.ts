import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import {
  createNodeRuntimeContext,
  setRuntimeContext,
  clearRuntimeContext
} from '../runtime/runtimeContext'

const fixture = vi.hoisted(() => ({
  db: null as unknown,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  choose: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePath: string }>>()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      fixture.handlers.set(name, handler)
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: fixture.choose }
}))
vi.mock('../database/init', () => ({ getDatabase: () => fixture.db }))
import { registerAuditLogHandlers } from './auditLog'
import { setSessionByEvent, clearSessionByEvent } from './session'

describe('操作日志 IPC 导出会话绑定', () => {
  let db: Database.Database
  let root: string
  const event = { sender: { id: 892, once: () => undefined } } as unknown as IpcMainInvokeEvent
  beforeEach(() => {
    const base = path.resolve('.tmp/audit-log-ipc-tests')
    fs.mkdirSync(base, { recursive: true })
    root = fs.mkdtempSync(path.join(base, 'run-'))
    db = new Database(path.join(root, 'main.sqlite'))
    fixture.db = db
    runDatabaseMigrations(db)
    db.exec(
      "INSERT INTO users(id,username,is_admin) VALUES(1,'adminA',1),(2,'adminB',1),(3,'normal',0)"
    )
    setRuntimeContext(createNodeRuntimeContext({ userDataPath: root }))
    setSessionByEvent(event, resolveSessionActor(db, issueSession(db, 1), 'ipc'))
    fixture.choose.mockReset()
    fixture.handlers.clear()
    registerAuditLogHandlers()
  })
  afterEach(() => {
    clearSessionByEvent(event)
    db.close()
    clearRuntimeContext()
  })
  function call(payload: object): Promise<{ success: boolean; cancelled?: boolean }> {
    return fixture.handlers.get('auditLog:export')!(event, payload) as Promise<{
      success: boolean
      cancelled?: boolean
    }>
  }
  it.each([1, 2])('对话框挂起后换为用户%s的新会话，不能借用新权限或冒名留痕', async (userId) => {
    let finish!: (value: { canceled: boolean; filePath: string }) => void
    fixture.choose.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const target = path.join(root, 'denied.csv')
    const pending = call({ choosePath: true })
    await vi.waitFor(() => expect(fixture.choose).toHaveBeenCalledOnce())
    setSessionByEvent(event, resolveSessionActor(db, issueSession(db, userId), 'ipc'))
    finish({ canceled: false, filePath: target })
    expect((await pending).success).toBe(false)
    expect(fs.existsSync(target)).toBe(false)
    expect(db.prepare('SELECT count(*) AS n FROM operation_logs').get()).toEqual({ n: 0 })
  })
  it('取消不导出，未授权用户不能弹出保存对话框', async () => {
    fixture.choose.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await call({ choosePath: true })).toMatchObject({ success: false, cancelled: true })
    fixture.choose.mockClear()
    setSessionByEvent(event, resolveSessionActor(db, issueSession(db, 3), 'ipc'))
    expect((await call({ choosePath: true })).success).toBe(false)
    expect(fixture.choose).not.toHaveBeenCalled()
    await expect(fixture.handlers.get('auditLog:list')!(event, {})).rejects.toThrow('管理员')
  })
})

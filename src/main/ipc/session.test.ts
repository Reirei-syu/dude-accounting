import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runDatabaseMigrations } from '../database/migrations'
import { issueSession, SESSION_DENIED_MESSAGE } from '../security/sessionAuthority'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('../database/init', () => ({ getDatabase: () => state.db }))
import {
  clearSessionByEvent,
  getSessionByEvent,
  requireAdmin,
  requireAuth,
  requireLedgerAccess,
  requirePermission,
  setSessionBySender,
  setSessionByEvent,
  type SessionUser
} from './session'

function createMockEvent(senderId: number): {
  sender: {
    id: number
    once: (eventName: string, listener: () => void) => void
  }
  destroy: () => void
} {
  let destroyedListener: (() => void) | null = null

  return {
    sender: {
      id: senderId,
      once: (eventName, listener) => {
        expect(eventName).toBe('destroyed')
        destroyedListener = listener
      }
    },
    destroy: () => {
      destroyedListener?.()
    }
  }
}

function createLedgerAccessDb(allowedPairs: Array<{ userId: number; ledgerId: number }>): {
  prepare: (sql: string) => {
    get: (userId: number, ledgerId: number) => { ok: 1 } | undefined
  }
} {
  return {
    prepare: (sql: string) => {
      expect(sql).toContain('FROM user_ledger_permissions')
      return {
        get: (userId: number, ledgerId: number) =>
          allowedPairs.some((pair) => pair.userId === userId && pair.ledgerId === ledgerId)
            ? { ok: 1 }
            : undefined
      }
    }
  }
}

describe('ipc session', () => {
  beforeEach(() => {
    state.db = new Database(':memory:')
    runDatabaseMigrations(state.db)
  })
  afterEach(() => state.db?.close())
  const authorize = (user: SessionUser): SessionUser => {
    state
      .db!.prepare('INSERT OR IGNORE INTO users(id,username,permissions,is_admin) VALUES(?,?,?,?)')
      .run(user.id, user.username, JSON.stringify(user.permissions), Number(user.isAdmin))
    return { ...user, session: issueSession(state.db!, user.id) }
  }
  it('stores and clears session by sender id', () => {
    const event = createMockEvent(1)
    const user: SessionUser = {
      id: 1,
      username: 'tester',
      permissions: { voucher_entry: true },
      isAdmin: false,
      source: 'ipc'
    }
    setSessionByEvent(event as never, authorize(user))
    expect(getSessionByEvent(event as never)?.username).toBe('tester')

    clearSessionByEvent(event as never)
    expect(getSessionByEvent(event as never)).toBeNull()
  })

  it('cleans up session automatically when the sender is destroyed', () => {
    const event = createMockEvent(9)
    const user: SessionUser = {
      id: 9,
      username: 'destroy-me',
      permissions: { voucher_entry: true },
      isAdmin: false,
      source: 'ipc'
    }

    setSessionByEvent(event as never, authorize(user))
    expect(getSessionByEvent(event as never)?.username).toBe('destroy-me')

    event.destroy()
    expect(getSessionByEvent(event as never)).toBeNull()
  })

  it('can attach an existing session to another sender such as print preview webContents', () => {
    const previewSender = createMockEvent(19)
    const previewEvent = createMockEvent(20)
    const user: SessionUser = {
      id: 19,
      username: 'preview-user',
      permissions: { voucher_entry: true, system_settings: true },
      isAdmin: false,
      source: 'ipc'
    }

    setSessionBySender(previewSender.sender, authorize(user))

    expect(getSessionByEvent({ sender: previewSender.sender } as never)?.username).toBe(
      'preview-user'
    )

    previewSender.destroy()
    expect(getSessionByEvent({ sender: previewSender.sender } as never)).toBeNull()

    setSessionByEvent(previewEvent as never, authorize(user))
    expect(getSessionByEvent(previewEvent as never)?.username).toBe('preview-user')
  })

  it('enforces auth and permission checks', () => {
    const event = createMockEvent(2)
    const user: SessionUser = {
      id: 2,
      username: 'normal',
      permissions: { voucher_entry: true },
      isAdmin: false,
      source: 'ipc'
    }
    setSessionByEvent(event as never, authorize(user))

    expect(requireAuth(event as never).id).toBe(2)
    expect(requirePermission(event as never, 'voucher_entry').id).toBe(2)
    expect(() => requirePermission(event as never, 'unbookkeep')).toThrow()
    expect(() => requirePermission(event as never, 'system_settings')).toThrow()
    expect(() => requireAdmin(event as never)).toThrow()
  })

  it('enforces ledger access checks for non-admin users and bypasses them for admins', () => {
    const regularEvent = createMockEvent(3)
    const regularUser: SessionUser = {
      id: 3,
      username: 'ledger-user',
      permissions: { voucher_entry: true },
      isAdmin: false,
      source: 'ipc'
    }
    setSessionByEvent(regularEvent as never, authorize(regularUser))

    const db = createLedgerAccessDb([{ userId: 3, ledgerId: 11 }])

    expect(requireLedgerAccess(regularEvent as never, db as never, 11).id).toBe(3)
    expect(() => requireLedgerAccess(regularEvent as never, db as never, 12)).toThrow()

    const adminEvent = createMockEvent(4)
    const adminUser: SessionUser = {
      id: 4,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'ipc'
    }
    setSessionByEvent(adminEvent as never, authorize(adminUser))

    expect(requireLedgerAccess(adminEvent as never, db as never, 999).id).toBe(4)
  })
  it('多个窗口同时撤销，不使用传入 actor 的权限快照', () => {
    const user = authorize({
      id: 30,
      username: 'multiple',
      permissions: { audit: true },
      isAdmin: false,
      source: 'ipc'
    })
    const events = [createMockEvent(30), createMockEvent(31)]
    for (const event of events) setSessionByEvent(event as never, user)
    user.isAdmin = true
    expect(() => requireAdmin(events[0] as never)).toThrow()
    state.db!.exec("UPDATE users SET permissions='{}' WHERE id=30")
    for (const event of events)
      expect(() => requireAuth(event as never)).toThrow(SESSION_DENIED_MESSAGE)
  })
})

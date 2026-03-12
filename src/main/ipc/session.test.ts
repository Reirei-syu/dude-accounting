import { describe, expect, it } from 'vitest'
import {
  clearSessionByEvent,
  getSessionByEvent,
  requireAdmin,
  requireAuth,
  requireLedgerAccess,
  requirePermission,
  setSessionByEvent,
  type SessionUser
} from './session'

function createMockEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
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
  it('stores and clears session by sender id', () => {
    const event = createMockEvent(1)
    const user: SessionUser = {
      id: 1,
      username: 'tester',
      permissions: { voucher_entry: true },
      isAdmin: false
    }
    setSessionByEvent(event as never, user)
    expect(getSessionByEvent(event as never)?.username).toBe('tester')

    clearSessionByEvent(event as never)
    expect(getSessionByEvent(event as never)).toBeNull()
  })

  it('enforces auth and permission checks', () => {
    const event = createMockEvent(2)
    const user: SessionUser = {
      id: 2,
      username: 'normal',
      permissions: { voucher_entry: true },
      isAdmin: false
    }
    setSessionByEvent(event as never, user)

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
      isAdmin: false
    }
    setSessionByEvent(regularEvent as never, regularUser)

    const db = createLedgerAccessDb([{ userId: 3, ledgerId: 11 }])

    expect(requireLedgerAccess(regularEvent as never, db as never, 11).id).toBe(3)
    expect(() => requireLedgerAccess(regularEvent as never, db as never, 12)).toThrow()

    const adminEvent = createMockEvent(4)
    const adminUser: SessionUser = {
      id: 4,
      username: 'admin',
      permissions: {},
      isAdmin: true
    }
    setSessionByEvent(adminEvent as never, adminUser)

    expect(requireLedgerAccess(adminEvent as never, db as never, 999).id).toBe(4)
  })
})

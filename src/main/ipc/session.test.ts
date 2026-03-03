import { describe, expect, it } from 'vitest'
import {
  clearSessionByEvent,
  getSessionByEvent,
  requireAdmin,
  requireAuth,
  requirePermission,
  setSessionByEvent,
  type SessionUser
} from './session'

function createMockEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
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
    expect(() => requirePermission(event as never, 'system_settings')).toThrow()
    expect(() => requireAdmin(event as never)).toThrow()
  })
})

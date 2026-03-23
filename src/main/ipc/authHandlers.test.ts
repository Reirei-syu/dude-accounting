import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()

  const users = [
    {
      id: 1,
      username: 'admin',
      real_name: '管理员',
      password_hash: '',
      permissions: '{}',
      is_admin: 1
    },
    {
      id: 2,
      username: 'user-a',
      real_name: '普通用户',
      password_hash: 'old-hash',
      permissions: '{}',
      is_admin: 0
    }
  ]

  const db = {
    prepare: vi.fn((sql: string) => {
      if (sql === 'SELECT id, is_admin FROM users WHERE id = ?') {
        return {
          get: (id: number) =>
            users.find((user) => user.id === id)
              ? {
                  id,
                  is_admin: users.find((user) => user.id === id)?.is_admin ?? 0
                }
              : undefined
        }
      }

      if (sql === 'UPDATE users SET password_hash = ? WHERE id = ?') {
        return {
          run: (passwordHash: string, id: number) => {
            const target = users.find((user) => user.id === id)
            if (target) {
              target.password_hash = passwordHash
            }
          }
        }
      }

      if (sql === 'UPDATE users SET real_name = ? WHERE id = ?') {
        return {
          run: (realName: string, id: number) => {
            const target = users.find((user) => user.id === id)
            if (target) {
              target.real_name = realName
            }
          }
        }
      }

      if (sql === 'UPDATE users SET permissions = ? WHERE id = ?') {
        return {
          run: (permissions: string, id: number) => {
            const target = users.find((user) => user.id === id)
            if (target) {
              target.permissions = permissions
            }
          }
        }
      }

      throw new Error(`Unhandled SQL: ${sql}`)
    }),
    transaction: vi.fn((callback: () => unknown) => () => callback())
  }

  return {
    handlers,
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => db),
    appendOperationLog: vi.fn(),
    hashPassword: vi.fn((password: string) => (password === '' ? '' : `hashed:${password}`)),
    verifyPassword: vi.fn(),
    listUserLedgerIds: vi.fn(() => []),
    replaceUserLedgerIds: vi.fn(() => []),
    setLastLoginUserId: vi.fn(),
    clearSessionByEvent: vi.fn(),
    getSessionByEvent: vi.fn(),
    requireAdmin: vi.fn(),
    setSessionByEvent: vi.fn(),
    users
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: authMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: authMocks.getDatabase
}))

vi.mock('../services/auditLog', () => ({
  appendOperationLog: authMocks.appendOperationLog
}))

vi.mock('../security/password', () => ({
  hashPassword: authMocks.hashPassword,
  verifyPassword: authMocks.verifyPassword
}))

vi.mock('../services/userLedgerAccess', () => ({
  listUserLedgerIds: authMocks.listUserLedgerIds,
  replaceUserLedgerIds: authMocks.replaceUserLedgerIds
}))

vi.mock('../services/wallpaperPreference', () => ({
  setLastLoginUserId: authMocks.setLastLoginUserId
}))

vi.mock('./session', () => ({
  clearSessionByEvent: authMocks.clearSessionByEvent,
  getSessionByEvent: authMocks.getSessionByEvent,
  requireAdmin: authMocks.requireAdmin,
  setSessionByEvent: authMocks.setSessionByEvent
}))

import { registerAuthHandlers } from './auth'

describe('auth IPC handlers', () => {
  beforeEach(() => {
    authMocks.handlers.clear()
    vi.clearAllMocks()
    authMocks.users[0].password_hash = ''
    authMocks.users[1].password_hash = 'old-hash'
    authMocks.requireAdmin.mockReturnValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      permissions: {}
    })
    registerAuthHandlers()
  })

  it('allows admin to update another user password', async () => {
    const handler = authMocks.handlers.get('auth:updateUser')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, {
      id: 2,
      password: 'new-pass'
    })

    expect(authMocks.requireAdmin).toHaveBeenCalledWith(event)
    expect(authMocks.hashPassword).toHaveBeenCalledWith('new-pass')
    expect(authMocks.users[1].password_hash).toBe('hashed:new-pass')
    expect(result).toEqual({ success: true })
    expect(authMocks.appendOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'update_user',
        targetId: 2,
        details: expect.objectContaining({
          passwordUpdated: true
        })
      })
    )
  })

  it('allows admin to update own password to empty', async () => {
    const handler = authMocks.handlers.get('auth:updateUser')

    const result = await handler?.({ sender: { id: 1 } }, { id: 1, password: '' })

    expect(authMocks.hashPassword).toHaveBeenCalledWith('')
    expect(authMocks.users[0].password_hash).toBe('')
    expect(result).toEqual({ success: true })
  })

  it('rejects password update when caller is not admin', async () => {
    authMocks.requireAdmin.mockImplementation(() => {
      throw new Error('无权限执行该操作')
    })
    const handler = authMocks.handlers.get('auth:updateUser')

    const result = await handler?.({ sender: { id: 2 } }, { id: 2, password: 'next-pass' })

    expect(authMocks.hashPassword).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: '无权限执行该操作' })
  })
})

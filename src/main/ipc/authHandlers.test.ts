import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    requireAdmin: vi.fn(),
    getSessionByEvent: vi.fn(),
    setSessionByEvent: vi.fn(),
    clearSessionByEvent: vi.fn(),
    loginCommand: vi.fn(),
    logoutCommand: vi.fn(),
    listUsersCommand: vi.fn(),
    createUserCommand: vi.fn(),
    updateUserCommand: vi.fn(),
    deleteUserCommand: vi.fn()
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

vi.mock('../commands/authCommands', () => ({
  loginCommand: authMocks.loginCommand,
  logoutCommand: authMocks.logoutCommand,
  listUsersCommand: authMocks.listUsersCommand,
  createUserCommand: authMocks.createUserCommand,
  updateUserCommand: authMocks.updateUserCommand,
  deleteUserCommand: authMocks.deleteUserCommand
}))

vi.mock('./session', () => ({
  requireAdmin: authMocks.requireAdmin,
  getSessionByEvent: authMocks.getSessionByEvent,
  setSessionByEvent: authMocks.setSessionByEvent,
  clearSessionByEvent: authMocks.clearSessionByEvent
}))

import { registerAuthHandlers } from './auth'

describe('auth IPC handlers', () => {
  beforeEach(() => {
    authMocks.handlers.clear()
    vi.clearAllMocks()
    authMocks.requireAdmin.mockReturnValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      permissions: {},
      source: 'ipc'
    })
    authMocks.getSessionByEvent.mockReturnValue({
      id: 1,
      username: 'admin',
      isAdmin: true,
      permissions: {},
      source: 'ipc'
    })
    registerAuthHandlers()
  })

  it('delegates update user to command layer after admin check', async () => {
    authMocks.updateUserCommand.mockResolvedValue({
      status: 'success',
      data: { userId: 2 },
      error: null
    })
    const handler = authMocks.handlers.get('auth:updateUser')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, {
      id: 2,
      password: 'new-pass'
    })

    expect(authMocks.requireAdmin).toHaveBeenCalledWith(event)
    expect(authMocks.updateUserCommand).toHaveBeenCalledWith(expect.anything(), {
      id: 2,
      password: 'new-pass'
    })
    expect(result).toEqual({ success: true })
  })

  it('passes through command layer failure for update user', async () => {
    authMocks.updateUserCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: { code: 'FORBIDDEN', message: '无权限执行该操作', details: null }
    })
    const handler = authMocks.handlers.get('auth:updateUser')

    const result = await handler?.({ sender: { id: 2 } }, { id: 2, password: 'next-pass' })

    expect(result).toEqual({
      success: false,
      error: '无权限执行该操作',
      errorCode: 'FORBIDDEN',
      errorDetails: null
    })
  })

  it('maps successful login result back into IPC contract and binds session', async () => {
    authMocks.loginCommand.mockResolvedValue({
      status: 'success',
      data: {
        actor: {
          id: 1,
          username: 'admin',
          permissions: {},
          isAdmin: true,
          source: 'cli'
        },
        user: {
          id: 1,
          username: 'admin',
          realName: '管理员',
          permissions: {},
          isAdmin: true,
          ledgerIds: []
        }
      },
      error: null
    })
    const handler = authMocks.handlers.get('auth:login')
    const event = { sender: { id: 8 } }

    const result = await handler?.(event, 'admin', '')

    expect(authMocks.loginCommand).toHaveBeenCalled()
    expect(authMocks.setSessionByEvent).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        id: 1,
        username: 'admin',
        source: 'ipc'
      })
    )
    expect(result).toEqual({
      success: true,
      user: {
        id: 1,
        username: 'admin',
        realName: '管理员',
        permissions: {},
        isAdmin: true,
        ledgerIds: []
      }
    })
  })
})

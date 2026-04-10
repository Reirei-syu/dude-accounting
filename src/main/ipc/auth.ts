import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createUserCommand,
  deleteUserCommand,
  listUsersCommand,
  loginCommand,
  logoutCommand,
  updateUserCommand
} from '../commands/authCommands'
import { createCommandContext } from '../commands/context'
import { createCommandContextFromEvent, isCommandSuccess, toLegacySuccess } from './commandBridge'
import {
  clearSessionByEvent,
  requireAdmin,
  setSessionByEvent
} from './session'

export function registerAuthHandlers(): void {
  getDatabase()

  ipcMain.handle('auth:login', async (event, username: string, password: string) => {
    const result = await loginCommand(
      createCommandContext({
        actor: null
      }),
      { username, password }
    )

    if (isCommandSuccess(result)) {
      setSessionByEvent(event, {
        ...result.data.actor,
        source: 'ipc'
      })
      return {
        success: true,
        user: result.data.user
      }
    }

    return {
      success: false,
      error: result.error?.message ?? '登录失败'
    }
  })

  ipcMain.handle('auth:logout', async (event) => {
    const result = await logoutCommand(createCommandContextFromEvent(event))
    if (isCommandSuccess(result)) {
      clearSessionByEvent(event)
      return { success: true }
    }

    return {
      success: false,
      error: result.error?.message ?? '退出登录失败'
    }
  })

  ipcMain.handle('auth:getUsers', async (event) => {
    requireAdmin(event)
    const result = await listUsersCommand(createCommandContextFromEvent(event))
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取用户列表失败')
  })

  ipcMain.handle(
    'auth:createUser',
    async (
      event,
      data: {
        username: string
        realName: string
        password: string
        permissions: Record<string, boolean>
        ledgerIds?: number[]
      }
    ) => {
      requireAdmin(event)
      return toLegacySuccess(
        await createUserCommand(createCommandContextFromEvent(event), data),
        () => ({})
      )
    }
  )

  ipcMain.handle(
    'auth:updateUser',
    async (
      event,
      data: {
        id: number
        realName?: string
        password?: string
        permissions?: Record<string, boolean>
        ledgerIds?: number[]
      }
    ) => {
      requireAdmin(event)
      return toLegacySuccess(
        await updateUserCommand(createCommandContextFromEvent(event), data),
        () => ({})
      )
    }
  )

  ipcMain.handle('auth:deleteUser', async (event, userId: number) => {
    requireAdmin(event)
    return toLegacySuccess(
      await deleteUserCommand(createCommandContextFromEvent(event), { userId }),
      () => ({})
    )
  })
}

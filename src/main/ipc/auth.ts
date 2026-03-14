import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import { hashPassword, verifyPassword } from '../security/password'
import { listUserLedgerIds, replaceUserLedgerIds } from '../services/userLedgerAccess'
import { setLastLoginUserId } from '../services/wallpaperPreference'
import {
  clearSessionByEvent,
  getSessionByEvent,
  requireAdmin,
  setSessionByEvent
} from './session'

function parsePermissions(raw: unknown): Record<string, boolean> {
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = Boolean(value)
    }
    return result
  } catch {
    return {}
  }
}

export function registerAuthHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('auth:login', (event, username: string, password: string) => {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | Record<string, unknown>
      | undefined

    if (!user) {
      return { success: false, error: '账号不存在' }
    }

    const storedHash = user.password_hash as string
    const verify = verifyPassword(password, storedHash)
    if (!verify.valid) {
      return { success: false, error: '密码错误' }
    }

    if (verify.needsUpgrade) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        hashPassword(password),
        user.id
      )
    }

    const sessionUser = {
      id: Number(user.id),
      username: String(user.username),
      permissions: parsePermissions(user.permissions),
      isAdmin: user.is_admin === 1
    }
    setSessionByEvent(event, sessionUser)
    setLastLoginUserId(db, sessionUser.id)

    appendOperationLog(db, {
      userId: sessionUser.id,
      username: sessionUser.username,
      module: 'auth',
      action: 'login',
      details: {
        senderId: event.sender.id
      }
    })

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        permissions: sessionUser.permissions,
        isAdmin: user.is_admin === 1,
        ledgerIds: user.is_admin === 1 ? [] : listUserLedgerIds(db, Number(user.id))
      }
    }
  })

  ipcMain.handle('auth:logout', (event) => {
    const session = getSessionByEvent(event)
    if (session) {
      appendOperationLog(db, {
        userId: session.id,
        username: session.username,
        module: 'auth',
        action: 'logout',
        details: {
          senderId: event.sender.id
        }
      })
    }

    clearSessionByEvent(event)
    return { success: true }
  })

  ipcMain.handle('auth:getUsers', (event) => {
    requireAdmin(event)
    const users = db
      .prepare('SELECT id, username, real_name, permissions, is_admin FROM users')
      .all() as Array<Record<string, unknown>>

    return users.map((user) => ({
      id: user.id,
      username: user.username,
      realName: user.real_name,
      permissions: parsePermissions(user.permissions),
      isAdmin: user.is_admin === 1,
      ledgerIds: user.is_admin === 1 ? [] : listUserLedgerIds(db, Number(user.id))
    }))
  })

  ipcMain.handle(
    'auth:createUser',
    (
      event,
      data: {
        username: string
        realName: string
        password: string
        permissions: Record<string, boolean>
        ledgerIds?: number[]
      }
    ) => {
      try {
        const admin = requireAdmin(event)
        const created = db.transaction(() => {
          const result = db
            .prepare(
              `INSERT INTO users (username, real_name, password_hash, permissions, is_admin)
               VALUES (?, ?, ?, ?, 0)`
            )
            .run(
              data.username.trim(),
              data.realName.trim(),
              hashPassword(data.password),
              JSON.stringify(data.permissions || {})
            )

          const userId = Number(result.lastInsertRowid)
          const ledgerIds = replaceUserLedgerIds(db, userId, data.ledgerIds || [])
          return { userId, ledgerIds }
        })()

        appendOperationLog(db, {
          userId: admin.id,
          username: admin.username,
          module: 'auth',
          action: 'create_user',
          targetType: 'user',
          targetId: created.userId,
          details: {
            username: data.username.trim(),
            realName: data.realName.trim(),
            ledgerIds: created.ledgerIds
          }
        })

        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'auth:updateUser',
    (
      event,
      data: {
        id: number
        realName?: string
        password?: string
        permissions?: Record<string, boolean>
        ledgerIds?: number[]
      }
    ) => {
      try {
        const admin = requireAdmin(event)
        const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(data.id) as
          | { id: number; is_admin: number }
          | undefined

        if (!target) {
          return { success: false, error: '用户不存在' }
        }

        if (target.is_admin === 1 && data.permissions !== undefined) {
          return { success: false, error: '管理员账号权限不可修改' }
        }
        if (target.is_admin === 1 && data.ledgerIds !== undefined) {
          return { success: false, error: '管理员账号账套权限不可修改' }
        }

        const ledgerIds = db.transaction(() => {
          if (data.realName !== undefined) {
            db.prepare('UPDATE users SET real_name = ? WHERE id = ?').run(data.realName, data.id)
          }
          if (data.password !== undefined) {
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
              hashPassword(data.password),
              data.id
            )
          }
          if (data.permissions !== undefined) {
            db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(
              JSON.stringify(data.permissions),
              data.id
            )
          }
          return data.ledgerIds !== undefined
            ? replaceUserLedgerIds(db, data.id, data.ledgerIds)
            : undefined
        })()

        appendOperationLog(db, {
          userId: admin.id,
          username: admin.username,
          module: 'auth',
          action:
            data.permissions !== undefined || data.ledgerIds !== undefined
              ? 'update_permissions'
              : 'update_user',
          targetType: 'user',
          targetId: data.id,
          details: {
            realName: data.realName,
            passwordUpdated: data.password !== undefined,
            permissionKeys: data.permissions ? Object.keys(data.permissions) : [],
            ledgerIds
          }
        })

        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('auth:deleteUser', (event, userId: number) => {
    try {
      const admin = requireAdmin(event)
      const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as
        | Record<string, unknown>
        | undefined

      if (!user) {
        return { success: false, error: '用户不存在' }
      }
      if (user.is_admin === 1) {
        return { success: false, error: '管理员账号不可删除' }
      }

      db.prepare('DELETE FROM users WHERE id = ?').run(userId)

      appendOperationLog(db, {
        userId: admin.id,
        username: admin.username,
        module: 'auth',
        action: 'delete_user',
        targetType: 'user',
        targetId: userId
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

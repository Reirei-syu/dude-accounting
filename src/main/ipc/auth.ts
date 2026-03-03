import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { hashPassword, verifyPassword } from '../security/password'
import { clearSessionByEvent, requireAdmin, setSessionByEvent } from './session'

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

  // 登录验证
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

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        permissions: sessionUser.permissions,
        isAdmin: user.is_admin === 1
      }
    }
  })

  ipcMain.handle('auth:logout', (event) => {
    clearSessionByEvent(event)
    return { success: true }
  })

  // 获取所有用户
  ipcMain.handle('auth:getUsers', (event) => {
    requireAdmin(event)
    const users = db
      .prepare('SELECT id, username, real_name, permissions, is_admin FROM users')
      .all() as Array<Record<string, unknown>>
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      realName: u.real_name,
      permissions: parsePermissions(u.permissions),
      isAdmin: u.is_admin === 1
    }))
  })

  // 创建用户
  ipcMain.handle(
    'auth:createUser',
    (
      event,
      data: {
        username: string
        realName: string
        password: string
        permissions: Record<string, boolean>
      }
    ) => {
      try {
        requireAdmin(event)
        db.prepare(
          `INSERT INTO users (username, real_name, password_hash, permissions, is_admin)
           VALUES (?, ?, ?, ?, 0)`
        ).run(
          data.username.trim(),
          data.realName.trim(),
          hashPassword(data.password),
          JSON.stringify(data.permissions || {})
        )
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 更新用户
  ipcMain.handle(
    'auth:updateUser',
    (
      event,
      data: {
        id: number
        realName?: string
        password?: string
        permissions?: Record<string, boolean>
      }
    ) => {
      try {
        requireAdmin(event)
        const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(data.id) as
          | { id: number; is_admin: number }
          | undefined
        if (!target) {
          return { success: false, error: '用户不存在' }
        }

        if (target.is_admin === 1 && data.permissions !== undefined) {
          return { success: false, error: 'admin权限不可修改' }
        }

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
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 删除用户
  ipcMain.handle('auth:deleteUser', (event, userId: number) => {
    try {
      requireAdmin(event)
      const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as
        | Record<string, unknown>
        | undefined
      if (!user) return { success: false, error: '用户不存在' }
      if (user.is_admin === 1) return { success: false, error: 'admin账号不可删除' }

      db.prepare('DELETE FROM users WHERE id = ?').run(userId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

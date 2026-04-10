import { hashPassword, verifyPassword } from '../security/password'
import { listUserLedgerIds, replaceUserLedgerIds } from '../services/userLedgerAccess'
import { setLastLoginUserId } from '../services/wallpaperPreference'
import { requireCommandAdmin } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandActor, CommandContext, CommandResult } from './types'
import { CommandError } from './types'

interface CommandUserRow {
  id: number
  username: string
  real_name: string
  permissions: string
  is_admin: number
}

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

function requireUserByUsername(context: CommandContext, username: string): CommandUserRow {
  const user = context.db
    .prepare(
      'SELECT id, username, real_name, permissions, is_admin FROM users WHERE username = ?'
    )
    .get(username) as CommandUserRow | undefined

  if (!user) {
    throw new CommandError('NOT_FOUND', '账号不存在', { username }, 5)
  }

  return user
}

function mapUserToActor(user: CommandUserRow, source: CommandActor['source']): CommandActor {
  return {
    id: Number(user.id),
    username: user.username,
    permissions: parsePermissions(user.permissions),
    isAdmin: user.is_admin === 1,
    source
  }
}

function mapUserOutput(context: CommandContext, user: CommandUserRow) {
  const actor = mapUserToActor(user, context.actor?.source ?? 'cli')
  return {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    permissions: actor.permissions,
    isAdmin: actor.isAdmin,
    ledgerIds: actor.isAdmin ? [] : listUserLedgerIds(context.db, Number(user.id))
  }
}

export async function loginCommand(
  context: CommandContext,
  payload: { username: string; password: string }
): Promise<CommandResult<{ actor: CommandActor; user: ReturnType<typeof mapUserOutput> }>> {
  return withCommandResult(context, () => {
    const username = payload.username.trim()
    if (!username) {
      throw new CommandError('VALIDATION_ERROR', '账号不能为空', null, 2)
    }

    const user = requireUserByUsername(context, username)
    const storedHash = context.db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string }
    const verify = verifyPassword(payload.password, storedHash.password_hash)
    if (!verify.valid) {
      throw new CommandError('AUTH_FAILED', '密码错误', null, 3)
    }

    if (verify.needsUpgrade) {
      context.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        hashPassword(payload.password),
        user.id
      )
    }

    const actor = mapUserToActor(user, 'cli')
    setLastLoginUserId(context.db, actor.id)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'auth',
        action: 'login',
        details: {
          source: actor.source
        }
      }
    )

    return {
      actor,
      user: mapUserOutput(
        {
          ...context,
          actor
        },
        user
      )
    }
  })
}

export async function whoamiCommand(
  context: CommandContext
): Promise<CommandResult<{ actor: CommandActor }>> {
  return withCommandResult(context, () => {
    if (!context.actor) {
      throw new CommandError('UNAUTHORIZED', '当前没有有效的 CLI 登录态', null, 3)
    }

    return {
      actor: context.actor
    }
  })
}

export async function logoutCommand(
  context: CommandContext
): Promise<CommandResult<{ loggedOut: true }>> {
  return withCommandResult(context, () => {
    if (!context.actor) {
      throw new CommandError('UNAUTHORIZED', '当前没有有效的 CLI 登录态', null, 3)
    }

    appendActorOperationLog(context, {
      module: 'auth',
      action: 'logout',
      details: {
        source: context.actor.source
      }
    })

    return { loggedOut: true as const }
  })
}

export async function listUsersCommand(
  context: CommandContext
): Promise<CommandResult<Array<ReturnType<typeof mapUserOutput>>>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    const users = context.db
      .prepare('SELECT id, username, real_name, permissions, is_admin FROM users ORDER BY id ASC')
      .all() as CommandUserRow[]

    return users.map((user) => mapUserOutput(context, user))
  })
}

export async function createUserCommand(
  context: CommandContext,
  payload: {
    username: string
    realName: string
    password: string
    permissions: Record<string, boolean>
    ledgerIds?: number[]
  }
): Promise<CommandResult<{ userId: number }>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    const username = payload.username.trim()
    const realName = payload.realName.trim()
    if (!username) {
      throw new CommandError('VALIDATION_ERROR', '用户名不能为空', null, 2)
    }
    if (!realName) {
      throw new CommandError('VALIDATION_ERROR', '姓名不能为空', null, 2)
    }

    const created = context.db.transaction(() => {
      const result = context.db
        .prepare(
          `INSERT INTO users (username, real_name, password_hash, permissions, is_admin)
           VALUES (?, ?, ?, ?, 0)`
        )
        .run(username, realName, hashPassword(payload.password), JSON.stringify(payload.permissions))

      const userId = Number(result.lastInsertRowid)
      const ledgerIds = replaceUserLedgerIds(context.db, userId, payload.ledgerIds || [])
      return { userId, ledgerIds }
    })()

    appendActorOperationLog(context, {
      module: 'auth',
      action: 'create_user',
      targetType: 'user',
      targetId: created.userId,
      details: {
        username,
        realName,
        ledgerIds: created.ledgerIds
      }
    })

    return { userId: created.userId }
  })
}

export async function updateUserCommand(
  context: CommandContext,
  payload: {
    id: number
    realName?: string
    password?: string
    permissions?: Record<string, boolean>
    ledgerIds?: number[]
  }
): Promise<CommandResult<{ userId: number }>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)

    const target = context.db
      .prepare('SELECT id, is_admin FROM users WHERE id = ?')
      .get(payload.id) as { id: number; is_admin: number } | undefined
    if (!target) {
      throw new CommandError('NOT_FOUND', '用户不存在', { id: payload.id }, 5)
    }

    if (target.is_admin === 1 && payload.permissions !== undefined) {
      throw new CommandError('VALIDATION_ERROR', '管理员账号权限不可修改', null, 2)
    }
    if (target.is_admin === 1 && payload.ledgerIds !== undefined) {
      throw new CommandError('VALIDATION_ERROR', '管理员账号账套权限不可修改', null, 2)
    }

    const ledgerIds = context.db.transaction(() => {
      if (payload.realName !== undefined) {
        context.db.prepare('UPDATE users SET real_name = ? WHERE id = ?').run(
          payload.realName,
          payload.id
        )
      }
      if (payload.password !== undefined) {
        context.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
          hashPassword(payload.password),
          payload.id
        )
      }
      if (payload.permissions !== undefined) {
        context.db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(
          JSON.stringify(payload.permissions),
          payload.id
        )
      }
      return payload.ledgerIds !== undefined
        ? replaceUserLedgerIds(context.db, payload.id, payload.ledgerIds)
        : undefined
    })()

    appendActorOperationLog(context, {
      module: 'auth',
      action:
        payload.permissions !== undefined || payload.ledgerIds !== undefined
          ? 'update_permissions'
          : 'update_user',
      targetType: 'user',
      targetId: payload.id,
      details: {
        realName: payload.realName,
        passwordUpdated: payload.password !== undefined,
        permissionKeys: payload.permissions ? Object.keys(payload.permissions) : [],
        ledgerIds
      }
    })

    return { userId: payload.id }
  })
}

export async function deleteUserCommand(
  context: CommandContext,
  payload: { userId: number }
): Promise<CommandResult<{ userId: number }>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)

    const user = context.db
      .prepare('SELECT is_admin FROM users WHERE id = ?')
      .get(payload.userId) as { is_admin: number } | undefined

    if (!user) {
      throw new CommandError('NOT_FOUND', '用户不存在', { userId: payload.userId }, 5)
    }
    if (user.is_admin === 1) {
      throw new CommandError('VALIDATION_ERROR', '管理员账号不可删除', null, 2)
    }

    context.db.prepare('DELETE FROM users WHERE id = ?').run(payload.userId)
    appendActorOperationLog(context, {
      module: 'auth',
      action: 'delete_user',
      targetType: 'user',
      targetId: payload.userId
    })

    return { userId: payload.userId }
  })
}

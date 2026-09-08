import { createHash, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import { CommandError, type CommandActor } from '../commands/types'

export const SESSION_DENIED_MESSAGE = '登录态已失效或无权访问，请重新登录'

export interface SessionIdentity {
  userId: number
  authRevision: number
  token: string
  createdAt: string
}

export function sessionDenied(): CommandError {
  return new CommandError('UNAUTHORIZED', SESSION_DENIED_MESSAGE, null, 3)
}

export function isSessionIdentity(value: unknown): value is SessionIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (
    Number.isSafeInteger(item.userId) &&
    Number(item.userId) > 0 &&
    Number.isSafeInteger(item.authRevision) &&
    Number(item.authRevision) > 0 &&
    typeof item.token === 'string' &&
    /^[a-f0-9]{64}$/.test(item.token) &&
    typeof item.createdAt === 'string' &&
    Number.isFinite(Date.parse(item.createdAt))
  )
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 只能在凭据校验成功后调用；会话登记不存储口令或口令哈希。 */
export function issueSession(db: Database.Database, userId: number): SessionIdentity {
  return db.transaction(() => {
    const user = db
      .prepare('SELECT auth_revision, is_enabled FROM users WHERE id=?')
      .get(userId) as { auth_revision: number; is_enabled: number } | undefined
    if (!user || user.is_enabled !== 1) throw sessionDenied()
    const identity: SessionIdentity = {
      userId,
      authRevision: user.auth_revision,
      token: randomBytes(32).toString('hex'),
      createdAt: new Date().toISOString()
    }
    db.prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,auth_revision,created_at) VALUES(?,?,?,?)'
    ).run(tokenHash(identity.token), identity.userId, identity.authRevision, identity.createdAt)
    return identity
  })()
}

export function resolveSessionActor(
  db: Database.Database,
  identity: unknown,
  source: CommandActor['source']
): CommandActor {
  try {
    if (!isSessionIdentity(identity)) throw sessionDenied()
    const user = db
      .prepare(
        `SELECT u.id,u.username,u.permissions,u.is_admin
      FROM users u JOIN auth_sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.user_id=? AND s.auth_revision=? AND s.created_at=?
        AND u.auth_revision=s.auth_revision AND u.is_enabled=1`
      )
      .get(
        tokenHash(identity.token),
        identity.userId,
        identity.authRevision,
        identity.createdAt
      ) as
      | {
          id: number
          username: string
          permissions: string
          is_admin: number
        }
      | undefined
    if (!user) throw sessionDenied()
    const parsed: unknown = JSON.parse(user.permissions)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw sessionDenied()
    const permissions: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'boolean') throw sessionDenied()
      permissions[key] = value
    }
    return {
      id: user.id,
      username: user.username,
      permissions,
      isAdmin: user.is_admin === 1,
      source,
      session: {
        userId: identity.userId,
        authRevision: identity.authRevision,
        token: identity.token,
        createdAt: identity.createdAt
      }
    }
  } catch {
    // 包括数据库不可用：不可回退到缓存权限，也不向调用方泄露 SQL/用户信息。
    throw sessionDenied()
  }
}

export function revokeSession(db: Database.Database, identity: SessionIdentity): void {
  db.prepare('DELETE FROM auth_sessions WHERE token_hash=? AND user_id=?').run(
    tokenHash(identity.token),
    identity.userId
  )
}

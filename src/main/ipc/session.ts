import type { IpcMainInvokeEvent } from 'electron'
import type Database from 'better-sqlite3'

export interface SessionUser {
  id: number
  username: string
  permissions: Record<string, boolean>
  isAdmin: boolean
}

type PermissionKey =
  | 'voucher_entry'
  | 'audit'
  | 'bookkeeping'
  | 'unbookkeep'
  | 'system_settings'
  | 'ledger_settings'

const senderSessionMap = new Map<number, SessionUser>()

export function setSessionByEvent(event: IpcMainInvokeEvent, user: SessionUser): void {
  senderSessionMap.set(event.sender.id, user)
}

export function clearSessionByEvent(event: IpcMainInvokeEvent): void {
  senderSessionMap.delete(event.sender.id)
}

export function getSessionByEvent(event: IpcMainInvokeEvent): SessionUser | null {
  return senderSessionMap.get(event.sender.id) || null
}

export function requireAuth(event: IpcMainInvokeEvent): SessionUser {
  const session = getSessionByEvent(event)
  if (!session) {
    throw new Error('未登录或登录态已失效')
  }
  return session
}

export function requireAdmin(event: IpcMainInvokeEvent): SessionUser {
  const session = requireAuth(event)
  if (!session.isAdmin) {
    throw new Error('无权限：仅管理员可执行该操作')
  }
  return session
}

export function requirePermission(
  event: IpcMainInvokeEvent,
  permission: PermissionKey
): SessionUser {
  const session = requireAuth(event)
  if (session.isAdmin) return session
  if (!session.permissions[permission]) {
    throw new Error('无权限执行该操作')
  }
  return session
}

export function requireLedgerAccess(
  event: IpcMainInvokeEvent,
  db: Pick<Database.Database, 'prepare'>,
  ledgerId: number
): SessionUser {
  const session = requireAuth(event)
  if (session.isAdmin) {
    return session
  }

  const row = db
    .prepare(
      'SELECT 1 AS ok FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?'
    )
    .get(session.id, ledgerId) as { ok: number } | undefined

  if (!row) {
    throw new Error('无权访问该账套')
  }

  return session
}

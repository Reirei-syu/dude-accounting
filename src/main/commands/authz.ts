import type Database from 'better-sqlite3'
import type { CommandActor, PermissionKey } from './types'
import { CommandError } from './types'
import { sessionDenied } from '../security/sessionAuthority'

export function requireCommandActor(actor: CommandActor | null): CommandActor {
  if (!actor) {
    throw sessionDenied()
  }

  return actor
}

export function requireCommandAdmin(actor: CommandActor | null): CommandActor {
  const currentActor = requireCommandActor(actor)
  if (!currentActor.isAdmin) {
    throw new CommandError('FORBIDDEN', '无权限：仅管理员可执行该操作', null, 4)
  }

  return currentActor
}

export function requireCommandPermission(
  actor: CommandActor | null,
  permission: PermissionKey
): CommandActor {
  const currentActor = requireCommandActor(actor)
  if (currentActor.isAdmin) {
    return currentActor
  }

  if (!currentActor.permissions[permission]) {
    throw new CommandError('FORBIDDEN', '无权限执行该操作', { permission }, 4)
  }

  return currentActor
}

export function requireCommandLedgerAccess(
  db: Pick<Database.Database, 'prepare'>,
  actor: CommandActor | null,
  ledgerId: number
): CommandActor {
  const currentActor = requireCommandActor(actor)
  if (currentActor.isAdmin) {
    return currentActor
  }

  const row = db
    .prepare('SELECT 1 AS ok FROM user_ledger_permissions WHERE user_id = ? AND ledger_id = ?')
    .get(currentActor.id, ledgerId) as { ok: number } | undefined

  if (!row) {
    throw sessionDenied()
  }

  return currentActor
}

export function assertRiskConfirmed(
  riskConfirmed: boolean | undefined,
  message = '该操作风险较高，请显式确认后再执行'
): void {
  if (!riskConfirmed) {
    throw new CommandError(
      'RISK_CONFIRMATION_REQUIRED',
      message,
      {
        riskConfirmed: false
      },
      2
    )
  }
}

import type Database from 'better-sqlite3'
import type { RuntimeContext } from '../runtime/runtimeContext'
import type { SessionIdentity } from '../security/sessionAuthority'
import type { CommandErrorCode } from '../../shared/contracts/commandResult'
export type { CommandFailure, CommandResult } from '../../shared/contracts/commandResult'

export type PermissionKey =
  | 'voucher_entry'
  | 'audit'
  | 'bookkeeping'
  | 'unbookkeep'
  | 'system_settings'
  | 'ledger_settings'

export type CommandOutputMode = 'json' | 'pretty'

export interface CommandActor {
  id: number
  username: string
  permissions: Record<string, boolean>
  isAdmin: boolean
  source: 'ipc' | 'cli'
  session?: SessionIdentity
}

export interface CommandContext {
  db: Database.Database
  runtime: RuntimeContext
  actor: CommandActor | null
  outputMode: CommandOutputMode
  now: Date
}

export class CommandError extends Error {
  code: CommandErrorCode
  details: Record<string, unknown> | null
  exitCode: number

  constructor(
    code: CommandErrorCode,
    message: string,
    details: Record<string, unknown> | null = null,
    exitCode = 10
  ) {
    super(message)
    this.name = 'CommandError'
    this.code = code
    this.details = details
    this.exitCode = exitCode
  }
}

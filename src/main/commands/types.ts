import type Database from 'better-sqlite3'
import type { RuntimeContext } from '../runtime/runtimeContext'

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
}

export interface CommandContext {
  db: Database.Database
  runtime: RuntimeContext
  actor: CommandActor | null
  outputMode: CommandOutputMode
  now: Date
}

export interface CommandFailure {
  code: string
  message: string
  details: Record<string, unknown> | null
}

export interface CommandResult<T> {
  status: 'success' | 'error'
  data: T | null
  error: CommandFailure | null
}

export class CommandError extends Error {
  code: string
  details: Record<string, unknown> | null
  exitCode: number

  constructor(
    code: string,
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

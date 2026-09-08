import type Database from 'better-sqlite3'
import { getDatabase } from '../database/init'
import { getRuntimeContext } from '../runtime/runtimeContext'
import type { CommandActor, CommandContext, CommandOutputMode } from './types'
import {
  resolveSessionActor,
  sessionDenied,
  type SessionIdentity
} from '../security/sessionAuthority'

export function createSessionCommandContext(input: {
  runtime: ReturnType<typeof getRuntimeContext>
  session: SessionIdentity
  outputMode: CommandOutputMode
}): CommandContext {
  try {
    const context = createCommandContext({ runtime: input.runtime, outputMode: input.outputMode })
    context.actor = resolveSessionActor(context.db, input.session, 'cli')
    return context
  } catch {
    throw sessionDenied()
  }
}

export function createCommandContext(
  input: {
    db?: Database.Database
    runtime?: ReturnType<typeof getRuntimeContext>
    actor?: CommandActor | null
    outputMode?: CommandOutputMode
    now?: Date
  } = {}
): CommandContext {
  return {
    db: input.db ?? getDatabase(),
    runtime: input.runtime ?? getRuntimeContext(),
    actor: input.actor ?? null,
    outputMode: input.outputMode ?? 'json',
    now: input.now ?? new Date()
  }
}

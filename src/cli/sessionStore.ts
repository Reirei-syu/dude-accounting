import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandActor } from '../main/commands/types'
import {
  isSessionIdentity,
  sessionDenied,
  type SessionIdentity
} from '../main/security/sessionAuthority'

export interface CliSession extends SessionIdentity {
  formatVersion: 2
}

function getCliSessionDir(runtime: RuntimeContext): string {
  return path.join(runtime.userDataPath, 'cli')
}

export function getCliSessionPath(runtime: RuntimeContext): string {
  return path.join(getCliSessionDir(runtime), 'session.json')
}

export function loadCliSession(runtime: RuntimeContext): CliSession | null {
  const sessionPath = getCliSessionPath(runtime)
  if (!fs.existsSync(sessionPath)) {
    return null
  }

  try {
    const value: unknown = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
    if (!isSessionIdentity(value) || (value as CliSession).formatVersion !== 2 || 'actor' in value)
      return null
    return {
      formatVersion: 2,
      userId: value.userId,
      authRevision: value.authRevision,
      token: value.token,
      createdAt: value.createdAt
    }
  } catch {
    return null
  }
}

export function saveCliSession(runtime: RuntimeContext, actor: CommandActor): CliSession {
  if (!isSessionIdentity(actor.session)) throw sessionDenied()
  const session: CliSession = {
    formatVersion: 2,
    userId: actor.session.userId,
    authRevision: actor.session.authRevision,
    token: actor.session.token,
    createdAt: actor.session.createdAt
  }

  fs.mkdirSync(getCliSessionDir(runtime), { recursive: true, mode: 0o700 })
  const temporaryPath = path.join(getCliSessionDir(runtime), `session-${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(session), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    fs.renameSync(temporaryPath, getCliSessionPath(runtime))
    fs.chmodSync(getCliSessionPath(runtime), 0o600)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
  return session
}

export function clearCliSession(runtime: RuntimeContext): void {
  const sessionPath = getCliSessionPath(runtime)
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { force: true })
  }
}

export function requireCliSession(runtime: RuntimeContext, token?: string): CliSession {
  const session = loadCliSession(runtime)
  if (!session) {
    throw sessionDenied()
  }

  if (token && session.token !== token) {
    throw sessionDenied()
  }

  return session
}

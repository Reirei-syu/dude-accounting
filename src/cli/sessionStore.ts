import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandActor } from '../main/commands/types'
import { CommandError } from '../main/commands/types'

export interface CliSession {
  token: string
  actor: CommandActor
  createdAt: string
  updatedAt: string
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
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8')) as CliSession
  } catch {
    return null
  }
}

export function saveCliSession(runtime: RuntimeContext, actor: CommandActor): CliSession {
  const now = new Date().toISOString()
  const existing = loadCliSession(runtime)
  const session: CliSession = {
    token: existing?.token || randomUUID(),
    actor: {
      ...actor,
      source: 'cli'
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }

  fs.mkdirSync(getCliSessionDir(runtime), { recursive: true })
  fs.writeFileSync(getCliSessionPath(runtime), JSON.stringify(session, null, 2), 'utf8')
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
    throw new CommandError('UNAUTHORIZED', '当前没有有效的 CLI 登录态，请先执行 auth login', null, 3)
  }

  if (token && session.token !== token) {
    throw new CommandError('UNAUTHORIZED', 'CLI token 无效', null, 3)
  }

  return session
}

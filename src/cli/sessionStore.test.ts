import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCliSessionPath, loadCliSession, saveCliSession } from './sessionStore'
import type { RuntimeContext } from '../main/runtime/runtimeContext'

describe('CLI 最小身份文件', () => {
  let root: string
  let runtime: RuntimeContext
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-cli-session-'))
    runtime = { userDataPath: root } as RuntimeContext
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  it('只保存身份和随机标识，不序列化权限快照', () => {
    const identity = {
      userId: 1,
      authRevision: 2,
      token: 'a'.repeat(64),
      createdAt: new Date().toISOString()
    }
    saveCliSession(runtime, {
      id: 1,
      username: 'alice',
      permissions: { audit: true },
      isAdmin: false,
      source: 'cli',
      session: identity
    })
    expect(loadCliSession(runtime)).toEqual({ formatVersion: 2, ...identity })
    const raw = fs.readFileSync(getCliSessionPath(runtime), 'utf8')
    expect(raw).not.toMatch(/permissions|actor|password|isAdmin/)
    expect(fs.readdirSync(path.dirname(getCliSessionPath(runtime)))).toEqual(['session.json'])
  })
  it.each(['{broken', '{"actor":{"isAdmin":true},"token":"old"}', 'null', '[]'])(
    '旧格式或损坏文件安全登出：%s',
    (contents) => {
      fs.mkdirSync(path.dirname(getCliSessionPath(runtime)))
      fs.writeFileSync(getCliSessionPath(runtime), contents)
      expect(loadCliSession(runtime)).toBeNull()
    }
  )
})

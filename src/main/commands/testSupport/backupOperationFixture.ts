import fs from 'node:fs'
import path from 'node:path'
import { closeDatabase, getDatabase, initializeDatabase } from '../../database/init'
import { clearRuntimeContext, createNodeRuntimeContext, setRuntimeContext } from '../../runtime/runtimeContext'
import { consumeEmbeddedCliState } from '../../runtime/embeddedCliState'
import { issueSession, resolveSessionActor } from '../../security/sessionAuthority'
import type { CommandContext } from '../types'

export function createBackupOperationFixture(): { root: string; context: CommandContext; cleanup: () => void } {
  const base = path.resolve('.tmp')
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'backup-command-'))
  const runtime = createNodeRuntimeContext({ userDataPath: root, isDevelopment: true })
  setRuntimeContext(runtime)
  initializeDatabase()
  const db = getDatabase()
  const user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: number }
  db.exec("INSERT INTO ledgers(id,name,start_period,current_period) VALUES(7,'千千结账套','2026-01','2026-03')")
  return { root, context: { db, runtime, actor: resolveSessionActor(db, issueSession(db, user.id), 'cli'),
    outputMode: 'json', now: new Date('2026-04-11T10:00:00.000Z') },
    cleanup() {
      closeDatabase(); clearRuntimeContext(); consumeEmbeddedCliState()
      if (path.dirname(root) !== base || !path.basename(root).startsWith('backup-command-')) throw new Error('测试清理越界')
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

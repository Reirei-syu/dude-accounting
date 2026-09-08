import Database from 'better-sqlite3'
import { afterEach } from 'vitest'
import { runDatabaseMigrations } from '../../database/migrations'
import { issueSession } from '../../security/sessionAuthority'
import type { CommandActor } from '../types'

const databases: Database.Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

/** 业务服务保持原 mock，但请求身份必须通过真实会话登记和校验。 */
export function authenticateMockContext(context: { db: object; actor: CommandActor }): void {
  const db = new Database(':memory:')
  databases.push(db)
  runDatabaseMigrations(db)
  const actor = context.actor
  db.prepare('INSERT INTO users(id,username,permissions,is_admin) VALUES(?,?,?,?)').run(
    actor.id,
    actor.username,
    JSON.stringify(actor.permissions),
    Number(actor.isAdmin)
  )
  actor.session = issueSession(db, actor.id)
  const mock = context.db as { prepare?: (sql: string) => unknown }
  const original = mock.prepare?.bind(mock)
  mock.prepare = (sql: string): unknown =>
    sql.includes('JOIN auth_sessions') ? db.prepare(sql) : original?.(sql)
}

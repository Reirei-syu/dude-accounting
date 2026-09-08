import type Database from 'better-sqlite3'

export type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T

export function assertSynchronousOperation(operation: () => unknown): void {
  if (operation.constructor.name === 'AsyncFunction') {
    throw new TypeError('审计事务不允许异步回调')
  }
}

/** 纯数据库业务与其成功审计须一起放入此同步边界；异常由 SQLite 回滚。 */
export function auditedTransaction<T>(
  db: Database.Database,
  operation: () => T & SynchronousResult<T>
): T {
  assertSynchronousOperation(operation)
  return db
    .transaction(() => {
      const result = operation()
      if (result && typeof result === 'object' && 'then' in result) {
        throw new TypeError('审计事务不允许返回 Promise')
      }
      return result
    })
    .immediate()
}

import {
  auditedTransaction,
  assertSynchronousOperation,
  type SynchronousResult
} from '../services/auditedTransaction'
import { resolveSessionActor } from '../security/sessionAuthority'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

export function withAuditedCommandResult<T>(
  context: CommandContext,
  operation: () => T & SynchronousResult<T>
): Promise<CommandResult<T>> {
  return withCommandResult(context, () => {
    assertSynchronousOperation(operation)
    return auditedTransaction<T>(context.db, () => {
      // 取得写锁后再校验，避免另一连接在前置校验与业务写入之间撤销权限。
      if (context.actor)
        context.actor = resolveSessionActor(context.db, context.actor.session, context.actor.source)
      return operation()
    })
  })
}

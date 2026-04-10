import { appendOperationLog, type OperationLogInput } from '../services/auditLog'
import type { CommandContext } from './types'

export function appendActorOperationLog(
  context: CommandContext,
  input: Omit<OperationLogInput, 'userId' | 'username'>
): void {
  appendOperationLog(context.db, {
    ...input,
    userId: context.actor?.id ?? null,
    username: context.actor?.username ?? null
  })
}

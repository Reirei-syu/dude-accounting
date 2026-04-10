import type { IpcMainInvokeEvent } from 'electron'
import type { CommandContext, CommandResult } from '../commands/types'
import { createCommandContext } from '../commands/context'
import * as sessionModule from './session'

export function createCommandContextFromEvent(event: IpcMainInvokeEvent): CommandContext {
  const actor =
    typeof sessionModule.getSessionByEvent === 'function'
      ? sessionModule.getSessionByEvent(event)
      : typeof sessionModule.requireAuth === 'function'
        ? (() => {
            try {
              return sessionModule.requireAuth(event)
            } catch {
              return null
            }
          })()
        : null

  return createCommandContext({
    actor
  })
}

export function isCommandSuccess<T>(
  result: CommandResult<T>
): result is CommandResult<T> & { status: 'success'; data: T } {
  return result.status === 'success' && result.data !== null
}

export function toLegacySuccess<T = unknown>(
  result: CommandResult<T>,
  mapData?: (data: T) => Record<string, unknown>
): Record<string, unknown> {
  if (isCommandSuccess(result)) {
    return {
      success: true,
      ...(mapData ? mapData(result.data) : result.data)
    }
  }

  return {
    success: false,
    error: result.error?.message ?? '未知错误'
  }
}

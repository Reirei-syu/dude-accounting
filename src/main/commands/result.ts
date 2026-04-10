import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

export function createSuccessResult<T>(data: T): CommandResult<T> {
  return {
    status: 'success',
    data,
    error: null
  }
}

export function createErrorResult<T>(error: unknown): CommandResult<T> {
  if (error instanceof CommandError) {
    return {
      status: 'error',
      data: null,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    }
  }

  if (error instanceof Error) {
    return {
      status: 'error',
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
        details: null
      }
    }
  }

  return {
    status: 'error',
    data: null,
    error: {
      code: 'INTERNAL_ERROR',
      message: '未知错误',
      details: null
    }
  }
}

export function getCommandExitCode(error: unknown): number {
  return error instanceof CommandError ? error.exitCode : 10
}

export async function withCommandResult<T>(
  _context: CommandContext,
  handler: () => Promise<T> | T
): Promise<CommandResult<T>> {
  try {
    return createSuccessResult(await handler())
  } catch (error) {
    return createErrorResult<T>(error)
  }
}

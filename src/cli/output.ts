import type { CommandResult } from '../main/commands/types'

export function renderCommandOutput<T>(
  result: CommandResult<T>,
  outputMode: 'json' | 'pretty'
): string {
  if (outputMode === 'pretty') {
    if (result.status === 'success') {
      return JSON.stringify(result.data, null, 2)
    }

    return JSON.stringify(
      {
        code: result.error?.code ?? 'INTERNAL_ERROR',
        message: result.error?.message ?? '未知错误',
        details: result.error?.details ?? null
      },
      null,
      2
    )
  }

  return JSON.stringify(result, null, 2)
}

import fs from 'node:fs'
import path from 'node:path'
import { ensureDirectory } from './fileIntegrity'
import { formatLocalDateTime } from './localTime'

export type RuntimeLogLevel = 'info' | 'warn' | 'error'
export type IpcTelemetryStatus = 'success' | 'failed' | 'thrown'

export interface RuntimeLogEntry {
  timestamp: string
  level: RuntimeLogLevel
  event: string
  channel?: string
  status?: IpcTelemetryStatus
  durationMs?: number
  context?: Record<string, unknown>
  errorMessage?: string
  errorStack?: string | null
}

export interface IpcTelemetryOptions {
  channel: string
  baseDir: string
  context?: Record<string, unknown>
  now?: Date
}

function formatLocalDateToken(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeError(error: unknown): { errorMessage?: string; errorStack?: string | null } {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorStack: error.stack ?? null
    }
  }

  if (typeof error === 'string') {
    return {
      errorMessage: error,
      errorStack: null
    }
  }

  return {
    errorMessage: error === undefined ? undefined : String(error),
    errorStack: null
  }
}

function extractResultStatus(result: unknown): IpcTelemetryStatus {
  if (
    result &&
    typeof result === 'object' &&
    'success' in result &&
    (result as { success?: unknown }).success === false
  ) {
    return 'failed'
  }

  return 'success'
}

function extractResultErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('error' in result)) {
    return undefined
  }

  const error = (result as { error?: unknown }).error
  return typeof error === 'string' && error.trim() !== '' ? error : undefined
}

export function getRuntimeLogFilePath(baseDir: string, now: Date = new Date()): string {
  return path.join(baseDir, 'logs', `runtime-${formatLocalDateToken(now)}.jsonl`)
}

export function writeRuntimeLog(
  baseDir: string,
  entry: Omit<RuntimeLogEntry, 'timestamp'> & { timestamp?: string },
  now: Date = new Date()
): string {
  const filePath = getRuntimeLogFilePath(baseDir, now)
  ensureDirectory(path.dirname(filePath))
  const record: RuntimeLogEntry = {
    timestamp: entry.timestamp ?? formatLocalDateTime(now),
    level: entry.level,
    event: entry.event,
    channel: entry.channel,
    status: entry.status,
    durationMs: entry.durationMs,
    context: entry.context,
    errorMessage: entry.errorMessage,
    errorStack: entry.errorStack
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
  return filePath
}

export async function withIpcTelemetry<T>(
  options: IpcTelemetryOptions,
  operation: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    const status = extractResultStatus(result)
    writeRuntimeLog(
      options.baseDir,
      {
        level: status === 'success' ? 'info' : 'warn',
        event: 'ipc.invoke',
        channel: options.channel,
        status,
        durationMs: Date.now() - startedAt,
        context: options.context,
        errorMessage: extractResultErrorMessage(result)
      },
      options.now
    )
    return result
  } catch (error) {
    writeRuntimeLog(
      options.baseDir,
      {
        level: 'error',
        event: 'ipc.invoke',
        channel: options.channel,
        status: 'thrown',
        durationMs: Date.now() - startedAt,
        context: options.context,
        ...normalizeError(error)
      },
      options.now
    )
    throw error
  }
}

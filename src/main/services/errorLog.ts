import fs from 'node:fs'
import path from 'node:path'
import { app, type WebContents } from 'electron'
import { buildTimestampToken, ensureDirectory } from './fileIntegrity'
import { formatLocalDateTime } from './localTime'
import { getRuntimeLogFilePath } from './runtimeLogger'

export type ErrorLogSource = 'main' | 'renderer' | 'process' | 'system'

export interface ErrorLogEntry {
  timestamp: string
  source: ErrorLogSource
  event: string
  context?: Record<string, unknown>
  errorMessage?: string
  errorStack?: string | null
}

export interface RendererErrorPayload {
  type: 'error' | 'unhandledrejection'
  message?: string
  stack?: string | null
  filename?: string | null
  lineno?: number | null
  colno?: number | null
  reason?: string | null
  href?: string | null
}

const DIAGNOSTIC_LOG_FILE_PATTERN = /^(runtime|error)-\d{4}-\d{2}-\d{2}\.jsonl$/i

let installedGlobalErrorLogging = false

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

function safeGetBaseDir(resolveBaseDir: () => string): string {
  try {
    return resolveBaseDir()
  } catch {
    return path.join(app.getPath('temp'), 'dude-accounting')
  }
}

function safeGetWebContentsUrl(webContents: WebContents | null | undefined): string | null {
  if (!webContents) {
    return null
  }

  try {
    return webContents.getURL() || null
  } catch {
    return null
  }
}

export function getErrorLogDirectory(baseDir: string): string {
  return path.join(baseDir, 'logs')
}

export function getErrorLogFilePath(baseDir: string, now: Date = new Date()): string {
  return path.join(getErrorLogDirectory(baseDir), `error-${formatLocalDateToken(now)}.jsonl`)
}

export function writeErrorLog(
  baseDir: string,
  entry: Omit<ErrorLogEntry, 'timestamp'> & { timestamp?: string },
  now: Date = new Date()
): string {
  const filePath = getErrorLogFilePath(baseDir, now)
  ensureDirectory(path.dirname(filePath))
  const record: ErrorLogEntry = {
    timestamp: entry.timestamp ?? formatLocalDateTime(now),
    source: entry.source,
    event: entry.event,
    context: entry.context,
    errorMessage: entry.errorMessage,
    errorStack: entry.errorStack
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8')
  return filePath
}

export function writeRendererErrorLog(
  baseDir: string,
  payload: RendererErrorPayload,
  now: Date = new Date()
): string {
  const errorMessage =
    payload.message?.trim() || payload.reason?.trim() || '未知渲染进程错误'

  return writeErrorLog(
    baseDir,
    {
      source: 'renderer',
      event: payload.type === 'error' ? 'window.error' : 'window.unhandledrejection',
      context: {
        href: payload.href ?? null,
        filename: payload.filename ?? null,
        lineno: payload.lineno ?? null,
        colno: payload.colno ?? null
      },
      errorMessage,
      errorStack: payload.stack ?? null
    },
    now
  )
}

export function getErrorLogStatus(baseDir: string, now: Date = new Date()): {
  logDirectory: string
  runtimeLogPath: string
  errorLogPath: string
  runtimeLogExists: boolean
  errorLogExists: boolean
} {
  const logDirectory = getErrorLogDirectory(baseDir)
  const runtimeLogPath = getRuntimeLogFilePath(baseDir, now)
  const errorLogPath = getErrorLogFilePath(baseDir, now)

  return {
    logDirectory,
    runtimeLogPath,
    errorLogPath,
    runtimeLogExists: fs.existsSync(runtimeLogPath),
    errorLogExists: fs.existsSync(errorLogPath)
  }
}

export function listDiagnosticLogFiles(baseDir: string): string[] {
  const logDirectory = getErrorLogDirectory(baseDir)
  if (!fs.existsSync(logDirectory)) {
    return []
  }

  return fs
    .readdirSync(logDirectory)
    .filter((fileName) => DIAGNOSTIC_LOG_FILE_PATTERN.test(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(logDirectory, fileName))
}

export function exportDiagnosticLogs(
  baseDir: string,
  targetDirectory: string,
  now: Date = new Date()
): {
  exportDirectory: string
  filePaths: string[]
} {
  const sourceFiles = listDiagnosticLogFiles(baseDir)
  if (sourceFiles.length === 0) {
    throw new Error('暂无可导出的日志文件')
  }

  const exportDirectory = path.join(targetDirectory, `DudeAccounting-logs-${buildTimestampToken(now)}`)
  ensureDirectory(exportDirectory)

  const filePaths = sourceFiles.map((sourcePath) => {
    const targetPath = path.join(exportDirectory, path.basename(sourcePath))
    fs.copyFileSync(sourcePath, targetPath)
    return targetPath
  })

  return {
    exportDirectory,
    filePaths
  }
}

export function installGlobalErrorLogging(resolveBaseDir: () => string): void {
  if (installedGlobalErrorLogging) {
    return
  }
  installedGlobalErrorLogging = true

  process.on('uncaughtExceptionMonitor', (error) => {
    writeErrorLog(safeGetBaseDir(resolveBaseDir), {
      source: 'process',
      event: 'uncaughtException',
      context: { pid: process.pid },
      ...normalizeError(error)
    })
  })

  process.on('unhandledRejection', (reason) => {
    writeErrorLog(safeGetBaseDir(resolveBaseDir), {
      source: 'process',
      event: 'unhandledRejection',
      context: { pid: process.pid },
      ...normalizeError(reason)
    })
  })

  app.on('render-process-gone', (_event, webContents, details) => {
    writeErrorLog(safeGetBaseDir(resolveBaseDir), {
      source: 'system',
      event: 'render-process-gone',
      context: {
        reason: details.reason,
        exitCode: details.exitCode,
        url: safeGetWebContentsUrl(webContents)
      },
      errorMessage: `渲染进程异常退出：${details.reason}`,
      errorStack: null
    })
  })

  app.on('child-process-gone', (_event, details) => {
    writeErrorLog(safeGetBaseDir(resolveBaseDir), {
      source: 'system',
      event: 'child-process-gone',
      context: {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName ?? null,
        name: details.name ?? null
      },
      errorMessage: `子进程异常退出：${details.type}/${details.reason}`,
      errorStack: null
    })
  })
}

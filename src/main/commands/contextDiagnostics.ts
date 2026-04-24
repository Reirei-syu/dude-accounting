import type Database from 'better-sqlite3'
import { writeRuntimeLog } from '../services/runtimeLogger'
import type { RuntimeContext } from '../runtime/runtimeContext'

export function isContextDiagnosticsEnabled(): boolean {
  return process.env.DUDEACC_CONTEXT_DEBUG === '1'
}

export function getSqliteMainDatabasePath(db: Database.Database): string | null {
  const rows = db.pragma('database_list') as Array<{ name?: string; file?: string }>
  const main = rows.find((row) => row.name === 'main')
  return typeof main?.file === 'string' && main.file.trim() ? main.file : null
}

export function writeContextDiagnostic(
  runtime: RuntimeContext,
  input: {
    event: string
    db: Database.Database
    context?: Record<string, unknown>
  }
): void {
  if (!isContextDiagnosticsEnabled()) {
    return
  }

  writeRuntimeLog(runtime.userDataPath, {
    level: 'info',
    event: input.event,
    context: {
      platform: process.platform,
      cwd: process.cwd(),
      processExecPath: process.execPath,
      runtimeExecutablePath: runtime.executablePath,
      appDataPath: runtime.appDataPath,
      userDataPath: runtime.userDataPath,
      databasePath: getSqliteMainDatabasePath(input.db),
      ...input.context
    }
  })
}

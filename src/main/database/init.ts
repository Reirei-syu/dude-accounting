import Database from 'better-sqlite3'
import { ensurePrimaryDatabasePath } from '../services/runtimeDatabasePath'
import { getRuntimeContext } from '../runtime/runtimeContext'
import { seedAdminUser } from './seed'
import { preflightDatabaseVersion, runDatabaseMigrations } from './migrations'
import { acquireDatabaseConnectionLease, recoverDatabaseFileSwitch } from '../services/databaseFileSwitch'
import { recoverPendingFileOperations } from '../services/fileOperationStartup'

let db: Database.Database | null = null
let databasePath: string | null = null
let releaseConnectionLease: (() => void) | null = null

export function getDatabasePath(): string {
  if (databasePath) return databasePath
  const runtime = getRuntimeContext()
  databasePath = ensurePrimaryDatabasePath({
    userDataPath: runtime.userDataPath,
    isDevelopment: runtime.isDevelopment,
    executablePath: runtime.executablePath
  }).targetPath
  return databasePath
}

export function getDatabase(): Database.Database {
  if (db) return db
  const file = getDatabasePath()
  recoverDatabaseFileSwitch(file)
  releaseConnectionLease = acquireDatabaseConnectionLease(file)
  try {
    preflightDatabaseVersion(file)
    db = new Database(file)
  } catch (error) {
    releaseConnectionLease()
    releaseConnectionLease = null
    throw error
  }
  // user_version 拒绝检查之前不能改变文件的 journal_mode。
  db.pragma('foreign_keys = ON')
  return db
}

export function resetDatabaseHandle(): void {
  closeDatabase()
}

export function initializeDatabase(): void {
  const connection = getDatabase()
  try {
    runDatabaseMigrations(connection)
    connection.pragma('journal_mode = WAL')
    recoverPendingFileOperations(connection)
    connection.transaction(() => {
      seedAdminUser(connection)
      const insertSetting = connection.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)')
      insertSetting.run('allow_same_maker_auditor', '0')
      insertSetting.run('wallpaper_path', '')
    })()
  } catch (error) {
    closeDatabase()
    throw error
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
  databasePath = null
  releaseConnectionLease?.()
  releaseConnectionLease = null
}

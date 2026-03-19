import fs from 'node:fs'
import path from 'node:path'
import { ensureDirectory } from './fileIntegrity'

export const PRIMARY_DATABASE_FILE_NAME = 'dude-accounting.db'
export const RUNTIME_DATABASE_DIRECTORY_NAME = 'data'

const SQLITE_SIDECAR_SUFFIXES = ['', '-wal', '-shm']

export interface RuntimeDatabasePathOptions {
  userDataPath: string
  isDevelopment: boolean
  executablePath?: string
  installDirectory?: string
}

export interface RuntimeDatabasePathState {
  targetPath: string
  targetDirectory: string
  legacyPath: string | null
  migrated: boolean
  migratedFiles: string[]
}

function resolveInstallDirectory(options: RuntimeDatabasePathOptions): string | null {
  if (options.installDirectory) {
    const normalizedInstallDirectory = options.installDirectory.trim()
    if (normalizedInstallDirectory === '') {
      return null
    }
    return path.resolve(normalizedInstallDirectory)
  }

  const executablePath = options.executablePath ?? process.execPath
  if (!executablePath || executablePath.trim() === '') {
    return null
  }

  return path.dirname(path.resolve(executablePath))
}

export function getRuntimeDatabaseDirectory(options: RuntimeDatabasePathOptions): string {
  if (options.isDevelopment) {
    return options.userDataPath
  }

  const installDirectory = resolveInstallDirectory(options)
  if (!installDirectory) {
    return path.join(options.userDataPath, RUNTIME_DATABASE_DIRECTORY_NAME)
  }

  return path.join(installDirectory, RUNTIME_DATABASE_DIRECTORY_NAME)
}

export function getLegacyDatabasePath(
  fileName: string,
  userDataPath: string,
  isDevelopment: boolean
): string | null {
  if (isDevelopment) {
    return null
  }

  return path.join(userDataPath, fileName)
}

export function ensureRuntimeDatabasePath(
  fileName: string,
  options: RuntimeDatabasePathOptions
): RuntimeDatabasePathState {
  const targetDirectory = getRuntimeDatabaseDirectory(options)
  const targetPath = path.join(targetDirectory, fileName)
  const legacyPath = getLegacyDatabasePath(fileName, options.userDataPath, options.isDevelopment)

  ensureDirectory(targetDirectory)

  if (options.isDevelopment || fs.existsSync(targetPath) || !legacyPath || !fs.existsSync(legacyPath)) {
    return {
      targetPath,
      targetDirectory,
      legacyPath,
      migrated: false,
      migratedFiles: []
    }
  }

  const migratedFiles: string[] = []

  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sourcePath = `${legacyPath}${suffix}`
    if (!fs.existsSync(sourcePath)) {
      continue
    }

    const targetFilePath = `${targetPath}${suffix}`
    fs.copyFileSync(sourcePath, targetFilePath)
    migratedFiles.push(targetFilePath)
  }

  return {
    targetPath,
    targetDirectory,
    legacyPath,
    migrated: migratedFiles.length > 0,
    migratedFiles
  }
}

export function ensurePrimaryDatabasePath(
  options: RuntimeDatabasePathOptions
): RuntimeDatabasePathState {
  return ensureRuntimeDatabasePath(PRIMARY_DATABASE_FILE_NAME, options)
}

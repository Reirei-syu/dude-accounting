import fs from 'node:fs'
import path from 'node:path'
import { ensureDirectory } from './fileIntegrity'

const DIAGNOSTIC_LOG_FILE_PATTERN = /^(runtime|error)-(\d{4})-(\d{2})-(\d{2})\.jsonl$/i

interface DiagnosticsLogPathConfigPayload {
  directoryPath?: string
}

interface DiagnosticsLogPathOptions {
  executablePath?: string
  installDirectory?: string
  useInstallDirectoryAsDefault?: boolean
}

export interface DiagnosticsLogPathState {
  mode: 'default' | 'custom'
  defaultDirectory: string
  customDirectory: string | null
  activeDirectory: string
}

function getDiagnosticsLogPathConfigFile(baseDir: string): string {
  return path.join(baseDir, 'config', 'diagnostics-log-path.json')
}

function normalizeDiagnosticsLogDirectory(directoryPath: string): string {
  const trimmed = directoryPath.trim()
  if (trimmed === '') {
    throw new Error('日志保存路径不能为空')
  }

  const resolved = path.resolve(trimmed)
  if (!path.isAbsolute(resolved)) {
    throw new Error('日志保存路径必须是绝对路径')
  }

  return resolved
}

function readDiagnosticsLogPathConfig(baseDir: string): string | null {
  const configFilePath = getDiagnosticsLogPathConfigFile(baseDir)
  if (!fs.existsSync(configFilePath)) {
    return null
  }

  try {
    const payload = JSON.parse(
      fs.readFileSync(configFilePath, 'utf8')
    ) as DiagnosticsLogPathConfigPayload
    if (!payload || typeof payload.directoryPath !== 'string') {
      return null
    }
    return normalizeDiagnosticsLogDirectory(payload.directoryPath)
  } catch {
    return null
  }
}

function writeDiagnosticsLogPathConfig(baseDir: string, directoryPath: string): void {
  const configFilePath = getDiagnosticsLogPathConfigFile(baseDir)
  ensureDirectory(path.dirname(configFilePath))
  fs.writeFileSync(
    configFilePath,
    JSON.stringify(
      {
        directoryPath
      },
      null,
      2
    ),
    'utf8'
  )
}

function parseDiagnosticLogDate(fileName: string): Date | null {
  const matched = fileName.match(DIAGNOSTIC_LOG_FILE_PATTERN)
  if (!matched) {
    return null
  }

  const year = Number(matched[2])
  const month = Number(matched[3])
  const day = Number(matched[4])

  return new Date(year, month - 1, day)
}

function getRetentionCutoff(now: Date): Date {
  const previousMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  const targetDay = Math.min(now.getDate(), previousMonthDays)
  return new Date(now.getFullYear(), now.getMonth() - 1, targetDay)
}

export function getDefaultDiagnosticsLogDirectory(
  baseDir: string,
  _options: DiagnosticsLogPathOptions = {}
): string {
  return path.join(baseDir, 'logs')
}

export function getDiagnosticsLogPathState(
  baseDir: string,
  options: DiagnosticsLogPathOptions = {}
): DiagnosticsLogPathState {
  const defaultDirectory = getDefaultDiagnosticsLogDirectory(baseDir, options)
  const customDirectory = readDiagnosticsLogPathConfig(baseDir)

  return {
    mode: customDirectory ? 'custom' : 'default',
    defaultDirectory,
    customDirectory,
    activeDirectory: customDirectory ?? defaultDirectory
  }
}

export function resolveDiagnosticsLogDirectory(
  baseDir: string,
  options: DiagnosticsLogPathOptions = {}
): string {
  return getDiagnosticsLogPathState(baseDir, options).activeDirectory
}

export function pruneExpiredDiagnosticsLogs(
  directoryPath: string,
  now: Date = new Date()
): string[] {
  if (!fs.existsSync(directoryPath)) {
    return []
  }

  const cutoff = getRetentionCutoff(now)
  const deletedPaths: string[] = []

  for (const fileName of fs.readdirSync(directoryPath)) {
    const fileDate = parseDiagnosticLogDate(fileName)
    if (!fileDate || fileDate >= cutoff) {
      continue
    }

    const targetPath = path.join(directoryPath, fileName)
    fs.rmSync(targetPath, { force: true })
    deletedPaths.push(targetPath)
  }

  return deletedPaths
}

export function setDiagnosticsLogDirectory(
  baseDir: string,
  directoryPath: string
): DiagnosticsLogPathState {
  const normalizedDirectory = normalizeDiagnosticsLogDirectory(directoryPath)
  ensureDirectory(normalizedDirectory)
  writeDiagnosticsLogPathConfig(baseDir, normalizedDirectory)
  return getDiagnosticsLogPathState(baseDir)
}

export function resetDiagnosticsLogDirectory(baseDir: string): DiagnosticsLogPathState {
  const configFilePath = getDiagnosticsLogPathConfigFile(baseDir)
  if (fs.existsSync(configFilePath)) {
    fs.rmSync(configFilePath, { force: true })
  }
  return getDiagnosticsLogPathState(baseDir)
}

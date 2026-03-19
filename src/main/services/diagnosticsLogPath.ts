import fs from 'node:fs'
import path from 'node:path'
import { ensureDirectory } from './fileIntegrity'

interface DiagnosticsLogPathConfigPayload {
  directoryPath?: string
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

export function getDefaultDiagnosticsLogDirectory(baseDir: string): string {
  return path.join(baseDir, 'logs')
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
    const payload = JSON.parse(fs.readFileSync(configFilePath, 'utf8')) as DiagnosticsLogPathConfigPayload
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

export function getDiagnosticsLogPathState(baseDir: string): DiagnosticsLogPathState {
  const defaultDirectory = getDefaultDiagnosticsLogDirectory(baseDir)
  const customDirectory = readDiagnosticsLogPathConfig(baseDir)

  return {
    mode: customDirectory ? 'custom' : 'default',
    defaultDirectory,
    customDirectory,
    activeDirectory: customDirectory ?? defaultDirectory
  }
}

export function resolveDiagnosticsLogDirectory(baseDir: string): string {
  return getDiagnosticsLogPathState(baseDir).activeDirectory
}

export function setDiagnosticsLogDirectory(baseDir: string, directoryPath: string): DiagnosticsLogPathState {
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

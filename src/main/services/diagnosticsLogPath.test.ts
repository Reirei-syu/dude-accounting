import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDefaultDiagnosticsLogDirectory,
  getDiagnosticsLogPathState,
  pruneExpiredDiagnosticsLogs,
  resetDiagnosticsLogDirectory,
  resolveDiagnosticsLogDirectory,
  setDiagnosticsLogDirectory
} from './diagnosticsLogPath'

describe('diagnosticsLogPath service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('uses userData/logs by default in development-like environments', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))

    expect(getDiagnosticsLogPathState(tempDir, { useInstallDirectoryAsDefault: false })).toEqual({
      mode: 'default',
      defaultDirectory: path.join(tempDir, 'logs'),
      customDirectory: null,
      activeDirectory: path.join(tempDir, 'logs')
    })
    expect(resolveDiagnosticsLogDirectory(tempDir, { useInstallDirectoryAsDefault: false })).toBe(
      path.join(tempDir, 'logs')
    )
  })

  it('uses install-directory logs by default in packaged environments', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))

    expect(
      getDefaultDiagnosticsLogDirectory(tempDir, {
        useInstallDirectoryAsDefault: true,
        executablePath: 'D:/Program Files/Dude Accounting/Dude Accounting.exe'
      })
    ).toBe(path.join('D:/Program Files/Dude Accounting', 'logs'))
  })

  it('persists a custom diagnostics log directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))
    const customDirectory = path.join(tempDir, 'custom-logs')

    const nextState = setDiagnosticsLogDirectory(tempDir, customDirectory)

    expect(nextState).toEqual({
      mode: 'custom',
      defaultDirectory: path.join(tempDir, 'logs'),
      customDirectory,
      activeDirectory: customDirectory
    })
    expect(resolveDiagnosticsLogDirectory(tempDir)).toBe(customDirectory)
  })

  it('resets back to the default diagnostics log directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))
    setDiagnosticsLogDirectory(tempDir, path.join(tempDir, 'custom-logs'))

    const nextState = resetDiagnosticsLogDirectory(tempDir)

    expect(nextState.mode).toBe('default')
    expect(nextState.customDirectory).toBeNull()
    expect(nextState.activeDirectory).toBe(path.join(tempDir, 'logs'))
  })

  it('rejects blank diagnostics log directories', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))

    expect(() => setDiagnosticsLogDirectory(tempDir, '   ')).toThrow('日志保存路径不能为空')
  })

  it('prunes runtime and error logs older than one month', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))
    const logDirectory = path.join(tempDir, 'logs')
    fs.mkdirSync(logDirectory, { recursive: true })
    fs.writeFileSync(path.join(logDirectory, 'runtime-2026-02-18.jsonl'), 'old', 'utf8')
    fs.writeFileSync(path.join(logDirectory, 'error-2026-02-19.jsonl'), 'keep', 'utf8')
    fs.writeFileSync(path.join(logDirectory, 'runtime-2026-03-19.jsonl'), 'keep', 'utf8')

    const deletedPaths = pruneExpiredDiagnosticsLogs(logDirectory, new Date('2026-03-19T10:20:30'))

    expect(deletedPaths.map((filePath) => path.basename(filePath))).toEqual([
      'runtime-2026-02-18.jsonl'
    ])
    expect(fs.existsSync(path.join(logDirectory, 'runtime-2026-02-18.jsonl'))).toBe(false)
    expect(fs.existsSync(path.join(logDirectory, 'error-2026-02-19.jsonl'))).toBe(true)
    expect(fs.existsSync(path.join(logDirectory, 'runtime-2026-03-19.jsonl'))).toBe(true)
  })
})

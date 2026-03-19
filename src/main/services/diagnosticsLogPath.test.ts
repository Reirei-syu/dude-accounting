import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getDefaultDiagnosticsLogDirectory,
  getDiagnosticsLogPathState,
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

  it('uses userData/logs by default', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-diagnostics-path-'))

    expect(getDiagnosticsLogPathState(tempDir)).toEqual({
      mode: 'default',
      defaultDirectory: path.join(tempDir, 'logs'),
      customDirectory: null,
      activeDirectory: path.join(tempDir, 'logs')
    })
    expect(resolveDiagnosticsLogDirectory(tempDir)).toBe(path.join(tempDir, 'logs'))
    expect(getDefaultDiagnosticsLogDirectory(tempDir)).toBe(path.join(tempDir, 'logs'))
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
})

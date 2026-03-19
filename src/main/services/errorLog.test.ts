import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportDiagnosticLogs,
  getErrorLogFilePath,
  getErrorLogStatus,
  listDiagnosticLogFiles,
  writeErrorLog,
  writeRendererErrorLog
} from './errorLog'

describe('errorLog service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('writes structured error logs into daily jsonl files', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-error-log-'))
    const now = new Date('2026-03-19T10:20:30')

    const filePath = writeErrorLog(
      tempDir,
      {
        source: 'process',
        event: 'uncaughtException',
        errorMessage: '磁盘写入失败',
        context: { pid: 1234 }
      },
      now
    )

    expect(filePath).toBe(getErrorLogFilePath(tempDir, now))
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      source: 'process',
      event: 'uncaughtException',
      errorMessage: '磁盘写入失败',
      context: { pid: 1234 }
    })
  })

  it('writes renderer errors with normalized payload fields', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-error-log-'))

    writeRendererErrorLog(tempDir, {
      type: 'unhandledrejection',
      reason: 'Promise rejected',
      stack: 'stack-line',
      href: 'app://index.html'
    })

    const entry = JSON.parse(fs.readFileSync(getErrorLogFilePath(tempDir), 'utf8').trim())
    expect(entry).toMatchObject({
      source: 'renderer',
      event: 'window.unhandledrejection',
      errorMessage: 'Promise rejected',
      errorStack: 'stack-line',
      context: {
        href: 'app://index.html'
      }
    })
  })

  it('reports runtime and error log paths for settings display', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-error-log-'))
    const now = new Date('2026-03-19T10:20:30')

    const initialStatus = getErrorLogStatus(tempDir, now)
    expect(initialStatus.runtimeLogExists).toBe(false)
    expect(initialStatus.errorLogExists).toBe(false)

    writeErrorLog(tempDir, {
      source: 'main',
      event: 'manual-test',
      errorMessage: 'boom'
    }, now)

    const nextStatus = getErrorLogStatus(tempDir, now)
    expect(nextStatus.logDirectory).toBe(path.join(tempDir, 'logs'))
    expect(nextStatus.errorLogPath).toBe(getErrorLogFilePath(tempDir, now))
    expect(nextStatus.errorLogExists).toBe(true)
  })

  it('lists and exports runtime and error logs into a timestamped directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-error-log-'))
    const now = new Date('2026-03-19T10:20:30')
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-error-export-'))

    writeErrorLog(
      tempDir,
      {
        source: 'main',
        event: 'manual-test',
        errorMessage: 'boom'
      },
      now
    )
    fs.mkdirSync(path.join(tempDir, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'), '{"ok":true}\n', 'utf8')

    const listedFiles = listDiagnosticLogFiles(tempDir)
    expect(listedFiles.map((filePath) => path.basename(filePath))).toEqual([
      'error-2026-03-19.jsonl',
      'runtime-2026-03-19.jsonl'
    ])

    const exported = exportDiagnosticLogs(tempDir, exportRoot, now)

    expect(path.basename(exported.exportDirectory)).toBe('DudeAccounting-logs-20260319-102030')
    expect(exported.filePaths.map((filePath) => path.basename(filePath))).toEqual([
      'error-2026-03-19.jsonl',
      'runtime-2026-03-19.jsonl'
    ])
    expect(fs.existsSync(exported.filePaths[0])).toBe(true)
    expect(fs.existsSync(exported.filePaths[1])).toBe(true)

    fs.rmSync(exportRoot, { recursive: true, force: true })
  })
})

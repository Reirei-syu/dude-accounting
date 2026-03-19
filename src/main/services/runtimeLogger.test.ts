import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setDiagnosticsLogDirectory } from './diagnosticsLogPath'
import { getRuntimeLogFilePath, withIpcTelemetry, writeRuntimeLog } from './runtimeLogger'

describe('runtimeLogger service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('writes structured runtime logs into daily jsonl files', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-log-'))
    const now = new Date('2026-03-15T09:30:00')

    const filePath = writeRuntimeLog(
      tempDir,
      {
        level: 'info',
        event: 'ipc.invoke',
        channel: 'reporting:generate',
        status: 'success',
        durationMs: 28,
        context: { ledgerId: 1 }
      },
      now
    )

    expect(filePath).toBe(getRuntimeLogFilePath(tempDir, now))
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({
      level: 'info',
      event: 'ipc.invoke',
      channel: 'reporting:generate',
      status: 'success',
      durationMs: 28,
      context: { ledgerId: 1 }
    })
  })

  it('records warn telemetry for handled ipc failures', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-log-'))

    const result = await withIpcTelemetry(
      {
        channel: 'backup:create',
        baseDir: tempDir,
        context: { ledgerId: 2 }
      },
      async () => ({ success: false, error: '创建失败' })
    )

    expect(result).toEqual({ success: false, error: '创建失败' })
    const logFile = getRuntimeLogFilePath(tempDir)
    const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim())
    expect(entry).toMatchObject({
      level: 'warn',
      channel: 'backup:create',
      status: 'failed',
      errorMessage: '创建失败',
      context: { ledgerId: 2 }
    })
  })

  it('records error telemetry for thrown ipc failures', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-log-'))

    await expect(() =>
      withIpcTelemetry(
        {
          channel: 'archive:export',
          baseDir: tempDir,
          context: { ledgerId: 3 }
        },
        async () => {
          throw new Error('磁盘写入失败')
        }
      )
    ).rejects.toThrow('磁盘写入失败')

    const logFile = getRuntimeLogFilePath(tempDir)
    const entry = JSON.parse(fs.readFileSync(logFile, 'utf8').trim())
    expect(entry).toMatchObject({
      level: 'error',
      channel: 'archive:export',
      status: 'thrown',
      errorMessage: '磁盘写入失败',
      context: { ledgerId: 3 }
    })
  })

  it('writes runtime logs into the custom diagnostics log directory when configured', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-log-'))
    const now = new Date('2026-03-15T09:30:00')
    const customDirectory = path.join(tempDir, 'custom-logs')
    setDiagnosticsLogDirectory(tempDir, customDirectory)

    const filePath = writeRuntimeLog(
      tempDir,
      {
        level: 'info',
        event: 'ipc.invoke',
        channel: 'reporting:generate',
        status: 'success'
      },
      now
    )

    expect(filePath).toBe(path.join(customDirectory, 'runtime-2026-03-15.jsonl'))
    expect(getRuntimeLogFilePath(tempDir, now)).toBe(
      path.join(customDirectory, 'runtime-2026-03-15.jsonl')
    )
  })
})

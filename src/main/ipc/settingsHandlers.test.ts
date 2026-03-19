import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settingsMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) =>
      name === 'documents' ? 'D:/Documents' : path.join(os.tmpdir(), 'dude-settings-log-test')
    ),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    shellOpenPath: vi.fn(),
    browserFromWebContents: vi.fn(() => null),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    getDatabase: vi.fn(() => ({ prepare: vi.fn(), transaction: vi.fn((cb) => cb) })),
    appendOperationLog: vi.fn(),
    getErrorLogStatus: vi.fn(),
    exportDiagnosticLogs: vi.fn(),
    requireAuth: vi.fn(),
    requireAdmin: vi.fn(),
    requirePermission: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: settingsMocks.appGetPath },
  BrowserWindow: { fromWebContents: settingsMocks.browserFromWebContents },
  dialog: {
    showOpenDialog: settingsMocks.showOpenDialog,
    showSaveDialog: settingsMocks.showSaveDialog
  },
  ipcMain: {
    handle: settingsMocks.ipcHandle
  },
  shell: {
    openPath: settingsMocks.shellOpenPath
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: settingsMocks.getDatabase
}))

vi.mock('../services/auditLog', () => ({
  appendOperationLog: settingsMocks.appendOperationLog
}))

vi.mock('../services/subjectTemplate', () => ({
  clearCustomTopLevelSubjectTemplate: vi.fn(),
  clearIndependentCustomSubjectTemplateEntries: vi.fn(),
  deleteIndependentCustomSubjectTemplate: vi.fn(),
  getCustomTopLevelSubjectTemplate: vi.fn(),
  getIndependentCustomSubjectTemplate: vi.fn(),
  getStandardTopLevelSubjectReferences: vi.fn(),
  listIndependentCustomSubjectTemplates: vi.fn(),
  readCustomTopLevelSubjectTemplateImport: vi.fn(),
  saveIndependentCustomSubjectTemplate: vi.fn(),
  saveCustomTopLevelSubjectTemplate: vi.fn(),
  writeCustomTopLevelSubjectImportTemplate: vi.fn()
}))

vi.mock('../services/wallpaperPreference', () => ({
  getLoginWallpaperState: vi.fn(),
  getUserWallpaperState: vi.fn(),
  replaceUserWallpaperFromBuffer: vi.fn(),
  restoreDefaultWallpaper: vi.fn(),
  validateWallpaperSourceFile: vi.fn(),
  WALLPAPER_SUPPORTED_FORMATS: ['png', 'jpg']
}))

vi.mock('../services/errorLog', () => ({
  getErrorLogStatus: settingsMocks.getErrorLogStatus,
  exportDiagnosticLogs: settingsMocks.exportDiagnosticLogs
}))

vi.mock('./session', () => ({
  requireAuth: settingsMocks.requireAuth,
  requireAdmin: settingsMocks.requireAdmin,
  requirePermission: settingsMocks.requirePermission
}))

import { registerSettingsHandlers } from './settings'

describe('settings IPC handlers', () => {
  let tempDir = ''

  beforeEach(() => {
    settingsMocks.handlers.clear()
    vi.clearAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-settings-log-'))
    settingsMocks.appGetPath.mockImplementation((name: string) =>
      name === 'documents' ? 'D:/Documents' : tempDir
    )
    settingsMocks.requireAuth.mockReturnValue({ id: 1, username: 'tester' })
    settingsMocks.getErrorLogStatus.mockReturnValue({
      logDirectory: path.join(tempDir, 'logs'),
      runtimeLogPath: path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'),
      errorLogPath: path.join(tempDir, 'logs', 'error-2026-03-19.jsonl'),
      runtimeLogExists: false,
      errorLogExists: false
    })
    settingsMocks.exportDiagnosticLogs.mockReturnValue({
      exportDirectory: path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000'),
      filePaths: [
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'runtime-2026-03-19.jsonl'),
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'error-2026-03-19.jsonl')
      ]
    })

    registerSettingsHandlers()
  })

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('returns the current error log status through settings:getErrorLogStatus', async () => {
    const handler = settingsMocks.handlers.get('settings:getErrorLogStatus')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.requireAuth).toHaveBeenCalledTimes(1)
    expect(settingsMocks.getErrorLogStatus).toHaveBeenCalledWith(tempDir)
    expect(result).toMatchObject({
      logDirectory: path.join(tempDir, 'logs'),
      runtimeLogExists: false,
      errorLogExists: false
    })
  })

  it('creates and opens the error log directory when requested', async () => {
    settingsMocks.shellOpenPath.mockResolvedValue('')
    const handler = settingsMocks.handlers.get('settings:openErrorLogDirectory')
    const event = { sender: { id: 1 } }
    const logDirectory = path.join(tempDir, 'logs')

    const result = await handler?.(event)

    expect(fs.existsSync(logDirectory)).toBe(true)
    expect(settingsMocks.shellOpenPath).toHaveBeenCalledWith(logDirectory)
    expect(result).toEqual({
      success: true,
      logDirectory
    })
  })

  it('returns a stable error payload when opening the log directory fails', async () => {
    settingsMocks.shellOpenPath.mockResolvedValue('failed to open directory')
    const handler = settingsMocks.handlers.get('settings:openErrorLogDirectory')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(result).toEqual({
      success: false,
      error: 'failed to open directory'
    })
  })

  it('exports diagnostics logs into the selected directory', async () => {
    settingsMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/Logs']
    })
    const handler = settingsMocks.handlers.get('settings:exportDiagnosticsLogs')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(settingsMocks.showOpenDialog.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: path.join('D:/Documents', 'Dude Accounting', '日志导出'),
      properties: ['openDirectory', 'createDirectory']
    })
    expect(settingsMocks.exportDiagnosticLogs).toHaveBeenCalledWith(tempDir, 'D:/Logs')
    expect(result).toEqual({
      success: true,
      exportDirectory: path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000'),
      filePaths: [
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'runtime-2026-03-19.jsonl'),
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'error-2026-03-19.jsonl')
      ]
    })
  })

  it('returns a stable error payload when diagnostics export has no files', async () => {
    settingsMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/Logs']
    })
    settingsMocks.exportDiagnosticLogs.mockImplementation(() => {
      throw new Error('暂无可导出的日志文件')
    })
    const handler = settingsMocks.handlers.get('settings:exportDiagnosticsLogs')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(result).toEqual({
      success: false,
      error: '暂无可导出的日志文件'
    })
  })
})

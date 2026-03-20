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
    setDiagnosticsLogDirectory: vi.fn(),
    resetDiagnosticsLogDirectory: vi.fn(),
    getSystemParamSnapshot: vi.fn(),
    getRuntimeDefaultsSnapshot: vi.fn(),
    isSystemParamKey: vi.fn(),
    updateSystemParam: vi.fn(),
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

vi.mock('../services/diagnosticsLogPath', () => ({
  setDiagnosticsLogDirectory: settingsMocks.setDiagnosticsLogDirectory,
  resetDiagnosticsLogDirectory: settingsMocks.resetDiagnosticsLogDirectory
}))

vi.mock('../services/systemSettings', () => ({
  getSystemParamSnapshot: settingsMocks.getSystemParamSnapshot,
  getRuntimeDefaultsSnapshot: settingsMocks.getRuntimeDefaultsSnapshot,
  isSystemParamKey: settingsMocks.isSystemParamKey,
  updateSystemParam: settingsMocks.updateSystemParam
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
    settingsMocks.requirePermission.mockReturnValue({ id: 1, username: 'tester' })
    settingsMocks.getErrorLogStatus.mockReturnValue({
      mode: 'default',
      defaultLogDirectory: path.join(tempDir, 'logs'),
      customLogDirectory: null,
      logDirectory: path.join(tempDir, 'logs'),
      runtimeLogPath: path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'),
      errorLogPath: path.join(tempDir, 'logs', 'error-2026-03-19.jsonl'),
      runtimeLogExists: false,
      errorLogExists: false
    })
    settingsMocks.getSystemParamSnapshot.mockReturnValue({
      allow_same_maker_auditor: '0',
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
    settingsMocks.getRuntimeDefaultsSnapshot.mockReturnValue({
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
    settingsMocks.isSystemParamKey.mockReturnValue(true)
    settingsMocks.updateSystemParam.mockReturnValue({
      previousValue: '记',
      nextValue: '转',
      changed: true
    })
    settingsMocks.exportDiagnosticLogs.mockReturnValue({
      exportDirectory: path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000'),
      filePaths: [
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'runtime-2026-03-19.jsonl'),
        path.join('D:/Logs', 'DudeAccounting-logs-20260319-120000', 'error-2026-03-19.jsonl')
      ]
    })
    settingsMocks.setDiagnosticsLogDirectory.mockReturnValue({
      mode: 'custom',
      defaultDirectory: path.join(tempDir, 'logs'),
      customDirectory: 'D:/CustomLogs',
      activeDirectory: 'D:/CustomLogs'
    })
    settingsMocks.resetDiagnosticsLogDirectory.mockReturnValue({
      mode: 'default',
      defaultDirectory: path.join(tempDir, 'logs'),
      customDirectory: null,
      activeDirectory: path.join(tempDir, 'logs')
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

    expect(settingsMocks.requirePermission).toHaveBeenCalledWith(event, 'system_settings')
    expect(settingsMocks.getErrorLogStatus).toHaveBeenCalledWith(tempDir)
    expect(result).toMatchObject({
      mode: 'default',
      defaultLogDirectory: path.join(tempDir, 'logs'),
      customLogDirectory: null,
      logDirectory: path.join(tempDir, 'logs'),
      runtimeLogExists: false,
      errorLogExists: false
    })
  })

  it('changes the diagnostics log directory and returns the refreshed status', async () => {
    settingsMocks.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['D:/CustomLogs']
    })
    settingsMocks.getErrorLogStatus
      .mockReturnValueOnce({
        mode: 'default',
        defaultLogDirectory: path.join(tempDir, 'logs'),
        customLogDirectory: null,
        logDirectory: path.join(tempDir, 'logs'),
        runtimeLogPath: path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'),
        errorLogPath: path.join(tempDir, 'logs', 'error-2026-03-19.jsonl'),
        runtimeLogExists: false,
        errorLogExists: false
      })
      .mockReturnValueOnce({
        mode: 'custom',
        defaultLogDirectory: path.join(tempDir, 'logs'),
        customLogDirectory: 'D:/CustomLogs',
        logDirectory: 'D:/CustomLogs',
        runtimeLogPath: 'D:/CustomLogs/runtime-2026-03-19.jsonl',
        errorLogPath: 'D:/CustomLogs/error-2026-03-19.jsonl',
        runtimeLogExists: false,
        errorLogExists: false
      })
    const handler = settingsMocks.handlers.get('settings:chooseDiagnosticsLogDirectory')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.showOpenDialog.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: path.join(tempDir, 'logs'),
      properties: ['openDirectory', 'createDirectory']
    })
    expect(settingsMocks.setDiagnosticsLogDirectory).toHaveBeenCalledWith(
      tempDir,
      'D:/CustomLogs'
    )
    expect(settingsMocks.appendOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'set_diagnostics_log_directory',
        targetType: 'diagnostics_log_directory'
      })
    )
    expect(result).toEqual({
      success: true,
      status: {
        mode: 'custom',
        defaultLogDirectory: path.join(tempDir, 'logs'),
        customLogDirectory: 'D:/CustomLogs',
        logDirectory: 'D:/CustomLogs',
        runtimeLogPath: 'D:/CustomLogs/runtime-2026-03-19.jsonl',
        errorLogPath: 'D:/CustomLogs/error-2026-03-19.jsonl',
        runtimeLogExists: false,
        errorLogExists: false
      }
    })
  })

  it('restores the default diagnostics log directory and returns the refreshed status', async () => {
    settingsMocks.getErrorLogStatus.mockReturnValue({
      mode: 'default',
      defaultLogDirectory: path.join(tempDir, 'logs'),
      customLogDirectory: null,
      logDirectory: path.join(tempDir, 'logs'),
      runtimeLogPath: path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'),
      errorLogPath: path.join(tempDir, 'logs', 'error-2026-03-19.jsonl'),
      runtimeLogExists: false,
      errorLogExists: false
    })
    const handler = settingsMocks.handlers.get('settings:restoreDefaultDiagnosticsLogDirectory')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.resetDiagnosticsLogDirectory).toHaveBeenCalledWith(tempDir)
    expect(settingsMocks.appendOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'restore_default_diagnostics_log_directory',
        targetType: 'diagnostics_log_directory'
      })
    )
    expect(result).toEqual({
      success: true,
      status: {
        mode: 'default',
        defaultLogDirectory: path.join(tempDir, 'logs'),
        customLogDirectory: null,
        logDirectory: path.join(tempDir, 'logs'),
        runtimeLogPath: path.join(tempDir, 'logs', 'runtime-2026-03-19.jsonl'),
        errorLogPath: path.join(tempDir, 'logs', 'error-2026-03-19.jsonl'),
        runtimeLogExists: false,
        errorLogExists: false
      }
    })
  })

  it('returns the whitelisted system params through settings:getSystemParams', async () => {
    const handler = settingsMocks.handlers.get('settings:getSystemParams')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.requirePermission).toHaveBeenCalledWith(event, 'system_settings')
    expect(settingsMocks.getSystemParamSnapshot).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      allow_same_maker_auditor: '0',
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
  })

  it('returns runtime defaults through settings:getRuntimeDefaults', async () => {
    const handler = settingsMocks.handlers.get('settings:getRuntimeDefaults')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event)

    expect(settingsMocks.requireAuth).toHaveBeenCalledWith(event)
    expect(settingsMocks.getRuntimeDefaultsSnapshot).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      default_voucher_word: '记',
      new_voucher_date_strategy: 'last_voucher_date',
      voucher_list_default_status: 'all'
    })
  })

  it('creates and opens the error log directory when requested', async () => {
    settingsMocks.shellOpenPath.mockResolvedValue('')
    const handler = settingsMocks.handlers.get('settings:openErrorLogDirectory')
    const event = { sender: { id: 1 } }
    const logDirectory = path.join(tempDir, 'logs')

    const result = await handler?.(event)

    expect(settingsMocks.requirePermission).toHaveBeenCalledWith(event, 'system_settings')
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

    expect(settingsMocks.requirePermission).toHaveBeenCalledWith(event, 'system_settings')
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

    expect(settingsMocks.requirePermission).toHaveBeenCalledWith(event, 'system_settings')
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

  it('writes an operation log when a system param changes', async () => {
    const handler = settingsMocks.handlers.get('settings:setSystemParam')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, 'default_voucher_word', '转')

    expect(settingsMocks.isSystemParamKey).toHaveBeenCalledWith('default_voucher_word')
    expect(settingsMocks.updateSystemParam).toHaveBeenCalledWith(
      expect.anything(),
      'default_voucher_word',
      '转'
    )
    expect(settingsMocks.appendOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        module: 'settings',
        action: 'set_system_param',
        targetType: 'system_setting',
        targetId: 'default_voucher_word',
        details: {
          key: 'default_voucher_word',
          previousValue: '记',
          nextValue: '转'
        }
      })
    )
    expect(result).toEqual({
      success: true,
      key: 'default_voucher_word',
      value: '转',
      changed: true
    })
  })

  it('rejects unsupported system param keys with a stable payload', async () => {
    settingsMocks.isSystemParamKey.mockReturnValue(false)
    const handler = settingsMocks.handlers.get('settings:setSystemParam')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, 'subject_template.enterprise', 'broken')

    expect(settingsMocks.updateSystemParam).not.toHaveBeenCalled()
    expect(settingsMocks.appendOperationLog).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      error: '不支持修改系统参数 subject_template.enterprise'
    })
  })

  it('returns a stable error payload when system param validation fails', async () => {
    settingsMocks.updateSystemParam.mockImplementation(() => {
      throw new Error('系统参数 default_voucher_word 的值无效')
    })
    const handler = settingsMocks.handlers.get('settings:setSystemParam')
    const event = { sender: { id: 1 } }

    const result = await handler?.(event, 'default_voucher_word', '坏值')

    expect(settingsMocks.appendOperationLog).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      error: '系统参数 default_voucher_word 的值无效'
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

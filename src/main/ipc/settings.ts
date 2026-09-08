import { openDiagnosticsDirectoryCommand } from '../commands/settingsCommands'
import { checkDiagnosticsExportCommand } from '../commands/settingsCommands'
import {
  getPublicLoginWallpaperStateCommand,
  getDiagnosticsStatusCommand
} from '../commands/settingsCommands'
import { createCommandContext } from '../commands/context'
import {
  analyzeWallpaperCommand,
  applyWallpaperCommand,
  restoreWallpaperCommand
} from '../commands/settingsCommands'
import {
  setDiagnosticsDirectoryCommand,
  resetDiagnosticsDirectoryCommand,
  exportDiagnosticsLogsCommand
} from '../commands/settingsCommands'
import {
  importSubjectTemplateCommand,
  parseSubjectTemplateImportCommand,
  downloadSubjectTemplateCommand
} from '../commands/settingsCommands'
import {
  saveSubjectTemplateCommand,
  saveCustomTemplateCommand,
  clearSubjectTemplateCommand,
  clearCustomTemplateEntriesCommand,
  deleteCustomTemplateCommand
} from '../commands/settingsCommands'
import {
  getWallpaperStateCommand,
  getSubjectTemplateCommand,
  getSubjectTemplateReferenceCommand,
  listCustomTemplatesCommand,
  getCustomTemplateCommand
} from '../commands/settingsCommands'
import {
  getSystemParamsCommand,
  getRuntimeDefaultsCommand,
  getUserPreferencesCommand,
  setUserPreferencesCommand,
  setSystemParamCommand
} from '../commands/settingsCommands'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import { handleInvoke } from './typedInvoke'
import type { CommandResult } from '../../shared/contracts/commandResult'
import { app, BrowserWindow, dialog } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { WALLPAPER_SUPPORTED_FORMATS } from '../services/wallpaperPreference'
import { readWallpaperSourceAsDataUrl } from '../services/wallpaperCropService'
import { getPathPreferenceWithFallback } from '../services/pathPreference'
import { requireAdmin, requireAuth, requirePermission } from './session'

type StandardType = 'enterprise' | 'npo'

function unwrapSettingsResult<T>(result: CommandResult<T>): T {
  if (result.status === 'success') return result.data as T
  throw new Error(result.error?.message ?? '设置操作失败')
}

function legacySettingsResult<T, M extends Record<string, unknown>>(
  result: CommandResult<T>,
  mapData: (data: T) => M,
  fallback: string
): ({ success: true } & M) | { success: false; error: string } {
  if (isCommandSuccess(result)) return { success: true, ...mapData(result.data) }
  const message = result.error?.message
  return { success: false, error: !message || message === '未知错误' ? fallback : message }
}

async function legacySettingsCommand<T, M extends Record<string, unknown>>(
  operation: () => Promise<CommandResult<T>>,
  mapData: (data: T) => M,
  fallback: string
): Promise<({ success: true } & M) | { success: false; error: string }> {
  try {
    return legacySettingsResult(await operation(), mapData, fallback)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : fallback }
  }
}

const DIAGNOSTICS_EXPORT_LAST_DIR_KEY = 'diagnostics_export_last_dir'
const SUBJECT_TEMPLATE_DOWNLOAD_LAST_DIR_KEY = 'subject_template_download_last_dir'

function getTemplateDefaultFileName(standardType: StandardType): string {
  return standardType === 'enterprise' ? '企业一级科目导入模板.xlsx' : '民非一级科目导入模板.xlsx'
}

function getDefaultTemplateDownloadDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '导入模板')
}

function getTemplateDefaultPath(
  db: ReturnType<typeof getDatabase>,
  standardType: StandardType
): string {
  const preferredDir =
    getPathPreferenceWithFallback(db, [SUBJECT_TEMPLATE_DOWNLOAD_LAST_DIR_KEY]) ??
    getDefaultTemplateDownloadDir()
  return path.join(preferredDir, getTemplateDefaultFileName(standardType))
}

function getDefaultDiagnosticsExportDir(db: ReturnType<typeof getDatabase>): string {
  return (
    getPathPreferenceWithFallback(db, [DIAGNOSTICS_EXPORT_LAST_DIR_KEY]) ??
    path.join(app.getPath('documents'), 'Dude Accounting', '日志导出')
  )
}

export function registerSettingsHandlers(): void {
  const db = getDatabase()

  // 读取系统参数
  handleInvoke('settings:getSystemParams', async (event) => {
    return unwrapSettingsResult(await getSystemParamsCommand(createCommandContextFromEvent(event)))
  })

  handleInvoke('settings:getRuntimeDefaults', async (event) => {
    return unwrapSettingsResult(
      await getRuntimeDefaultsCommand(createCommandContextFromEvent(event))
    )
  })

  handleInvoke('settings:getUserPreferences', async (event) => {
    return unwrapSettingsResult(
      await getUserPreferencesCommand(createCommandContextFromEvent(event))
    )
  })

  handleInvoke('settings:getWallpaperState', async (event) => {
    return unwrapSettingsResult(
      await getWallpaperStateCommand(createCommandContextFromEvent(event))
    )
  })

  handleInvoke('settings:getLoginWallpaperState', async () => {
    return unwrapSettingsResult(await getPublicLoginWallpaperStateCommand(createCommandContext()))
  })

  handleInvoke('settings:getErrorLogStatus', async (event) => {
    return unwrapSettingsResult(
      await getDiagnosticsStatusCommand(createCommandContextFromEvent(event))
    )
  })

  handleInvoke('settings:chooseDiagnosticsLogDirectory', async (event) => {
    try {
      requirePermission(event, 'system_settings')
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const currentStatus = unwrapSettingsResult(
        await getDiagnosticsStatusCommand(createCommandContextFromEvent(event))
      )
      const openResult = browserWindow
        ? await dialog.showOpenDialog(browserWindow, {
            defaultPath: currentStatus.logDirectory,
            properties: ['openDirectory', 'createDirectory']
          })
        : await dialog.showOpenDialog({
            defaultPath: currentStatus.logDirectory,
            properties: ['openDirectory', 'createDirectory']
          })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      const result = await setDiagnosticsDirectoryCommand(createCommandContextFromEvent(event), {
        directoryPath: openResult.filePaths[0]
      })
      return legacySettingsResult(result, (data) => data, '更改日志保存路径失败')
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更改日志保存路径失败'
      }
    }
  })

  handleInvoke('settings:restoreDefaultDiagnosticsLogDirectory', async (event) => {
    return legacySettingsCommand(
      () => resetDiagnosticsDirectoryCommand(createCommandContextFromEvent(event)),
      (data) => data,
      '恢复默认日志保存路径失败'
    )
  })

  handleInvoke('settings:openErrorLogDirectory', async (event) => {
    return legacySettingsCommand(
      () => openDiagnosticsDirectoryCommand(createCommandContextFromEvent(event)),
      (data) => ({ logDirectory: data.logDirectory }),
      '打开错误日志目录失败'
    )
  })

  handleInvoke(
    'settings:exportDiagnosticsLogs',
    async (event, payload?: { directoryPath?: string }) => {
      try {
        requirePermission(event, 'system_settings')
        const availability = await checkDiagnosticsExportCommand(
          createCommandContextFromEvent(event)
        )
        if (availability.status === 'error') {
          return {
            success: false,
            error: availability.error!.message,
            errorCode: availability.error!.code,
            errorDetails: availability.error!.details
          }
        }
        const browserWindow = BrowserWindow.fromWebContents(event.sender)
        const openResult = payload?.directoryPath
          ? { canceled: false, filePaths: [payload.directoryPath] }
          : browserWindow
            ? await dialog.showOpenDialog(browserWindow, {
                defaultPath: getDefaultDiagnosticsExportDir(db),
                properties: ['openDirectory', 'createDirectory']
              })
            : await dialog.showOpenDialog({
                defaultPath: getDefaultDiagnosticsExportDir(db),
                properties: ['openDirectory', 'createDirectory']
              })

        if (openResult.canceled || openResult.filePaths.length === 0) {
          return { success: false, cancelled: true }
        }

        const result = unwrapSettingsResult(
          await exportDiagnosticsLogsCommand(createCommandContextFromEvent(event), {
            directoryPath: openResult.filePaths[0]
          })
        )
        return {
          success: true,
          exportDirectory: result.exportDirectory,
          filePaths: result.filePaths
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '导出日志文件失败',
          errorCode: 'INTERNAL_ERROR',
          errorDetails: null
        }
      }
    }
  )

  handleInvoke('settings:setUserPreferences', async (event, preferences) => {
    unwrapSettingsResult(
      await setUserPreferencesCommand(createCommandContextFromEvent(event), { preferences })
    )
    return { success: true }
  })

  handleInvoke('settings:chooseWallpaper', async (event) => {
    try {
      requireAuth(event)
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const openResult = browserWindow
        ? await dialog.showOpenDialog(browserWindow, {
            title: '选择自定义壁纸',
            filters: [
              {
                name: '图片文件',
                extensions: [...WALLPAPER_SUPPORTED_FORMATS]
              }
            ],
            properties: ['openFile']
          })
        : await dialog.showOpenDialog({
            title: '选择自定义壁纸',
            filters: [
              {
                name: '图片文件',
                extensions: [...WALLPAPER_SUPPORTED_FORMATS]
              }
            ],
            properties: ['openFile']
          })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      const sourcePath = openResult.filePaths[0]
      const analysis = unwrapSettingsResult(
        await analyzeWallpaperCommand(createCommandContextFromEvent(event), { sourcePath })
      )
      const sourceDataUrl = readWallpaperSourceAsDataUrl(sourcePath, analysis.extension)

      return {
        success: true,
        sourcePath,
        sourceDataUrl,
        extension: analysis.extension,
        analysis
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '设置自定义壁纸失败'
      }
    }
  })

  handleInvoke('settings:applyWallpaperCrop', async (event, payload) => {
    return legacySettingsCommand(
      () => applyWallpaperCommand(createCommandContextFromEvent(event), payload),
      (data) => data,
      '应用裁切壁纸失败'
    )
  })

  handleInvoke('settings:restoreDefaultWallpaper', async (event) => {
    return legacySettingsCommand(
      () => restoreWallpaperCommand(createCommandContextFromEvent(event)),
      (data) => data,
      '恢复默认壁纸失败'
    )
  })

  // 更新系统参数
  handleInvoke('settings:setSystemParam', async (event, key, value) => {
    requirePermission(event, 'system_settings')
    const result = await setSystemParamCommand(createCommandContextFromEvent(event), { key, value })
    if (isCommandSuccess(result)) return { success: true, ...result.data }
    const message = result.error?.message ?? '保存系统参数失败'
    return {
      success: false,
      error: message === `不支持修改系统参数：${key}` ? `不支持修改系统参数 ${key}` : message
    }
  })

  handleInvoke('settings:getSubjectTemplate', async (event, standardType) => {
    return unwrapSettingsResult(
      await getSubjectTemplateCommand(createCommandContextFromEvent(event), { standardType })
    )
  })

  handleInvoke('settings:getSubjectTemplateReference', async (event, standardType) => {
    return unwrapSettingsResult(
      await getSubjectTemplateReferenceCommand(createCommandContextFromEvent(event), {
        standardType
      })
    )
  })

  handleInvoke('settings:listIndependentCustomSubjectTemplates', async (event) => {
    return unwrapSettingsResult(
      await listCustomTemplatesCommand(createCommandContextFromEvent(event))
    )
  })

  handleInvoke('settings:getIndependentCustomSubjectTemplate', async (event, templateId) => {
    return unwrapSettingsResult(
      await getCustomTemplateCommand(createCommandContextFromEvent(event), { templateId })
    )
  })

  handleInvoke('settings:downloadSubjectTemplate', async (event, standardType: StandardType) => {
    try {
      requireAdmin(event)

      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const saveResult = browserWindow
        ? await dialog.showSaveDialog(browserWindow, {
            defaultPath: getTemplateDefaultPath(db, standardType),
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          })
        : await dialog.showSaveDialog({
            defaultPath: getTemplateDefaultPath(db, standardType),
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true }
      }

      const result = await downloadSubjectTemplateCommand(createCommandContextFromEvent(event), {
        filePath: saveResult.filePath,
        standardType
      })
      return legacySettingsResult(result, (data) => data, '下载导入模板失败')
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载导入模板失败'
      }
    }
  })

  handleInvoke('settings:importSubjectTemplate', async (event, standardType: StandardType) => {
    try {
      requireAdmin(event)
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const openResult = browserWindow
        ? await dialog.showOpenDialog(browserWindow, {
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
            properties: ['openFile']
          })
        : await dialog.showOpenDialog({
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
            properties: ['openFile']
          })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      const sourcePath = openResult.filePaths[0]
      const result = await importSubjectTemplateCommand(createCommandContextFromEvent(event), {
        sourcePath,
        standardType
      })
      return legacySettingsResult(result, (data) => data, '导入一级科目模板失败')
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导入一级科目模板失败'
      }
    }
  })

  handleInvoke('settings:parseSubjectTemplateImport', async (event, standardType: StandardType) => {
    try {
      requireAdmin(event)
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const openResult = browserWindow
        ? await dialog.showOpenDialog(browserWindow, {
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
            properties: ['openFile']
          })
        : await dialog.showOpenDialog({
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
            properties: ['openFile']
          })

      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { success: false, cancelled: true }
      }

      const sourcePath = openResult.filePaths[0]
      const template = unwrapSettingsResult(
        await parseSubjectTemplateImportCommand(createCommandContextFromEvent(event), {
          sourcePath,
          standardType
        })
      )

      return {
        success: true,
        sourcePath,
        template
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '解析一级科目模板失败'
      }
    }
  })

  handleInvoke('settings:saveSubjectTemplate', async (event, payload) => {
    return legacySettingsCommand(
      () => saveSubjectTemplateCommand(createCommandContextFromEvent(event), payload),
      (data) => data,
      '保存一级科目模板失败'
    )
  })

  handleInvoke('settings:saveIndependentCustomSubjectTemplate', async (event, payload) => {
    return legacySettingsCommand(
      () => saveCustomTemplateCommand(createCommandContextFromEvent(event), payload),
      (data) => data,
      '保存自定义模板失败'
    )
  })

  handleInvoke('settings:clearSubjectTemplate', async (event, standardType) => {
    return legacySettingsCommand(
      () => clearSubjectTemplateCommand(createCommandContextFromEvent(event), { standardType }),
      () => ({}),
      '清空一级科目模板失败'
    )
  })

  handleInvoke(
    'settings:clearIndependentCustomSubjectTemplateEntries',
    async (event, templateId) => {
      return legacySettingsCommand(
        () =>
          clearCustomTemplateEntriesCommand(createCommandContextFromEvent(event), { templateId }),
        (data) => data,
        '清空自定义模板失败'
      )
    }
  )

  handleInvoke('settings:deleteIndependentCustomSubjectTemplate', async (event, templateId) => {
    return legacySettingsCommand(
      () => deleteCustomTemplateCommand(createCommandContextFromEvent(event), { templateId }),
      (data) => data,
      '删除自定义模板失败'
    )
  })
}

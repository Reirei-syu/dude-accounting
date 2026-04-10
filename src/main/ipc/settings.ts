import fs from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  clearCustomTopLevelSubjectTemplate,
  clearIndependentCustomSubjectTemplateEntries,
  type CustomTopLevelSubjectTemplateEntry,
  deleteIndependentCustomSubjectTemplate,
  getCustomTopLevelSubjectTemplate,
  getIndependentCustomSubjectTemplate,
  getStandardTopLevelSubjectReferences,
  listIndependentCustomSubjectTemplates,
  readCustomTopLevelSubjectTemplateImport,
  saveIndependentCustomSubjectTemplate,
  saveCustomTopLevelSubjectTemplate,
  writeCustomTopLevelSubjectImportTemplate
} from '../services/subjectTemplate'
import {
  getLoginWallpaperState,
  getUserWallpaperState,
  replaceUserWallpaperFromBuffer,
  restoreDefaultWallpaper,
  WALLPAPER_SUPPORTED_FORMATS
} from '../services/wallpaperPreference'
import {
  analyzeWallpaperSource,
  readWallpaperSourceAsDataUrl,
  renderWallpaperCrop
} from '../services/wallpaperCropService'
import {
  exportDiagnosticLogs,
  getErrorLogStatus,
  listDiagnosticLogFiles
} from '../services/errorLog'
import {
  resetDiagnosticsLogDirectory,
  setDiagnosticsLogDirectory
} from '../services/diagnosticsLogPath'
import {
  getRuntimeDefaultsSnapshot,
  getSystemParamSnapshot,
  isSystemParamKey,
  updateSystemParam
} from '../services/systemSettings'
import { requireAdmin, requireAuth, requirePermission } from './session'

type StandardType = 'enterprise' | 'npo'

function getTemplateDefaultPath(standardType: StandardType): string {
  const fileName =
    standardType === 'enterprise' ? '企业一级科目导入模板.xlsx' : '民非一级科目导入模板.xlsx'
  return path.join(app.getPath('documents'), 'Dude Accounting', '导入模板', fileName)
}

function getDiagnosticsExportDefaultPath(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '日志导出')
}

export function registerSettingsHandlers(): void {
  const db = getDatabase()

  // 读取系统参数
  ipcMain.handle('settings:getSystemParams', (event) => {
    requirePermission(event, 'system_settings')
    return getSystemParamSnapshot(db)
  })

  ipcMain.handle('settings:getRuntimeDefaults', (event) => {
    requireAuth(event)
    return getRuntimeDefaultsSnapshot(db)
  })

  ipcMain.handle('settings:getUserPreferences', (event) => {
    const user = requireAuth(event)
    const rows = db
      .prepare('SELECT key, value FROM user_preferences WHERE user_id = ?')
      .all(user.id) as {
      key: string
      value: string
    }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  ipcMain.handle('settings:getWallpaperState', (event) => {
    const user = requireAuth(event)
    return getUserWallpaperState(db, app.getPath('userData'), user.id)
  })

  ipcMain.handle('settings:getLoginWallpaperState', () => {
    return getLoginWallpaperState(db, app.getPath('userData'))
  })

  ipcMain.handle('settings:getErrorLogStatus', (event) => {
    requirePermission(event, 'system_settings')
    return getErrorLogStatus(app.getPath('userData'))
  })

  ipcMain.handle('settings:chooseDiagnosticsLogDirectory', async (event) => {
    try {
      const user = requirePermission(event, 'system_settings')
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const currentStatus = getErrorLogStatus(app.getPath('userData'))
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

      const pathState = setDiagnosticsLogDirectory(app.getPath('userData'), openResult.filePaths[0])

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'set_diagnostics_log_directory',
        targetType: 'diagnostics_log_directory',
        targetId: 'diagnostics_log_directory',
        details: {
          mode: pathState.mode,
          logDirectory: pathState.activeDirectory,
          defaultLogDirectory: pathState.defaultDirectory,
          customLogDirectory: pathState.customDirectory
        }
      })

      return {
        success: true,
        status: getErrorLogStatus(app.getPath('userData'))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '更改日志保存路径失败'
      }
    }
  })

  ipcMain.handle('settings:restoreDefaultDiagnosticsLogDirectory', (event) => {
    try {
      const user = requirePermission(event, 'system_settings')
      const pathState = resetDiagnosticsLogDirectory(app.getPath('userData'))

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'restore_default_diagnostics_log_directory',
        targetType: 'diagnostics_log_directory',
        targetId: 'diagnostics_log_directory',
        details: {
          mode: pathState.mode,
          logDirectory: pathState.activeDirectory,
          defaultLogDirectory: pathState.defaultDirectory
        }
      })

      return {
        success: true,
        status: getErrorLogStatus(app.getPath('userData'))
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '恢复默认日志保存路径失败'
      }
    }
  })

  ipcMain.handle('settings:openErrorLogDirectory', async (event) => {
    try {
      requirePermission(event, 'system_settings')
      const { logDirectory } = getErrorLogStatus(app.getPath('userData'))
      await fs.promises.mkdir(logDirectory, { recursive: true })
      const error = await shell.openPath(logDirectory)
      if (error) {
        return {
          success: false,
          error
        }
      }

      return {
        success: true,
        logDirectory
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '打开错误日志目录失败'
      }
    }
  })

  ipcMain.handle(
    'settings:exportDiagnosticsLogs',
    async (event, payload?: { directoryPath?: string }) => {
      try {
        requirePermission(event, 'system_settings')
        if (listDiagnosticLogFiles(app.getPath('userData')).length === 0) {
          return {
            success: false,
            error: '暂无可导出的日志文件',
            errorCode: 'VALIDATION_ERROR',
            errorDetails: {
              reason: 'NO_DIAGNOSTIC_LOGS'
            }
          }
        }
        const browserWindow = BrowserWindow.fromWebContents(event.sender)
        const openResult = payload?.directoryPath
          ? { canceled: false, filePaths: [payload.directoryPath] }
          : browserWindow
            ? await dialog.showOpenDialog(browserWindow, {
                defaultPath: getDiagnosticsExportDefaultPath(),
                properties: ['openDirectory', 'createDirectory']
              })
            : await dialog.showOpenDialog({
                defaultPath: getDiagnosticsExportDefaultPath(),
                properties: ['openDirectory', 'createDirectory']
              })

        if (openResult.canceled || openResult.filePaths.length === 0) {
          return { success: false, cancelled: true }
        }

        const result = exportDiagnosticLogs(app.getPath('userData'), openResult.filePaths[0])
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

  ipcMain.handle('settings:setUserPreferences', (event, preferences: Record<string, string>) => {
    const user = requireAuth(event)
    const entries = Object.entries(preferences || {})
    const saveTx = db.transaction(() => {
      const upsertStmt = db.prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      for (const [key, value] of entries) {
        upsertStmt.run(user.id, key, value ?? '')
      }
    })
    saveTx()
    return { success: true }
  })

  ipcMain.handle('settings:chooseWallpaper', async (event) => {
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
      const analysis = analyzeWallpaperSource(sourcePath)
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

  ipcMain.handle(
    'settings:applyWallpaperCrop',
    (
      event,
      payload:
        | {
            extension: string
            bytes: number[]
            sourcePath?: string
          }
        | {
            sourcePath: string
            extension?: string
            viewport?: import('../../shared/wallpaperCrop').CropViewportState
            useSuggestedViewport?: boolean
          }
    ) => {
      try {
        const user = requireAuth(event)
        const rendered =
          'bytes' in payload
            ? {
                bytes: Buffer.from(payload.bytes),
                appliedExtension: payload.extension,
                analysis: payload.sourcePath ? analyzeWallpaperSource(payload.sourcePath) : null,
                viewport: null
              }
            : renderWallpaperCrop({
                sourcePath: payload.sourcePath,
                extension: payload.extension,
                viewport: payload.viewport,
                useSuggestedViewport: payload.useSuggestedViewport
              })

        const nextState = replaceUserWallpaperFromBuffer(
          db,
          app.getPath('userData'),
          user.id,
          rendered.bytes,
          rendered.appliedExtension
        )

        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'settings',
          action: 'set_wallpaper',
          targetType: 'user_preference',
          targetId: user.id,
          details: {
            sourcePath: payload.sourcePath ?? null,
            wallpaperPath: nextState.wallpaperPath,
            appliedExtension: rendered.appliedExtension,
            viewport: rendered.viewport
          }
        })

        return {
          success: true,
          state: nextState,
          analysis: rendered.analysis,
          viewport: rendered.viewport,
          appliedExtension: rendered.appliedExtension
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '应用裁切壁纸失败'
        }
      }
    }
  )

  ipcMain.handle('settings:restoreDefaultWallpaper', (event) => {
    try {
      const user = requireAuth(event)
      const state = restoreDefaultWallpaper(db, app.getPath('userData'), user.id)

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'restore_default_wallpaper',
        targetType: 'user_preference',
        targetId: user.id
      })

      return {
        success: true,
        state
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '恢复默认壁纸失败'
      }
    }
  })

  // 更新系统参数
  ipcMain.handle('settings:setSystemParam', (event, key: string, value: string) => {
    const user = requirePermission(event, 'system_settings')
    if (!isSystemParamKey(key)) {
      return {
        success: false,
        error: `不支持修改系统参数 ${key}`
      }
    }

    try {
      const result = updateSystemParam(db, key, value)

      if (result.changed) {
        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'settings',
          action: 'set_system_param',
          targetType: 'system_setting',
          targetId: key,
          details: {
            key,
            previousValue: result.previousValue,
            nextValue: result.nextValue
          }
        })
      }

      return {
        success: true,
        key,
        value: result.nextValue,
        changed: result.changed
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存系统参数失败'
      }
    }
  })

  ipcMain.handle('settings:getSubjectTemplate', (event, standardType: StandardType) => {
    requireAuth(event)
    return getCustomTopLevelSubjectTemplate(db, standardType)
  })

  ipcMain.handle('settings:getSubjectTemplateReference', (event, standardType: StandardType) => {
    requireAuth(event)
    return getStandardTopLevelSubjectReferences(standardType)
  })

  ipcMain.handle('settings:listIndependentCustomSubjectTemplates', (event) => {
    requireAuth(event)
    return listIndependentCustomSubjectTemplates(db)
  })

  ipcMain.handle('settings:getIndependentCustomSubjectTemplate', (event, templateId: string) => {
    requireAuth(event)
    return getIndependentCustomSubjectTemplate(db, templateId)
  })

  ipcMain.handle('settings:downloadSubjectTemplate', async (event, standardType: StandardType) => {
    try {
      requireAdmin(event)

      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      const saveResult = browserWindow
        ? await dialog.showSaveDialog(browserWindow, {
            defaultPath: getTemplateDefaultPath(standardType),
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          })
        : await dialog.showSaveDialog({
            defaultPath: getTemplateDefaultPath(standardType),
            filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
          })

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true }
      }

      const filePath = await writeCustomTopLevelSubjectImportTemplate(
        saveResult.filePath,
        standardType
      )

      return { success: true, filePath }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '下载导入模板失败'
      }
    }
  })

  ipcMain.handle('settings:importSubjectTemplate', async (event, standardType: StandardType) => {
    try {
      const user = requireAdmin(event)
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
      const parsedTemplate = await readCustomTopLevelSubjectTemplateImport(sourcePath, standardType)
      const savedTemplate = saveCustomTopLevelSubjectTemplate(db, {
        standardType,
        templateName: parsedTemplate.templateName,
        entries: parsedTemplate.entries
      })

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'import_subject_template',
        targetType: 'subject_template',
        targetId: standardType,
        details: {
          standardType,
          entryCount: savedTemplate.entryCount,
          templateName: savedTemplate.templateName,
          sourcePath
        }
      })

      return {
        success: true,
        template: savedTemplate,
        sourcePath
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '导入一级科目模板失败'
      }
    }
  })

  ipcMain.handle(
    'settings:parseSubjectTemplateImport',
    async (event, standardType: StandardType) => {
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
        const template = await readCustomTopLevelSubjectTemplateImport(sourcePath, standardType)

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
    }
  )

  ipcMain.handle(
    'settings:saveSubjectTemplate',
    (
      event,
      payload: {
        standardType: StandardType
        templateName?: string
        templateDescription?: string | null
        entries: CustomTopLevelSubjectTemplateEntry[]
      }
    ) => {
      try {
        const user = requireAdmin(event)
        const savedTemplate = saveCustomTopLevelSubjectTemplate(db, payload)

        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'settings',
          action: 'save_subject_template',
          targetType: 'subject_template',
          targetId: payload.standardType,
          details: {
            standardType: payload.standardType,
            entryCount: savedTemplate.entryCount,
            templateName: savedTemplate.templateName,
            templateDescription: savedTemplate.templateDescription
          }
        })

        return {
          success: true,
          template: savedTemplate
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '保存一级科目模板失败'
        }
      }
    }
  )

  ipcMain.handle(
    'settings:saveIndependentCustomSubjectTemplate',
    (
      event,
      payload: {
        templateId?: string
        baseStandardType: StandardType
        templateName: string
        templateDescription?: string | null
        entries: CustomTopLevelSubjectTemplateEntry[]
      }
    ) => {
      try {
        const user = requireAdmin(event)
        const savedTemplate = saveIndependentCustomSubjectTemplate(db, payload)

        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'settings',
          action: payload.templateId
            ? 'update_independent_custom_subject_template'
            : 'create_independent_custom_subject_template',
          targetType: 'independent_custom_subject_template',
          targetId: savedTemplate.id,
          details: {
            baseStandardType: savedTemplate.baseStandardType,
            templateName: savedTemplate.templateName,
            templateDescription: savedTemplate.templateDescription,
            entryCount: savedTemplate.entryCount
          }
        })

        return {
          success: true,
          template: savedTemplate
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '保存自定义模板失败'
        }
      }
    }
  )

  ipcMain.handle('settings:clearSubjectTemplate', (event, standardType: StandardType) => {
    try {
      const user = requireAdmin(event)
      const previousTemplate = getCustomTopLevelSubjectTemplate(db, standardType)

      clearCustomTopLevelSubjectTemplate(db, standardType)

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'clear_subject_template',
        targetType: 'subject_template',
        targetId: standardType,
        details: {
          standardType,
          clearedEntryCount: previousTemplate.entryCount
        }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '清空一级科目模板失败'
      }
    }
  })

  ipcMain.handle(
    'settings:clearIndependentCustomSubjectTemplateEntries',
    (event, templateId: string) => {
      try {
        const user = requireAdmin(event)
        const clearedTemplate = clearIndependentCustomSubjectTemplateEntries(db, templateId)

        appendOperationLog(db, {
          userId: user.id,
          username: user.username,
          module: 'settings',
          action: 'clear_independent_custom_subject_template_entries',
          targetType: 'independent_custom_subject_template',
          targetId: templateId,
          details: {
            templateName: clearedTemplate.templateName,
            baseStandardType: clearedTemplate.baseStandardType
          }
        })

        return {
          success: true,
          template: clearedTemplate
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '清空自定义模板失败'
        }
      }
    }
  )

  ipcMain.handle('settings:deleteIndependentCustomSubjectTemplate', (event, templateId: string) => {
    try {
      const user = requireAdmin(event)
      const deletedTemplate = deleteIndependentCustomSubjectTemplate(db, templateId)

      appendOperationLog(db, {
        userId: user.id,
        username: user.username,
        module: 'settings',
        action: 'delete_independent_custom_subject_template',
        targetType: 'independent_custom_subject_template',
        targetId: templateId,
        details: {
          templateName: deletedTemplate.templateName,
          baseStandardType: deletedTemplate.baseStandardType,
          entryCount: deletedTemplate.entryCount
        }
      })

      return {
        success: true,
        template: deletedTemplate
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除自定义模板失败'
      }
    }
  })
}

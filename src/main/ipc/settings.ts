import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  clearCustomTopLevelSubjectTemplate,
  type CustomTopLevelSubjectTemplateEntry,
  getCustomTopLevelSubjectTemplate,
  getStandardTopLevelSubjectReferences,
  readCustomTopLevelSubjectTemplateImport,
  saveCustomTopLevelSubjectTemplate,
  writeCustomTopLevelSubjectImportTemplate
} from '../services/subjectTemplate'
import { requireAdmin, requireAuth, requirePermission } from './session'

type StandardType = 'enterprise' | 'npo'

function getTemplateDefaultPath(standardType: StandardType): string {
  const fileName =
    standardType === 'enterprise' ? '企业一级科目导入模板.xlsx' : '民非一级科目导入模板.xlsx'
  return path.join(app.getPath('documents'), 'Dude Accounting', '导入模板', fileName)
}

export function registerSettingsHandlers(): void {
  const db = getDatabase()

  // 获取系统设置
  ipcMain.handle('settings:get', (event, key: string) => {
    requireAuth(event)
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : null
  })

  // 获取所有系统设置
  ipcMain.handle('settings:getAll', (event) => {
    requireAuth(event)
    const rows = db.prepare('SELECT key, value FROM system_settings').all() as {
      key: string
      value: string
    }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  // 更新系统设置
  ipcMain.handle('settings:set', (event, key: string, value: string) => {
    requirePermission(event, 'system_settings')
    db.prepare(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value)
    return { success: true }
  })

  ipcMain.handle('settings:getSubjectTemplate', (event, standardType: StandardType) => {
    requireAuth(event)
    return getCustomTopLevelSubjectTemplate(db, standardType)
  })

  ipcMain.handle('settings:getSubjectTemplateReference', (event, standardType: StandardType) => {
    requireAuth(event)
    return getStandardTopLevelSubjectReferences(standardType)
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
    'settings:saveSubjectTemplate',
    (
      event,
      payload: {
        standardType: StandardType
        templateName?: string
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
            templateName: savedTemplate.templateName
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
}

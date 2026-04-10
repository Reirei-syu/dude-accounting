import { shell } from 'electron'
import {
  clearCustomTopLevelSubjectTemplate,
  clearIndependentCustomSubjectTemplateEntries,
  deleteIndependentCustomSubjectTemplate,
  getCustomTopLevelSubjectTemplate,
  getIndependentCustomSubjectTemplate,
  getStandardTopLevelSubjectReferences,
  listIndependentCustomSubjectTemplates,
  readCustomTopLevelSubjectTemplateImport,
  saveIndependentCustomSubjectTemplate,
  saveCustomTopLevelSubjectTemplate,
  writeCustomTopLevelSubjectImportTemplate,
  type CustomTopLevelSubjectTemplateEntry
} from '../services/subjectTemplate'
import { exportDiagnosticLogs, getErrorLogStatus } from '../services/errorLog'
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
import {
  getLoginWallpaperState,
  getUserWallpaperState,
  replaceUserWallpaperFromBuffer,
  restoreDefaultWallpaper
} from '../services/wallpaperPreference'
import {
  analyzeWallpaperSource,
  renderWallpaperCrop,
  type WallpaperAnalyzeResult
} from '../services/wallpaperCropService'
import {
  requireCommandActor,
  requireCommandAdmin,
  requireCommandPermission
} from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'

type StandardType = 'enterprise' | 'npo'

function getUserPreferences(context: CommandContext, userId: number): Record<string, string> {
  const rows = context.db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(userId) as Array<{
    key: string
    value: string
  }>
  const settings: Record<string, string> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }
  return settings
}

export async function getSystemParamsCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getSystemParamSnapshot>>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'system_settings')
    return getSystemParamSnapshot(context.db)
  })
}

export async function setSystemParamCommand(
  context: CommandContext,
  payload: { key: string; value: string }
): Promise<CommandResult<{ key: string; value: string; changed: boolean }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'system_settings')
    if (!isSystemParamKey(payload.key)) {
      throw new Error(`不支持修改系统参数：${payload.key}`)
    }

    const result = updateSystemParam(context.db, payload.key, payload.value)
    if (result.changed) {
      appendActorOperationLog(
        {
          ...context,
          actor
        },
        {
          module: 'settings',
          action: 'set_system_param',
          targetType: 'system_setting',
          targetId: payload.key,
          details: {
            key: payload.key,
            previousValue: result.previousValue,
            nextValue: result.nextValue
          }
        }
      )
    }

    return {
      key: payload.key,
      value: result.nextValue,
      changed: result.changed
    }
  })
}

export async function getRuntimeDefaultsCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getRuntimeDefaultsSnapshot>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getRuntimeDefaultsSnapshot(context.db)
  })
}

export async function getUserPreferencesCommand(
  context: CommandContext
): Promise<CommandResult<Record<string, string>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    return getUserPreferences(context, actor.id)
  })
}

export async function setUserPreferencesCommand(
  context: CommandContext,
  payload: { preferences: Record<string, string> }
): Promise<CommandResult<{ updatedKeys: string[] }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    const entries = Object.entries(payload.preferences || {})
    const saveTx = context.db.transaction(() => {
      const upsertStmt = context.db.prepare(
        `INSERT INTO user_preferences (user_id, key, value, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, key)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      for (const [key, value] of entries) {
        upsertStmt.run(actor.id, key, value ?? '')
      }
    })
    saveTx()

    appendActorOperationLog(context, {
      module: 'settings',
      action: 'set_user_preferences',
      targetType: 'user_preference',
      targetId: actor.id,
      details: {
        updatedKeys: entries.map(([key]) => key)
      }
    })

    return { updatedKeys: entries.map(([key]) => key) }
  })
}

export async function getDiagnosticsStatusCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getErrorLogStatus>>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'system_settings')
    return getErrorLogStatus(context.runtime.userDataPath)
  })
}

export async function setDiagnosticsDirectoryCommand(
  context: CommandContext,
  payload: { directoryPath: string }
): Promise<CommandResult<{ status: ReturnType<typeof getErrorLogStatus> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'system_settings')
    const pathState = setDiagnosticsLogDirectory(context.runtime.userDataPath, payload.directoryPath)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
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
      }
    )
    return {
      status: getErrorLogStatus(context.runtime.userDataPath)
    }
  })
}

export async function resetDiagnosticsDirectoryCommand(
  context: CommandContext
): Promise<CommandResult<{ status: ReturnType<typeof getErrorLogStatus> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'system_settings')
    const pathState = resetDiagnosticsLogDirectory(context.runtime.userDataPath)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'restore_default_diagnostics_log_directory',
        targetType: 'diagnostics_log_directory',
        targetId: 'diagnostics_log_directory',
        details: {
          mode: pathState.mode,
          logDirectory: pathState.activeDirectory,
          defaultLogDirectory: pathState.defaultDirectory
        }
      }
    )
    return {
      status: getErrorLogStatus(context.runtime.userDataPath)
    }
  })
}

export async function exportDiagnosticsLogsCommand(
  context: CommandContext,
  payload: { directoryPath: string }
): Promise<CommandResult<{ exportDirectory: string; filePaths: string[] }>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'system_settings')
    return exportDiagnosticLogs(context.runtime.userDataPath, payload.directoryPath)
  })
}

export async function openDiagnosticsDirectoryCommand(
  context: CommandContext
): Promise<CommandResult<{ logDirectory: string; desktopActionTriggered: true }>> {
  return withCommandResult(context, async () => {
    requireCommandPermission(context.actor, 'system_settings')
    const { logDirectory } = getErrorLogStatus(context.runtime.userDataPath)
    const error = await shell.openPath(logDirectory)
    if (error) {
      throw new Error(error)
    }
    return {
      logDirectory,
      desktopActionTriggered: true as const
    }
  })
}

export async function getWallpaperStateCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getUserWallpaperState>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    return getUserWallpaperState(context.db, context.runtime.userDataPath, actor.id)
  })
}

export async function getLoginWallpaperStateCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof getLoginWallpaperState>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getLoginWallpaperState(context.db, context.runtime.userDataPath)
  })
}

export async function analyzeWallpaperCommand(
  context: CommandContext,
  payload: { sourcePath: string }
): Promise<CommandResult<WallpaperAnalyzeResult>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return analyzeWallpaperSource(payload.sourcePath)
  })
}

export async function applyWallpaperCommand(
  context: CommandContext,
  payload: {
    sourcePath: string
    extension?: string
    viewport?: Partial<import('../../shared/wallpaperCrop').CropViewportState>
    useSuggestedViewport?: boolean
  }
): Promise<
  CommandResult<{
    state: ReturnType<typeof getUserWallpaperState>
    analysis: WallpaperAnalyzeResult
    viewport: import('../../shared/wallpaperCrop').CropViewportState
    appliedExtension: string
  }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    const rendered = renderWallpaperCrop(payload)
    const state = replaceUserWallpaperFromBuffer(
      context.db,
      context.runtime.userDataPath,
      actor.id,
      rendered.bytes,
      rendered.appliedExtension
    )

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'set_wallpaper',
        targetType: 'user_preference',
        targetId: actor.id,
        details: {
          sourcePath: payload.sourcePath,
          wallpaperPath: state.wallpaperPath,
          appliedExtension: rendered.appliedExtension,
          viewport: rendered.viewport
        }
      }
    )

    return {
      state,
      analysis: rendered.analysis,
      viewport: rendered.viewport,
      appliedExtension: rendered.appliedExtension
    }
  })
}

export async function restoreWallpaperCommand(
  context: CommandContext
): Promise<CommandResult<{ state: ReturnType<typeof restoreDefaultWallpaper> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    const state = restoreDefaultWallpaper(context.db, context.runtime.userDataPath, actor.id)

    appendActorOperationLog(context, {
      module: 'settings',
      action: 'restore_default_wallpaper',
      targetType: 'user_preference',
      targetId: actor.id
    })

    return { state }
  })
}

export async function getSubjectTemplateCommand(
  context: CommandContext,
  payload: { standardType: StandardType }
): Promise<CommandResult<ReturnType<typeof getCustomTopLevelSubjectTemplate>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getCustomTopLevelSubjectTemplate(context.db, payload.standardType)
  })
}

export async function getSubjectTemplateReferenceCommand(
  context: CommandContext,
  payload: { standardType: StandardType }
): Promise<CommandResult<ReturnType<typeof getStandardTopLevelSubjectReferences>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getStandardTopLevelSubjectReferences(payload.standardType)
  })
}

export async function parseSubjectTemplateImportCommand(
  context: CommandContext,
  payload: { standardType: StandardType; sourcePath: string }
): Promise<CommandResult<Awaited<ReturnType<typeof readCustomTopLevelSubjectTemplateImport>>>> {
  return withCommandResult(context, async () => {
    requireCommandAdmin(context.actor)
    return readCustomTopLevelSubjectTemplateImport(payload.sourcePath, payload.standardType)
  })
}

export async function saveSubjectTemplateCommand(
  context: CommandContext,
  payload: {
    standardType: StandardType
    templateName?: string
    templateDescription?: string | null
    entries: Array<Partial<CustomTopLevelSubjectTemplateEntry>>
  }
): Promise<CommandResult<{ template: ReturnType<typeof saveCustomTopLevelSubjectTemplate> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)
    const template = saveCustomTopLevelSubjectTemplate(context.db, payload)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'save_subject_template',
        targetType: 'subject_template',
        targetId: payload.standardType,
        details: {
          standardType: payload.standardType,
          entryCount: template.entryCount,
          templateName: template.templateName,
          templateDescription: template.templateDescription
        }
      }
    )

    return { template }
  })
}

export async function importSubjectTemplateCommand(
  context: CommandContext,
  payload: { standardType: StandardType; sourcePath: string }
): Promise<CommandResult<{ template: ReturnType<typeof saveCustomTopLevelSubjectTemplate>; sourcePath: string }>> {
  return withCommandResult(context, async () => {
    const actor = requireCommandAdmin(context.actor)
    const parsedTemplate = await readCustomTopLevelSubjectTemplateImport(payload.sourcePath, payload.standardType)
    const template = saveCustomTopLevelSubjectTemplate(context.db, {
      standardType: payload.standardType,
      templateName: parsedTemplate.templateName,
      entries: parsedTemplate.entries
    })

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'import_subject_template',
        targetType: 'subject_template',
        targetId: payload.standardType,
        details: {
          standardType: payload.standardType,
          entryCount: template.entryCount,
          templateName: template.templateName,
          sourcePath: payload.sourcePath
        }
      }
    )

    return { template, sourcePath: payload.sourcePath }
  })
}

export async function downloadSubjectTemplateCommand(
  context: CommandContext,
  payload: { standardType: StandardType; filePath: string }
): Promise<CommandResult<{ filePath: string }>> {
  return withCommandResult(context, async () => {
    requireCommandAdmin(context.actor)
    const filePath = await writeCustomTopLevelSubjectImportTemplate(payload.filePath, payload.standardType)
    return { filePath }
  })
}

export async function clearSubjectTemplateCommand(
  context: CommandContext,
  payload: { standardType: StandardType }
): Promise<CommandResult<{ standardType: StandardType }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)
    const previousTemplate = getCustomTopLevelSubjectTemplate(context.db, payload.standardType)
    clearCustomTopLevelSubjectTemplate(context.db, payload.standardType)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'clear_subject_template',
        targetType: 'subject_template',
        targetId: payload.standardType,
        details: {
          standardType: payload.standardType,
          clearedEntryCount: previousTemplate.entryCount
        }
      }
    )

    return { standardType: payload.standardType }
  })
}

export async function listCustomTemplatesCommand(
  context: CommandContext
): Promise<CommandResult<ReturnType<typeof listIndependentCustomSubjectTemplates>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return listIndependentCustomSubjectTemplates(context.db)
  })
}

export async function getCustomTemplateCommand(
  context: CommandContext,
  payload: { templateId: string }
): Promise<CommandResult<ReturnType<typeof getIndependentCustomSubjectTemplate>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    return getIndependentCustomSubjectTemplate(context.db, payload.templateId)
  })
}

export async function saveCustomTemplateCommand(
  context: CommandContext,
  payload: {
    templateId?: string
    baseStandardType: StandardType
    templateName: string
    templateDescription?: string | null
    entries: Array<Partial<CustomTopLevelSubjectTemplateEntry>>
  }
): Promise<CommandResult<{ template: ReturnType<typeof saveIndependentCustomSubjectTemplate> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)
    const template = saveIndependentCustomSubjectTemplate(context.db, payload)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: payload.templateId
          ? 'update_independent_custom_subject_template'
          : 'create_independent_custom_subject_template',
        targetType: 'independent_custom_subject_template',
        targetId: template.id,
        details: {
          baseStandardType: template.baseStandardType,
          templateName: template.templateName,
          templateDescription: template.templateDescription,
          entryCount: template.entryCount
        }
      }
    )

    return { template }
  })
}

export async function importCustomTemplateCommand(
  context: CommandContext,
  payload: {
    templateId?: string
    baseStandardType: StandardType
    templateName: string
    templateDescription?: string | null
    sourcePath: string
    mergeWithEntries?: Array<Partial<CustomTopLevelSubjectTemplateEntry>>
  }
): Promise<CommandResult<{ template: ReturnType<typeof saveIndependentCustomSubjectTemplate>; sourcePath: string }>> {
  return withCommandResult(context, async () => {
    requireCommandAdmin(context.actor)
    const parsedTemplate = await readCustomTopLevelSubjectTemplateImport(payload.sourcePath, payload.baseStandardType)
    const mergedEntries = [...(payload.mergeWithEntries ?? []), ...parsedTemplate.entries]
    const template = saveIndependentCustomSubjectTemplate(context.db, {
      templateId: payload.templateId,
      baseStandardType: payload.baseStandardType,
      templateName: payload.templateName,
      templateDescription: payload.templateDescription,
      entries: mergedEntries
    })
    return {
      template,
      sourcePath: payload.sourcePath
    }
  })
}

export async function clearCustomTemplateEntriesCommand(
  context: CommandContext,
  payload: { templateId: string }
): Promise<CommandResult<{ template: ReturnType<typeof clearIndependentCustomSubjectTemplateEntries> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)
    const template = clearIndependentCustomSubjectTemplateEntries(context.db, payload.templateId)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'clear_independent_custom_subject_template_entries',
        targetType: 'independent_custom_subject_template',
        targetId: payload.templateId,
        details: {
          templateName: template.templateName,
          baseStandardType: template.baseStandardType
        }
      }
    )

    return { template }
  })
}

export async function deleteCustomTemplateCommand(
  context: CommandContext,
  payload: { templateId: string }
): Promise<CommandResult<{ template: ReturnType<typeof deleteIndependentCustomSubjectTemplate> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)
    const template = deleteIndependentCustomSubjectTemplate(context.db, payload.templateId)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        module: 'settings',
        action: 'delete_independent_custom_subject_template',
        targetType: 'independent_custom_subject_template',
        targetId: payload.templateId,
        details: {
          templateName: template.templateName,
          baseStandardType: template.baseStandardType,
          entryCount: template.entryCount
        }
      }
    )

    return { template }
  })
}

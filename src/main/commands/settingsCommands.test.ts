import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsCommandMocks = vi.hoisted(() => ({
  readCustomTopLevelSubjectTemplateImport: vi.fn(),
  writeCustomTopLevelSubjectImportTemplate: vi.fn(),
  exportDiagnosticLogs: vi.fn(),
  rememberPathPreference: vi.fn(),
  saveIndependentCustomSubjectTemplate: vi.fn(),
  requireCommandAdmin: vi.fn((actor) => actor),
  appendActorOperationLog: vi.fn()
}))

vi.mock('../services/subjectTemplate', async () => {
  const actual = await vi.importActual('../services/subjectTemplate')
  return {
    ...(actual as object),
    readCustomTopLevelSubjectTemplateImport:
      settingsCommandMocks.readCustomTopLevelSubjectTemplateImport,
    saveIndependentCustomSubjectTemplate: settingsCommandMocks.saveIndependentCustomSubjectTemplate,
    writeCustomTopLevelSubjectImportTemplate:
      settingsCommandMocks.writeCustomTopLevelSubjectImportTemplate
  }
})

vi.mock('../services/errorLog', async () => {
  const actual = await vi.importActual('../services/errorLog')
  return {
    ...(actual as object),
    exportDiagnosticLogs: settingsCommandMocks.exportDiagnosticLogs
  }
})

vi.mock('../services/pathPreference', () => ({
  rememberPathPreference: settingsCommandMocks.rememberPathPreference
}))

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandAdmin: settingsCommandMocks.requireCommandAdmin
  }
})

vi.mock('./operationLog', async () => {
  const actual = await vi.importActual('./operationLog')
  return {
    ...(actual as object),
    appendActorOperationLog: settingsCommandMocks.appendActorOperationLog
  }
})

import {
  downloadSubjectTemplateCommand,
  exportDiagnosticsLogsCommand,
  importCustomTemplateCommand
} from './settingsCommands'

describe('settingsCommands', () => {
  const context = {
    db: {
      prepare: vi.fn()
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli' as const
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-10T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    settingsCommandMocks.readCustomTopLevelSubjectTemplateImport.mockResolvedValue({
      templateName: '导入模板',
      entries: [{ code: '1001', name: '库存现金' }]
    })
    settingsCommandMocks.saveIndependentCustomSubjectTemplate.mockReturnValue({
      id: 'template-1',
      baseStandardType: 'enterprise',
      templateName: '导入模板',
      templateDescription: '来自 Excel',
      entryCount: 1
    })
    settingsCommandMocks.writeCustomTopLevelSubjectImportTemplate.mockResolvedValue(
      'D:/Templates/企业一级科目导入模板.xlsx'
    )
    settingsCommandMocks.exportDiagnosticLogs.mockReturnValue({
      exportDirectory: 'D:/Exports/DudeAccounting-logs-20260411-193000',
      filePaths: ['D:/Exports/DudeAccounting-logs-20260411-193000/runtime-2026-04-11.jsonl']
    })
  })

  it('writes an audit log when importing an independent custom template', async () => {
    const result = await importCustomTemplateCommand(context as never, {
      baseStandardType: 'enterprise',
      templateName: '导入模板',
      templateDescription: '来自 Excel',
      sourcePath: 'D:/imports/template.xlsx'
    })

    expect(result.status).toBe('success')
    expect(settingsCommandMocks.readCustomTopLevelSubjectTemplateImport).toHaveBeenCalledWith(
      'D:/imports/template.xlsx',
      'enterprise'
    )
    expect(settingsCommandMocks.saveIndependentCustomSubjectTemplate).toHaveBeenCalledWith(
      expect.anything(),
      {
        templateId: undefined,
        baseStandardType: 'enterprise',
        templateName: '导入模板',
        templateDescription: '来自 Excel',
        entries: [{ code: '1001', name: '库存现金' }]
      }
    )
    expect(settingsCommandMocks.appendActorOperationLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ username: 'admin' })
      }),
      {
        module: 'settings',
        action: 'import_independent_custom_subject_template',
        targetType: 'independent_custom_subject_template',
        targetId: 'template-1',
        details: {
          baseStandardType: 'enterprise',
          templateName: '导入模板',
          templateDescription: '来自 Excel',
          entryCount: 1,
          sourcePath: 'D:/imports/template.xlsx'
        }
      }
    )
  })

  it('remembers diagnostics export directories after CLI export', async () => {
    const result = await exportDiagnosticsLogsCommand(context as never, {
      directoryPath: 'D:/Exports'
    })

    expect(result.status).toBe('success')
    expect(settingsCommandMocks.exportDiagnosticLogs).toHaveBeenCalledWith(
      'D:/tmp/userData',
      'D:/Exports'
    )
    expect(settingsCommandMocks.rememberPathPreference).toHaveBeenCalledWith(
      expect.anything(),
      'diagnostics_export_last_dir',
      'D:/Exports'
    )
  })

  it('remembers subject template download directories after CLI export', async () => {
    const result = await downloadSubjectTemplateCommand(context as never, {
      standardType: 'enterprise',
      filePath: 'D:/Templates/企业一级科目导入模板.xlsx'
    })

    expect(result.status).toBe('success')
    expect(settingsCommandMocks.writeCustomTopLevelSubjectImportTemplate).toHaveBeenCalledWith(
      'D:/Templates/企业一级科目导入模板.xlsx',
      'enterprise'
    )
    expect(settingsCommandMocks.rememberPathPreference).toHaveBeenCalledWith(
      expect.anything(),
      'subject_template_download_last_dir',
      'D:/Templates/企业一级科目导入模板.xlsx'
    )
  })
})

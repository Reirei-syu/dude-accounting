import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsCommandMocks = vi.hoisted(() => ({
  readCustomTopLevelSubjectTemplateImport: vi.fn(),
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
    saveIndependentCustomSubjectTemplate: settingsCommandMocks.saveIndependentCustomSubjectTemplate
  }
})

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

import { importCustomTemplateCommand } from './settingsCommands'

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
})

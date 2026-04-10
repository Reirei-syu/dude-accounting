import { describe, expect, it } from 'vitest'
import { getCommandMetadata } from './catalog'

function getMetadata(
  domain: string,
  action: string
): NonNullable<ReturnType<typeof getCommandMetadata>[number]> {
  const metadata = getCommandMetadata().find(
    (item) => item.domain === domain && item.action === action
  )
  expect(metadata).toBeDefined()
  return metadata!
}

describe('UI / CLI semantics catalog', () => {
  it('marks dialog-driven UI methods as assisted mappings instead of exact equivalents', () => {
    expect(getMetadata('settings', 'diagnostics-export')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.exportDiagnosticsLogs']
    })

    expect(getMetadata('settings', 'diagnostics-set-dir')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.chooseDiagnosticsLogDirectory']
    })

    expect(getMetadata('settings', 'wallpaper-analyze')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.chooseWallpaper']
    })

    expect(getMetadata('settings', 'subject-template-parse-import')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.parseSubjectTemplateImport']
    })

    expect(getMetadata('settings', 'subject-template-import')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.importSubjectTemplate']
    })

    expect(getMetadata('settings', 'subject-template-download')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.settings.downloadSubjectTemplate']
    })

    expect(getMetadata('backup', 'create')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.backup.create']
    })

    expect(getMetadata('backup', 'import')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.backup.import']
    })

    expect(getMetadata('backup', 'restore')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.backup.restore']
    })

    expect(getMetadata('archive', 'export')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.archive.export']
    })

    expect(getMetadata('report', 'export')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.reporting.export']
    })

    expect(getMetadata('report', 'export-batch')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.reporting.exportBatch']
    })

    expect(getMetadata('book', 'export')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.bookQuery.export']
    })

    expect(getMetadata('print', 'export-pdf')).toMatchObject({
      uiMethods: [],
      uiAssistedMethods: ['window.api.print.exportPdf']
    })
  })
})

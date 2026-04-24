import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listCommandHelpEntries } from '../main/commands/catalog'
import { listShellBuiltInCommands } from './interactive'

describe('cli command wiki', () => {
  it('documents all builtin and business commands', () => {
    const wikiPath = path.join(process.cwd(), 'docs', 'wiki', 'CLI_命令大全.md')
    const manualPath = path.join(process.cwd(), 'docs', 'wiki', 'AGENT_SOFTWARE_MANUAL.md')
    const wikiContent = fs.readFileSync(wikiPath, 'utf8')
    const manualContent = fs.readFileSync(manualPath, 'utf8')

    for (const builtin of listShellBuiltInCommands()) {
      expect(wikiContent).toContain(`\`${builtin.name}\``)
      for (const alias of builtin.aliases) {
        expect(wikiContent).toContain(alias)
      }
    }

    for (const entry of listCommandHelpEntries()) {
      expect(wikiContent).toContain(`\`${entry.command}\``)
      expect(wikiContent).toContain(entry.aliasZh)
      expect(wikiContent).toContain(entry.description)
    }

    const desktopEntries = listCommandHelpEntries().filter((entry) => entry.desktopAssisted)
    for (const entry of desktopEntries) {
      for (const alternative of entry.headlessAlternatives) {
        expect(wikiContent).toContain(alternative)
        expect(manualContent).toContain(alternative)
      }
    }

    expect(wikiContent).toContain('| `backup restore` | 恢复整库备份 | 恢复整库备份 | 是 | 否 |')
    expect(manualContent).toContain('`print open-preview` -> `print export-html`')
    expect(manualContent).toContain('`print print` -> `print export-pdf`')
    expect(manualContent).toContain('`settings diagnostics-open-dir` -> `settings diagnostics-status`')
  })
})

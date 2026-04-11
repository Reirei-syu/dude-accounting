import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listCommandHelpEntries } from '../main/commands/catalog'
import { listShellBuiltInCommands } from './interactive'

describe('cli command wiki', () => {
  it('documents all builtin and business commands', () => {
    const wikiPath = path.join(process.cwd(), 'docs', 'wiki', 'CLI_命令大全.md')
    const wikiContent = fs.readFileSync(wikiPath, 'utf8')

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
  })
})

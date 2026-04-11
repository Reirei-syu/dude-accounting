import { describe, expect, it } from 'vitest'
import { getCommandMetadata, listCommandHelpEntries } from './catalog'
import { listShellBuiltInCommands } from '../../cli/interactive'

describe('command catalog metadata', () => {
  it('ensures every business command exposes exactly one chinese alias', () => {
    const metadata = getCommandMetadata()

    expect(metadata.length).toBeGreaterThan(0)
    for (const item of metadata) {
      expect(item.aliases).toHaveLength(1)
      expect(item.aliases[0]?.trim().length).toBeGreaterThan(0)
    }
  })

  it('keeps chinese aliases globally unique', () => {
    const aliases = getCommandMetadata().map((item) => item.aliases[0])
    expect(new Set(aliases).size).toBe(aliases.length)
  })

  it('avoids collisions with interactive builtin commands', () => {
    const builtinTokens = listShellBuiltInCommands().flatMap((item) => [item.name, ...item.aliases])
    const commandAliases = getCommandMetadata().map((item) => item.aliases[0])

    for (const alias of commandAliases) {
      expect(builtinTokens).not.toContain(alias)
    }
  })

  it('builds complete help entries for all commands', () => {
    const helpEntries = listCommandHelpEntries()

    expect(helpEntries).toHaveLength(getCommandMetadata().length)
    for (const entry of helpEntries) {
      expect(entry.command).toBe(`${entry.domain} ${entry.action}`)
      expect(entry.aliasZh.trim().length).toBeGreaterThan(0)
      expect(entry.description.trim().length).toBeGreaterThan(0)
    }
  })
})

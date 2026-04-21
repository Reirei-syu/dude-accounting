import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const builderConfigPath = fileURLToPath(new URL('../electron-builder.yml', import.meta.url))
const manualPath = fileURLToPath(new URL('../docs/wiki/AGENT_SOFTWARE_MANUAL.md', import.meta.url))
const commandCatalogPath = fileURLToPath(new URL('../docs/wiki/CLI_命令大全.md', import.meta.url))

describe('package docs', () => {
  it('ships the agent manual and CLI command catalog with packaged builds', () => {
    expect(existsSync(manualPath)).toBe(true)
    expect(existsSync(commandCatalogPath)).toBe(true)

    const configText = readFileSync(builderConfigPath, 'utf8')
    expect(configText).toContain('from: docs/wiki/')
    expect(configText).toContain('to: docs')
    expect(configText).toContain('AGENT_SOFTWARE_MANUAL.md')
    expect(configText).toContain('CLI_命令大全.md')
  })
})

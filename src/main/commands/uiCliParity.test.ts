import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getCommandMetadata } from './catalog'

function readPreloadMethodNames(): string[] {
  const sourcePath = path.resolve(__dirname, '../../preload/index.ts')
  const source = fs.readFileSync(sourcePath, 'utf8')
  const lines = source.split(/\r?\n/)
  const methodNames: string[] = []
  let currentDomain: string | null = null

  for (const line of lines) {
    const domainMatch = line.match(/^ {2}([A-Za-z][A-Za-z0-9_]*)\s*:\s*\{$/)
    if (domainMatch) {
      currentDomain = domainMatch[1]
      continue
    }

    if (currentDomain && /^ {2}\},?$/.test(line)) {
      currentDomain = null
      continue
    }

    if (!currentDomain) {
      continue
    }

    const methodMatch = line.match(/^ {4}([A-Za-z][A-Za-z0-9_]*)\s*:\s*\(/)
    if (methodMatch) {
      methodNames.push(`window.api.${currentDomain}.${methodMatch[1]}`)
    }
  }

  return methodNames
}

describe('UI / CLI parity catalog', () => {
  it('covers every preload API method with at least one CLI mapping', () => {
    const preloadMethods = readPreloadMethodNames()
    const mappedMethods = new Set(
      getCommandMetadata().flatMap((item) => [...item.uiMethods, ...item.uiAssistedMethods])
    )
    const missingMethods = preloadMethods.filter((methodName) => !mappedMethods.has(methodName))

    expect(preloadMethods.length).toBeGreaterThan(0)
    expect(missingMethods).toEqual([])
  })
})

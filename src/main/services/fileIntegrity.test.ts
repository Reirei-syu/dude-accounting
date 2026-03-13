import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildUniqueDirectoryPath, sanitizePathSegment } from './fileIntegrity'

describe('fileIntegrity helpers', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('sanitizes invalid filesystem characters in path segments', () => {
    expect(sanitizePathSegment('账套:一月/期末*备份?')).toBe('账套_一月_期末_备份_')
    expect(sanitizePathSegment('   ')).toBe('未命名')
  })

  it('builds a unique directory path when the preferred directory name already exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-file-integrity-'))
    const firstPath = buildUniqueDirectoryPath(tempDir, '测试账套_2026-03_备份包')
    fs.mkdirSync(firstPath, { recursive: true })

    const secondPath = buildUniqueDirectoryPath(tempDir, '测试账套_2026-03_备份包')

    expect(path.basename(firstPath)).toBe('测试账套_2026-03_备份包')
    expect(path.basename(secondPath)).toBe('测试账套_2026-03_备份包_2')
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createBackupArtifact, validateBackupArtifact } from './backupRecovery'

describe('backupRecovery service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('creates and validates a backup artifact', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      fiscalYear: '2026',
      now: new Date('2026-03-08T09:10:11')
    })

    expect(path.basename(result.backupPath)).toBe('ledger-8-2026-20260308-091011.db')
    expect(result.fileSize).toBeGreaterThan(0)
    expect(validateBackupArtifact(result.backupPath, result.checksum)).toEqual({
      valid: true,
      actualChecksum: result.checksum
    })
  })
})

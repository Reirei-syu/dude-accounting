import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createBackupArtifact,
  resolveBackupArtifactPaths,
  restoreBackupArtifact,
  validateBackupArtifact
} from './backupRecovery'

describe('backupRecovery service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('creates a backup package with manifest and validates it', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date('2026-03-08T09:10:11')
    })

    expect(path.basename(path.dirname(result.backupPath))).toBe('ledger-8-2026-20260308-091011')
    expect(path.basename(result.backupPath)).toBe('ledger-8-2026-20260308-091011.db')
    expect(path.basename(result.manifestPath)).toBe('manifest.json')
    expect(result.fileSize).toBeGreaterThan(0)
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      schemaVersion: '1.0',
      packageType: 'system_backup',
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      checksum: result.checksum,
      fileSize: result.fileSize,
      databaseFile: 'ledger-8-2026-20260308-091011.db'
    })

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: true,
        actualChecksum: result.checksum,
        manifest: expect.objectContaining({
          packageType: 'system_backup',
          ledgerId: 8,
          ledgerName: '测试账套'
        })
      })
    )
  })

  it('fails validation when manifest metadata does not match the backup file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date('2026-03-08T09:10:11')
    })

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as {
      checksum: string
    }
    manifest.checksum = 'tampered-checksum'
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: false,
        actualChecksum: result.checksum,
        error: '备份清单与备份文件不一致'
      })
    )
  })

  it('restores the backup artifact to the target database path via a temporary file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    const targetPath = path.join(tempDir, 'restored.db')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')
    fs.writeFileSync(targetPath, 'old-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date('2026-03-08T09:10:11')
    })

    restoreBackupArtifact({
      backupPath: result.backupPath,
      targetPath
    })

    expect(fs.readFileSync(targetPath, 'utf8')).toBe('sqlite-bytes')
    expect(fs.existsSync(`${targetPath}.restore-tmp`)).toBe(false)
  })

  it('resolves backup and manifest paths from a selected backup package directory', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: '测试账套',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date('2026-03-08T09:10:11')
    })

    expect(resolveBackupArtifactPaths(result.packageDir)).toEqual({
      backupPath: result.backupPath,
      manifestPath: result.manifestPath
    })
  })
})

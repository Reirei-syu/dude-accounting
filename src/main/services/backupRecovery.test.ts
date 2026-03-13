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

  it('creates a backup package with the ledger name and period in the directory name', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const result = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(path.basename(path.dirname(result.backupPath))).toBe('test-ledger_2026-03_备份包')
    expect(path.basename(result.backupPath)).toBe('test-ledger_2026-03_备份包.db')
    expect(path.basename(result.manifestPath)).toBe('manifest.json')
    expect(result.fileSize).toBeGreaterThan(0)
    expect(result.createdAt).toBe('2026-03-08 09:10:11')
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toMatchObject({
      schemaVersion: '1.0',
      packageType: 'system_backup',
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      createdAt: '2026-03-08 09:10:11',
      checksum: result.checksum,
      fileSize: result.fileSize,
      databaseFile: 'test-ledger_2026-03_备份包.db'
    })

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: true,
        actualChecksum: result.checksum,
        manifest: expect.objectContaining({
          packageType: 'system_backup',
          ledgerId: 8,
          ledgerName: 'test-ledger'
        })
      })
    )
  })

  it('adds a numeric suffix when the target backup directory already exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-backup-'))
    const sourcePath = path.join(tempDir, 'ledger.db')
    const backupDir = path.join(tempDir, 'backups')
    fs.writeFileSync(sourcePath, 'sqlite-bytes', 'utf8')

    const first = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })
    const second = createBackupArtifact({
      sourcePath,
      backupDir,
      ledgerId: 8,
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(path.basename(first.packageDir)).toBe('test-ledger_2026-03_备份包')
    expect(path.basename(second.packageDir)).toBe('test-ledger_2026-03_备份包_2')
    expect(path.basename(second.backupPath)).toBe('test-ledger_2026-03_备份包_2.db')
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
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as {
      checksum: string
    }
    manifest.checksum = 'tampered-checksum'
    fs.writeFileSync(result.manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    expect(validateBackupArtifact(result.backupPath, result.checksum, result.manifestPath)).toEqual(
      expect.objectContaining({
        valid: false,
        actualChecksum: result.checksum
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
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
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
      ledgerName: 'test-ledger',
      period: '2026-03',
      fiscalYear: '2026',
      now: new Date(2026, 2, 8, 9, 10, 11)
    })

    expect(resolveBackupArtifactPaths(result.packageDir)).toEqual({
      backupPath: result.backupPath,
      manifestPath: result.manifestPath
    })
  })
})

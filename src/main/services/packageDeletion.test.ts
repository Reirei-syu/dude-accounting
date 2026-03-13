import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteArchivePhysicalPackage,
  deleteBackupPhysicalPackage,
  getArchivePhysicalPackageStatus,
  getBackupPhysicalPackageStatus
} from './packageDeletion'

describe('packageDeletion service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('deletes the backup package directory when it exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const packageDir = path.join(tempDir, 'backup-package')
    const backupPath = path.join(packageDir, 'backup-package.db')
    const manifestPath = path.join(packageDir, 'manifest.json')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(backupPath, 'db', 'utf8')
    fs.writeFileSync(manifestPath, '{}', 'utf8')

    const result = deleteBackupPhysicalPackage({
      backupPath,
      manifestPath,
      protectedDir: tempDir
    })

    expect(result).toEqual({
      physicalExists: true,
      deletedPaths: [path.resolve(packageDir)],
      packagePath: path.resolve(packageDir)
    })
    expect(fs.existsSync(packageDir)).toBe(false)
  })

  it('reports a missing backup package when neither the directory nor files exist', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const packageDir = path.join(tempDir, 'backup-package')

    const result = deleteBackupPhysicalPackage({
      backupPath: path.join(packageDir, 'backup-package.db'),
      manifestPath: path.join(packageDir, 'manifest.json'),
      protectedDir: tempDir
    })

    expect(result).toEqual({
      physicalExists: false,
      deletedPaths: [],
      packagePath: path.resolve(packageDir)
    })
  })

  it('detects whether a backup physical package still exists before record-only deletion', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const packageDir = path.join(tempDir, 'backup-package')
    const backupPath = path.join(packageDir, 'backup-package.db')
    const manifestPath = path.join(packageDir, 'manifest.json')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(backupPath, 'db', 'utf8')

    expect(
      getBackupPhysicalPackageStatus({
        backupPath,
        manifestPath,
        protectedDir: tempDir
      })
    ).toEqual({
      physicalExists: true,
      packagePath: path.resolve(packageDir)
    })
  })

  it('deletes the archive export directory when it exists', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const exportDir = path.join(tempDir, 'archive-package')
    fs.mkdirSync(exportDir, { recursive: true })
    fs.writeFileSync(path.join(exportDir, 'manifest.json'), '{}', 'utf8')

    const result = deleteArchivePhysicalPackage(exportDir)

    expect(result).toEqual({
      physicalExists: true,
      deletedPaths: [exportDir],
      packagePath: exportDir
    })
    expect(fs.existsSync(exportDir)).toBe(false)
  })

  it('reports a missing archive export directory when it has been removed manually', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const exportDir = path.join(tempDir, 'archive-package')

    const result = deleteArchivePhysicalPackage(exportDir)

    expect(result).toEqual({
      physicalExists: false,
      deletedPaths: [],
      packagePath: exportDir
    })
  })

  it('detects whether an archive physical package still exists before record-only deletion', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-delete-'))
    const exportDir = path.join(tempDir, 'archive-package')
    fs.mkdirSync(exportDir, { recursive: true })

    expect(getArchivePhysicalPackageStatus(exportDir)).toEqual({
      physicalExists: true,
      packagePath: exportDir
    })
  })
})

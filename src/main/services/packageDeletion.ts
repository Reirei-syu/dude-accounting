import fs from 'node:fs'
import path from 'node:path'

export interface PhysicalPackageDeletionResult {
  physicalExists: boolean
  deletedPaths: string[]
  packagePath: string
}

export interface PhysicalPackageStatus {
  physicalExists: boolean
  packagePath: string
}

function resolveSafeDirectoryDeletionTarget(
  candidateDir: string,
  protectedDir: string
): string | null {
  if (!candidateDir || candidateDir === '.') {
    return null
  }

  const resolvedCandidateDir = path.resolve(candidateDir)
  const resolvedProtectedDir = path.resolve(protectedDir)

  if (resolvedCandidateDir === resolvedProtectedDir) {
    return null
  }

  return resolvedCandidateDir
}

export function getBackupPhysicalPackageStatus(input: {
  backupPath: string
  manifestPath: string | null
  protectedDir: string
}): PhysicalPackageStatus {
  const packageDir = path.dirname(input.backupPath)
  const safePackageDir = resolveSafeDirectoryDeletionTarget(packageDir, input.protectedDir)

  if (safePackageDir && fs.existsSync(safePackageDir) && fs.statSync(safePackageDir).isDirectory()) {
    return {
      physicalExists: true,
      packagePath: safePackageDir
    }
  }

  const hasLooseFiles = [input.backupPath, input.manifestPath]
    .filter((value): value is string => Boolean(value))
    .some((value) => fs.existsSync(value))

  return {
    physicalExists: hasLooseFiles,
    packagePath: safePackageDir ?? packageDir
  }
}

export function deleteBackupPhysicalPackage(input: {
  backupPath: string
  manifestPath: string | null
  protectedDir: string
}): PhysicalPackageDeletionResult {
  const physicalStatus = getBackupPhysicalPackageStatus(input)
  const safePackageDir = resolveSafeDirectoryDeletionTarget(physicalStatus.packagePath, input.protectedDir)

  if (safePackageDir && fs.existsSync(safePackageDir) && fs.statSync(safePackageDir).isDirectory()) {
    fs.rmSync(safePackageDir, { recursive: true, force: true })
    return {
      physicalExists: true,
      deletedPaths: [safePackageDir],
      packagePath: safePackageDir
    }
  }

  const deletedPaths = [input.backupPath, input.manifestPath]
    .filter((value): value is string => Boolean(value))
    .filter((value) => fs.existsSync(value))

  for (const filePath of deletedPaths) {
    fs.rmSync(filePath, { force: true })
  }

  return {
    physicalExists: deletedPaths.length > 0,
    deletedPaths,
    packagePath: physicalStatus.packagePath
  }
}

export function getArchivePhysicalPackageStatus(exportPath: string): PhysicalPackageStatus {
  return {
    physicalExists: fs.existsSync(exportPath) && fs.statSync(exportPath).isDirectory(),
    packagePath: exportPath
  }
}

export function deleteArchivePhysicalPackage(exportPath: string): PhysicalPackageDeletionResult {
  const physicalStatus = getArchivePhysicalPackageStatus(exportPath)
  if (physicalStatus.physicalExists) {
    fs.rmSync(exportPath, { recursive: true, force: true })
    return {
      physicalExists: true,
      deletedPaths: [exportPath],
      packagePath: exportPath
    }
  }

  return {
    physicalExists: false,
    deletedPaths: [],
    packagePath: physicalStatus.packagePath
  }
}

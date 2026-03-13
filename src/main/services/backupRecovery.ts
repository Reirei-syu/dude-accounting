import fs from 'node:fs'
import path from 'node:path'
import {
  buildUniqueDirectoryPath,
  computeFileSha256,
  ensureDirectory,
  sanitizePathSegment
} from './fileIntegrity'
import { formatLocalDateTime } from './localTime'

export interface BackupManifest {
  schemaVersion: '1.0'
  packageType: 'system_backup'
  ledgerId: number
  ledgerName: string | null
  period: string | null
  fiscalYear: string | null
  createdAt: string
  databaseFile: string
  checksum: string
  fileSize: number
}

export interface BackupArtifactResult {
  packageDir: string
  backupPath: string
  manifestPath: string
  checksum: string
  fileSize: number
  createdAt: string
}

export interface BackupValidationResult {
  valid: boolean
  actualChecksum: string | null
  error?: string
  manifest?: BackupManifest | null
}

export interface BackupRestoreResult {
  targetPath: string
  fileSize: number
}

export interface ResolvedBackupArtifactPaths {
  backupPath: string
  manifestPath: string
}

function buildBackupPackageName(
  ledgerName?: string | null,
  period?: string | null,
  fiscalYear?: string | null
): string {
  const ledgerLabel = sanitizePathSegment(ledgerName?.trim() || '未命名账套', '未命名账套')
  const periodLabel = sanitizePathSegment(period?.trim() || fiscalYear?.trim() || '未设置期间', '未设置期间')
  return `${ledgerLabel}_${periodLabel}_备份包`
}

function writeBackupManifest(packageDir: string, manifest: BackupManifest): string {
  const manifestPath = path.join(packageDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}

export function resolveBackupArtifactPaths(packageDir: string): ResolvedBackupArtifactPaths {
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error('所选恢复路径不是有效的备份包目录')
  }

  const manifestPath = path.join(packageDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error('所选备份包目录缺少 manifest.json')
  }

  const databaseFiles = fs
    .readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.db'))
    .map((entry) => path.join(packageDir, entry.name))

  if (databaseFiles.length !== 1) {
    throw new Error('所选备份包目录必须且只能包含一个数据库备份文件')
  }

  return {
    backupPath: databaseFiles[0],
    manifestPath
  }
}

export function createBackupArtifact(input: {
  sourcePath: string
  backupDir: string
  ledgerId: number
  ledgerName?: string | null
  period?: string | null
  fiscalYear?: string | null
  now?: Date
}): BackupArtifactResult {
  ensureDirectory(input.backupDir)

  const preferredPackageName = buildBackupPackageName(input.ledgerName, input.period, input.fiscalYear)
  const packageDir = buildUniqueDirectoryPath(input.backupDir, preferredPackageName)
  const packageName = path.basename(packageDir)
  const filename = `${packageName}.db`
  const backupPath = path.join(packageDir, filename)
  const createdAt = formatLocalDateTime(input.now ?? new Date())

  ensureDirectory(packageDir)
  fs.copyFileSync(input.sourcePath, backupPath)

  const checksum = computeFileSha256(backupPath)
  const fileSize = fs.statSync(backupPath).size
  const manifestPath = writeBackupManifest(packageDir, {
    schemaVersion: '1.0',
    packageType: 'system_backup',
    ledgerId: input.ledgerId,
    ledgerName: input.ledgerName?.trim() || null,
    period: input.period ?? null,
    fiscalYear: input.fiscalYear ?? null,
    createdAt,
    databaseFile: filename,
    checksum,
    fileSize
  })

  return {
    packageDir,
    backupPath,
    manifestPath,
    checksum,
    fileSize,
    createdAt
  }
}

export function validateBackupArtifact(
  filePath: string,
  expectedChecksum: string,
  manifestPath?: string | null
): BackupValidationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: false, actualChecksum: null, error: '备份文件不存在', manifest: null }
  }

  const actualChecksum = computeFileSha256(filePath)
  if (actualChecksum !== expectedChecksum) {
    return { valid: false, actualChecksum, error: '备份文件校验失败', manifest: null }
  }

  let manifest: BackupManifest | null = null
  if (manifestPath) {
    if (!fs.existsSync(manifestPath)) {
      return { valid: false, actualChecksum, error: '备份清单文件不存在', manifest: null }
    }

    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
    } catch {
      return { valid: false, actualChecksum, error: '备份清单文件损坏', manifest: null }
    }

    const fileSize = fs.statSync(filePath).size
    const isManifestValid =
      manifest.schemaVersion === '1.0' &&
      manifest.packageType === 'system_backup' &&
      manifest.databaseFile === path.basename(filePath) &&
      manifest.checksum === actualChecksum &&
      manifest.fileSize === fileSize

    if (!isManifestValid) {
      return {
        valid: false,
        actualChecksum,
        error: '备份清单与备份文件不一致',
        manifest
      }
    }
  }

  return { valid: true, actualChecksum, manifest }
}

export function restoreBackupArtifact(input: {
  backupPath: string
  targetPath: string
  tempPath?: string
}): BackupRestoreResult {
  const tempPath = input.tempPath ?? `${input.targetPath}.restore-tmp`

  if (fs.existsSync(tempPath)) {
    fs.rmSync(tempPath, { force: true })
  }

  fs.copyFileSync(input.backupPath, tempPath)

  for (const candidatePath of [input.targetPath, `${input.targetPath}-wal`, `${input.targetPath}-shm`]) {
    if (fs.existsSync(candidatePath)) {
      fs.rmSync(candidatePath, { force: true })
    }
  }

  fs.renameSync(tempPath, input.targetPath)

  return {
    targetPath: input.targetPath,
    fileSize: fs.statSync(input.targetPath).size
  }
}

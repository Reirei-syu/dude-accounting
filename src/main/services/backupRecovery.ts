import fs from 'node:fs'
import path from 'node:path'
import { buildTimestampToken, computeFileSha256, ensureDirectory } from './fileIntegrity'

export interface BackupArtifactResult {
  backupPath: string
  checksum: string
  fileSize: number
}

export function createBackupArtifact(input: {
  sourcePath: string
  backupDir: string
  ledgerId: number
  fiscalYear?: string | null
  now?: Date
}): BackupArtifactResult {
  ensureDirectory(input.backupDir)

  const suffix = input.fiscalYear ? `-${input.fiscalYear}` : ''
  const filename = `ledger-${input.ledgerId}${suffix}-${buildTimestampToken(input.now)}.db`
  const backupPath = path.join(input.backupDir, filename)

  fs.copyFileSync(input.sourcePath, backupPath)

  return {
    backupPath,
    checksum: computeFileSha256(backupPath),
    fileSize: fs.statSync(backupPath).size
  }
}

export function validateBackupArtifact(filePath: string, expectedChecksum: string): {
  valid: boolean
  actualChecksum: string | null
  error?: string
} {
  if (!fs.existsSync(filePath)) {
    return { valid: false, actualChecksum: null, error: '备份文件不存在' }
  }

  const actualChecksum = computeFileSha256(filePath)
  if (actualChecksum !== expectedChecksum) {
    return { valid: false, actualChecksum, error: '备份文件校验失败' }
  }

  return { valid: true, actualChecksum }
}

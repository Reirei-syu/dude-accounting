import fs from 'node:fs'
import path from 'node:path'
import { computeFileSha256, ensureDirectory } from './fileIntegrity'

export interface ArchiveManifestInput {
  ledgerId: number
  ledgerName: string
  fiscalYear: string
  exportedAt: string
  originalVoucherFileCount: number
  voucherCount: number
  reportCount: number
  metadata: Record<string, unknown>
}

export interface ArchiveManifest {
  schemaVersion: '1.0'
  ledgerId: number
  ledgerName: string
  fiscalYear: string
  exportedAt: string
  counts: {
    originalVoucherFiles: number
    vouchers: number
    reports: number
  }
  metadata: Record<string, unknown>
}

export interface ArchiveValidationResult {
  valid: boolean
  actualChecksum: string | null
  error?: string
  manifest?: ArchiveManifest | null
  missingFiles?: string[]
}

export function buildArchiveManifest(input: ArchiveManifestInput): ArchiveManifest {
  return {
    schemaVersion: '1.0',
    ledgerId: input.ledgerId,
    ledgerName: input.ledgerName,
    fiscalYear: input.fiscalYear,
    exportedAt: input.exportedAt,
    counts: {
      originalVoucherFiles: input.originalVoucherFileCount,
      vouchers: input.voucherCount,
      reports: input.reportCount
    },
    metadata: input.metadata
  }
}

export function writeArchiveManifest(outputDir: string, manifest: ArchiveManifest): string {
  ensureDirectory(outputDir)
  const manifestPath = path.join(outputDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}

function getGeneratedFiles(manifest: ArchiveManifest): string[] {
  const generatedFiles = manifest.metadata.generatedFiles
  if (
    Array.isArray(generatedFiles) &&
    generatedFiles.every((item) => typeof item === 'string' && item.trim() !== '')
  ) {
    return generatedFiles
  }

  return [
    'manifest.json',
    'vouchers.json',
    'voucher-entries.json',
    'electronic-vouchers.json',
    'operation-logs.json'
  ]
}

export function validateArchiveExportPackage(input: {
  exportPath: string
  manifestPath: string
  expectedChecksum: string | null
  ledgerId?: number
  fiscalYear?: string
}): ArchiveValidationResult {
  if (!fs.existsSync(input.exportPath) || !fs.statSync(input.exportPath).isDirectory()) {
    return { valid: false, actualChecksum: null, error: '电子档案导出目录不存在', manifest: null }
  }

  if (!fs.existsSync(input.manifestPath)) {
    return { valid: false, actualChecksum: null, error: '电子档案清单文件不存在', manifest: null }
  }

  const actualChecksum = computeFileSha256(input.manifestPath)
  if (input.expectedChecksum && actualChecksum !== input.expectedChecksum) {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案清单校验失败',
      manifest: null
    }
  }

  let manifest: ArchiveManifest
  try {
    manifest = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ArchiveManifest
  } catch {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案清单文件损坏',
      manifest: null
    }
  }

  if (manifest.schemaVersion !== '1.0') {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案清单版本不受支持',
      manifest
    }
  }

  if (typeof input.ledgerId === 'number' && manifest.ledgerId !== input.ledgerId) {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案清单与账套记录不一致',
      manifest
    }
  }

  if (input.fiscalYear && manifest.fiscalYear !== input.fiscalYear) {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案清单与归档年度不一致',
      manifest
    }
  }

  const missingFiles = getGeneratedFiles(manifest).filter(
    (fileName) => !fs.existsSync(path.join(input.exportPath, fileName))
  )

  if (missingFiles.length > 0) {
    return {
      valid: false,
      actualChecksum,
      error: '电子档案导出包缺少必要文件',
      manifest,
      missingFiles
    }
  }

  if (manifest.counts.originalVoucherFiles > 0) {
    const originalVoucherDir = path.join(input.exportPath, 'original-vouchers')
    if (!fs.existsSync(originalVoucherDir) || !fs.statSync(originalVoucherDir).isDirectory()) {
      return {
        valid: false,
        actualChecksum,
        error: '电子档案原始凭证目录不存在',
        manifest
      }
    }

    const actualFileCount = fs
      .readdirSync(originalVoucherDir, { withFileTypes: true })
      .filter((entry) => entry.isFile()).length

    if (actualFileCount !== manifest.counts.originalVoucherFiles) {
      return {
        valid: false,
        actualChecksum,
        error: '电子档案原始凭证数量与清单不一致',
        manifest
      }
    }
  }

  return {
    valid: true,
    actualChecksum,
    manifest
  }
}

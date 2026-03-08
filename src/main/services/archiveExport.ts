import fs from 'node:fs'
import path from 'node:path'
import { ensureDirectory } from './fileIntegrity'

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

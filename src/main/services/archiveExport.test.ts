import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { computeFileSha256 } from './fileIntegrity'
import {
  buildArchiveManifest,
  validateArchiveExportPackage,
  writeArchiveManifest
} from './archiveExport'

describe('archiveExport service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('builds and writes an archive manifest', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-archive-'))
    const manifest = buildArchiveManifest({
      ledgerId: 3,
      ledgerName: '测试账套',
      fiscalYear: '2026',
      exportedAt: '2026-03-08T10:00:00.000Z',
      originalVoucherFileCount: 5,
      voucherCount: 28,
      reportCount: 3,
      metadata: { exporter: 'system' }
    })

    const manifestPath = writeArchiveManifest(tempDir, manifest)
    const persisted = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    expect(persisted.schemaVersion).toBe('1.0')
    expect(persisted.counts.vouchers).toBe(28)
    expect(persisted.metadata.exporter).toBe('system')
  })

  it('validates a complete archive export package', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-archive-'))
    const originalVoucherDir = path.join(tempDir, 'original-vouchers')
    fs.mkdirSync(originalVoucherDir, { recursive: true })
    fs.writeFileSync(path.join(originalVoucherDir, '1-回单.pdf'), 'pdf', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'vouchers.json'), '[]', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'voucher-entries.json'), '[]', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'electronic-vouchers.json'), '[]', 'utf8')
    fs.writeFileSync(path.join(tempDir, 'operation-logs.json'), '[]', 'utf8')

    const manifest = buildArchiveManifest({
      ledgerId: 3,
      ledgerName: '测试账套',
      fiscalYear: '2026',
      exportedAt: '2026-03-08T10:00:00.000Z',
      originalVoucherFileCount: 1,
      voucherCount: 28,
      reportCount: 3,
      metadata: {
        exporter: 'system',
        generatedFiles: [
          'manifest.json',
          'vouchers.json',
          'voucher-entries.json',
          'electronic-vouchers.json',
          'operation-logs.json'
        ]
      }
    })

    const manifestPath = writeArchiveManifest(tempDir, manifest)
    const checksum = computeFileSha256(manifestPath)

    expect(
      validateArchiveExportPackage({
        exportPath: tempDir,
        manifestPath,
        expectedChecksum: checksum,
        ledgerId: 3,
        fiscalYear: '2026'
      })
    ).toEqual(
      expect.objectContaining({
        valid: true,
        actualChecksum: checksum,
        manifest: expect.objectContaining({
          ledgerId: 3,
          fiscalYear: '2026'
        })
      })
    )
  })

  it('fails archive validation when generated files are missing', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-archive-'))
    fs.writeFileSync(path.join(tempDir, 'vouchers.json'), '[]', 'utf8')

    const manifest = buildArchiveManifest({
      ledgerId: 3,
      ledgerName: '测试账套',
      fiscalYear: '2026',
      exportedAt: '2026-03-08T10:00:00.000Z',
      originalVoucherFileCount: 0,
      voucherCount: 28,
      reportCount: 3,
      metadata: {
        generatedFiles: ['manifest.json', 'vouchers.json', 'voucher-entries.json']
      }
    })

    const manifestPath = writeArchiveManifest(tempDir, manifest)
    const checksum = computeFileSha256(manifestPath)

    expect(
      validateArchiveExportPackage({
        exportPath: tempDir,
        manifestPath,
        expectedChecksum: checksum
      })
    ).toEqual(
      expect.objectContaining({
        valid: false,
        error: '电子档案导出包缺少必要文件',
        missingFiles: ['voucher-entries.json']
      })
    )
  })
})

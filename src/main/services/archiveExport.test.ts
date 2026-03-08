import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildArchiveManifest, writeArchiveManifest } from './archiveExport'

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
})

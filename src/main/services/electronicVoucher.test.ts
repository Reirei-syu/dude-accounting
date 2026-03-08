import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNoDuplicateElectronicVoucher,
  buildElectronicVoucherFingerprint,
  buildImportedVoucherMetadata,
  detectElectronicVoucherType
} from './electronicVoucher'

class FakeElectronicVoucherDb {
  records: Array<{ ledger_id: number; fingerprint: string; id: number }> = []

  prepare(sql: string): {
    get: (ledgerId: number, fingerprint: string) => { id: number } | undefined
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (
      normalized ===
      'SELECT id FROM electronic_voucher_records WHERE ledger_id = ? AND fingerprint = ? LIMIT 1'
    ) {
      return {
        get: (ledgerId, fingerprint) =>
          this.records.find(
            (item) => item.ledger_id === ledgerId && item.fingerprint === fingerprint
          )
      }
    }

    throw new Error(`Unhandled SQL in FakeElectronicVoucherDb: ${normalized}`)
  }
}

describe('electronicVoucher service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('detects supported voucher types from filename', () => {
    expect(detectElectronicVoucherType('增值税数电发票.ofd')).toBe('digital_invoice')
    expect(detectElectronicVoucherType('招商银行电子回单.pdf')).toBe('bank_receipt')
    expect(detectElectronicVoucherType('工商银行对账单.pdf')).toBe('bank_statement')
    expect(detectElectronicVoucherType('other.bin')).toBe('unknown')
  })

  it('builds stable fingerprints and blocks duplicates', () => {
    const db = new FakeElectronicVoucherDb()

    const fingerprint = buildElectronicVoucherFingerprint({
      sha256: 'abc',
      type: 'digital_invoice',
      sourceNumber: 'NO-1',
      sourceDate: '2026-03-08',
      amountCents: 12800
    })

    db.records.push({
      id: 1,
      ledger_id: 1,
      fingerprint
    })

    expect(() => assertNoDuplicateElectronicVoucher(db as never, 1, fingerprint)).toThrow(
      '检测到重复电子凭证，已阻止重复入账'
    )
  })

  it('extracts imported voucher metadata from a file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-evoucher-'))
    const sourcePath = path.join(tempDir, '招商银行电子回单.pdf')
    fs.writeFileSync(sourcePath, 'bank voucher content', 'utf8')

    const metadata = buildImportedVoucherMetadata(sourcePath)
    expect(metadata.originalName).toBe('招商银行电子回单.pdf')
    expect(metadata.fileExt).toBe('.pdf')
    expect(metadata.voucherType).toBe('bank_receipt')
    expect(metadata.sha256).toHaveLength(64)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNoDuplicateElectronicVoucher,
  buildElectronicVoucherFingerprint,
  buildImportedVoucherMetadata,
  detectElectronicVoucherType,
  importElectronicVoucher
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

class FakeElectronicVoucherImportDb {
  fileRows: Array<{ ledger_id: number; sha256: string; id: number }> = []
  recordRows: Array<{ ledger_id: number; fingerprint: string; id: number }> = []
  verificationRows: Array<{ record_id: number; id: number }> = []
  private nextFileId = 1
  private nextRecordId = 1
  private nextVerificationId = 1

  transaction<T>(callback: () => T): () => T {
    return () => {
      const fileSnapshot = this.fileRows.map((row) => ({ ...row }))
      const recordSnapshot = this.recordRows.map((row) => ({ ...row }))
      const verificationSnapshot = this.verificationRows.map((row) => ({ ...row }))
      const idSnapshot = {
        nextFileId: this.nextFileId,
        nextRecordId: this.nextRecordId,
        nextVerificationId: this.nextVerificationId
      }

      try {
        return callback()
      } catch (error) {
        this.fileRows = fileSnapshot
        this.recordRows = recordSnapshot
        this.verificationRows = verificationSnapshot
        this.nextFileId = idSnapshot.nextFileId
        this.nextRecordId = idSnapshot.nextRecordId
        this.nextVerificationId = idSnapshot.nextVerificationId
        throw error
      }
    }
  }

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      'SELECT id FROM electronic_voucher_records WHERE ledger_id = ? AND fingerprint = ? LIMIT 1'
    ) {
      return {
        get: (ledgerId, fingerprint) =>
          this.recordRows.find(
            (item) => item.ledger_id === Number(ledgerId) && item.fingerprint === String(fingerprint)
          ),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      `INSERT INTO electronic_voucher_files ( ledger_id, original_name, stored_name, stored_path, file_ext, sha256, file_size, imported_by ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ) {
      return {
        get: () => undefined,
        run: (ledgerId, _originalName, _storedName, _storedPath, _fileExt, sha256) => {
          if (
            this.fileRows.some(
              (row) => row.ledger_id === Number(ledgerId) && row.sha256 === String(sha256)
            )
          ) {
            throw new Error(
              'UNIQUE constraint failed: electronic_voucher_files.ledger_id, electronic_voucher_files.sha256'
            )
          }

          const id = this.nextFileId++
          this.fileRows.push({ ledger_id: Number(ledgerId), sha256: String(sha256), id })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (
      normalized ===
      `INSERT INTO electronic_voucher_records ( ledger_id, file_id, voucher_type, source_number, source_date, amount_cents, fingerprint, status ) VALUES (?, ?, ?, ?, ?, ?, ?, 'imported')`
    ) {
      return {
        get: () => undefined,
        run: (ledgerId, _fileId, _voucherType, _sourceNumber, _sourceDate, _amountCents, fingerprint) => {
          const id = this.nextRecordId++
          this.recordRows.push({ ledger_id: Number(ledgerId), fingerprint: String(fingerprint), id })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (
      normalized ===
      `INSERT INTO electronic_voucher_verifications ( record_id, verification_status, verification_method, verification_message ) VALUES (?, 'pending', ?, ?)`
    ) {
      return {
        get: () => undefined,
        run: (recordId) => {
          const id = this.nextVerificationId++
          this.verificationRows.push({ record_id: Number(recordId), id })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeElectronicVoucherImportDb: ${normalized}`)
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

  it('cleans up copied files when transactional persistence fails', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-evoucher-import-'))
    const sourcePath = path.join(tempDir, '数电发票.pdf')
    const storageDir = path.join(tempDir, 'storage')
    fs.writeFileSync(sourcePath, 'invoice-content', 'utf8')

    const db = new FakeElectronicVoucherImportDb()

    const metadata = buildImportedVoucherMetadata(sourcePath)
    db.fileRows.push({ id: 1, ledger_id: 1, sha256: metadata.sha256 })

    let thrownError: unknown = null
    try {
      importElectronicVoucher(db as never, {
        ledgerId: 1,
        sourcePath,
        storageDir,
        importedBy: 2,
        sourceNumber: 'INV-20260315',
        sourceDate: '2026-03-15',
        amountCents: 1000,
        now: new Date('2026-03-15T10:00:00.000Z')
      })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(Error)
    const storageFiles = fs.existsSync(storageDir) ? fs.readdirSync(storageDir) : []
    expect(storageFiles).toHaveLength(0)
    expect(db.recordRows).toHaveLength(0)
    expect(db.verificationRows).toHaveLength(0)
  })
})

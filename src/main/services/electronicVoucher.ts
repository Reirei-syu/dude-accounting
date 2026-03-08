import type Database from 'better-sqlite3'
import path from 'node:path'
import { computeFileSha256 } from './fileIntegrity'

export type ElectronicVoucherType =
  | 'digital_invoice'
  | 'bank_receipt'
  | 'bank_statement'
  | 'unknown'

export function detectElectronicVoucherType(fileName: string): ElectronicVoucherType {
  const lowerName = fileName.toLowerCase()
  if (
    lowerName.includes('发票') ||
    lowerName.includes('invoice') ||
    lowerName.includes('ofd')
  ) {
    return 'digital_invoice'
  }

  if (lowerName.includes('回单') || lowerName.includes('receipt')) {
    return 'bank_receipt'
  }

  if (lowerName.includes('对账单') || lowerName.includes('statement')) {
    return 'bank_statement'
  }

  return 'unknown'
}

export function buildElectronicVoucherFingerprint(input: {
  sha256: string
  type: ElectronicVoucherType
  sourceNumber?: string | null
  sourceDate?: string | null
  amountCents?: number | null
}): string {
  const normalizedNumber = input.sourceNumber?.trim()
  const normalizedDate = input.sourceDate?.trim()
  if (normalizedNumber && normalizedDate && typeof input.amountCents === 'number') {
    return `${input.type}:${normalizedNumber}:${normalizedDate}:${input.amountCents}`
  }

  return `${input.type}:${input.sha256}`
}

export function assertNoDuplicateElectronicVoucher(
  db: Database.Database,
  ledgerId: number,
  fingerprint: string
): void {
  const row = db
    .prepare(
      `SELECT id
       FROM electronic_voucher_records
       WHERE ledger_id = ? AND fingerprint = ?
       LIMIT 1`
    )
    .get(ledgerId, fingerprint) as { id: number } | undefined

  if (row) {
    throw new Error('检测到重复电子凭证，已阻止重复入账')
  }
}

export function buildImportedVoucherMetadata(filePath: string): {
  originalName: string
  fileExt: string
  sha256: string
  voucherType: ElectronicVoucherType
} {
  const originalName = path.basename(filePath)
  const fileExt = path.extname(filePath).toLowerCase()
  const sha256 = computeFileSha256(filePath)
  const voucherType = detectElectronicVoucherType(originalName)

  return {
    originalName,
    fileExt,
    sha256,
    voucherType
  }
}

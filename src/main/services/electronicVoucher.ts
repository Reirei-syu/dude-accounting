import fs from 'node:fs'
import type Database from 'better-sqlite3'
import path from 'node:path'
import { buildTimestampToken, computeFileSha256, ensureDirectory } from './fileIntegrity'

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
  db: Pick<Database.Database, 'prepare'>,
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

export interface ImportElectronicVoucherInput {
  ledgerId: number
  sourcePath: string
  storageDir: string
  importedBy: number
  sourceNumber?: string | null
  sourceDate?: string | null
  amountCents?: number | null
  now?: Date
}

export interface ImportElectronicVoucherResult {
  fileId: number
  recordId: number
  storedName: string
  storedPath: string
  fingerprint: string
  voucherType: ElectronicVoucherType
}

function cleanupImportedVoucherFile(
  storageDir: string,
  storedPath: string,
  originalName: string
): void {
  const candidatePaths = new Set<string>([storedPath])

  if (fs.existsSync(storageDir)) {
    for (const fileName of fs.readdirSync(storageDir)) {
      if (fileName === originalName || fileName.endsWith(`-${originalName}`)) {
        candidatePaths.add(path.join(storageDir, fileName))
      }
    }
  }

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      const stats = fs.statSync(candidatePath)
      if (stats.isDirectory()) {
        fs.rmSync(candidatePath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(candidatePath)
      }
    }
  }
}

export function importElectronicVoucher(
  db: Pick<Database.Database, 'prepare' | 'transaction'>,
  input: ImportElectronicVoucherInput
): ImportElectronicVoucherResult {
  const metadata = buildImportedVoucherMetadata(input.sourcePath)
  const fingerprint = buildElectronicVoucherFingerprint({
    sha256: metadata.sha256,
    type: metadata.voucherType,
    sourceNumber: input.sourceNumber ?? null,
    sourceDate: input.sourceDate ?? null,
    amountCents: input.amountCents ?? null
  })

  assertNoDuplicateElectronicVoucher(db, input.ledgerId, fingerprint)

  ensureDirectory(input.storageDir)
  const storedName = `${buildTimestampToken(input.now)}-${metadata.originalName}`
  const storedPath = path.join(input.storageDir, storedName)
  fs.copyFileSync(input.sourcePath, storedPath)
  let persisted = false

  try {
    const persist = db.transaction(() => {
      const fileResult = db
        .prepare(
          `INSERT INTO electronic_voucher_files (
             ledger_id,
             original_name,
             stored_name,
             stored_path,
             file_ext,
             sha256,
             file_size,
             imported_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.ledgerId,
          metadata.originalName,
          storedName,
          storedPath,
          metadata.fileExt,
          metadata.sha256,
          fs.statSync(storedPath).size,
          input.importedBy
        )

      const fileId = Number(fileResult.lastInsertRowid)
      const recordResult = db
        .prepare(
          `INSERT INTO electronic_voucher_records (
             ledger_id,
             file_id,
             voucher_type,
             source_number,
             source_date,
             amount_cents,
             fingerprint,
             status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'imported')`
        )
        .run(
          input.ledgerId,
          fileId,
          metadata.voucherType,
          input.sourceNumber ?? null,
          input.sourceDate ?? null,
          input.amountCents ?? null,
          fingerprint
        )

      const recordId = Number(recordResult.lastInsertRowid)
      db.prepare(
        `INSERT INTO electronic_voucher_verifications (
           record_id,
           verification_status,
           verification_method,
           verification_message
         ) VALUES (?, 'pending', ?, ?)`
      ).run(recordId, 'initial-import', '待验签/验真')

      return { fileId, recordId }
    })

    const persistedResult = persist()
    persisted = true
    return {
      fileId: persistedResult.fileId,
      recordId: persistedResult.recordId,
      storedName,
      storedPath,
      fingerprint,
      voucherType: metadata.voucherType
    }
  } finally {
    if (!persisted) {
      cleanupImportedVoucherFile(input.storageDir, storedPath, metadata.originalName)
    }
  }
}

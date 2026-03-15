import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildElectronicVoucherFingerprint,
  importElectronicVoucher
} from '../services/electronicVoucher'
import { requireLedgerAccess, requirePermission } from './session'

function getElectronicVoucherRootDir(): string {
  return path.join(app.getPath('userData'), 'electronic-vouchers')
}

export function registerElectronicVoucherHandlers(): void {
  ipcMain.handle(
    'eVoucher:import',
    (
      event,
      payload: {
        ledgerId: number
        sourcePath: string
        sourceNumber?: string | null
        sourceDate?: string | null
        amountCents?: number | null
      }
    ) => {
      try {
        const user = requirePermission(event, 'voucher_entry')
        const db = getDatabase()
        requireLedgerAccess(event, db, payload.ledgerId)

        if (!fs.existsSync(payload.sourcePath)) {
          return { success: false, error: '电子凭证源文件不存在' }
        }

        const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ?').get(payload.ledgerId) as
          | { id: number }
          | undefined
        if (!ledger) {
          return { success: false, error: '账套不存在' }
        }

        const ledgerDir = path.join(getElectronicVoucherRootDir(), `ledger-${payload.ledgerId}`)
        const imported = importElectronicVoucher(db, {
          ledgerId: payload.ledgerId,
          sourcePath: payload.sourcePath,
          storageDir: ledgerDir,
          importedBy: user.id,
          sourceNumber: payload.sourceNumber ?? null,
          sourceDate: payload.sourceDate ?? null,
          amountCents: payload.amountCents ?? null
        })

        appendOperationLog(db, {
          ledgerId: payload.ledgerId,
          userId: user.id,
          username: user.username,
          module: 'electronic_voucher',
          action: 'import',
          targetType: 'electronic_voucher_record',
          targetId: imported.recordId,
          details: {
            sourcePath: payload.sourcePath,
            storedPath: imported.storedPath,
            voucherType: imported.voucherType
          }
        })

        return {
          success: true,
          fileId: imported.fileId,
          recordId: imported.recordId,
          voucherType: imported.voucherType,
          fingerprint: imported.fingerprint
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '导入电子凭证失败'
        }
      }
    }
  )

  ipcMain.handle('eVoucher:list', (event, ledgerId: number) => {
    requirePermission(event, 'voucher_entry')
    const db = getDatabase()
    requireLedgerAccess(event, db, ledgerId)
    return db
      .prepare(
        `SELECT
           r.*,
           f.original_name,
           f.stored_path,
           f.sha256,
           f.file_size,
           (
             SELECT verification_status
             FROM electronic_voucher_verifications v
             WHERE v.record_id = r.id
             ORDER BY v.id DESC
             LIMIT 1
           ) AS latest_verification_status
         FROM electronic_voucher_records r
         INNER JOIN electronic_voucher_files f ON f.id = r.file_id
         WHERE r.ledger_id = ?
         ORDER BY r.id DESC`
      )
      .all(ledgerId)
  })

  ipcMain.handle(
    'eVoucher:verify',
    (
      event,
      payload: {
        recordId: number
        verificationStatus?: 'verified' | 'failed'
        verificationMethod?: string
        verificationMessage?: string
      }
    ) => {
      try {
        const user = requirePermission(event, 'voucher_entry')
        const db = getDatabase()
        const record = db
          .prepare('SELECT id, ledger_id, voucher_type FROM electronic_voucher_records WHERE id = ?')
          .get(payload.recordId) as
          | { id: number; ledger_id: number; voucher_type: string }
          | undefined

        if (!record) {
          return { success: false, error: '电子凭证记录不存在' }
        }
        requireLedgerAccess(event, db, record.ledger_id)

        const verificationStatus =
          payload.verificationStatus ??
          (record.voucher_type === 'unknown' ? 'failed' : 'verified')

        db.prepare(
          `INSERT INTO electronic_voucher_verifications (
             record_id,
             verification_status,
             verification_method,
             verification_message,
             verified_at
           ) VALUES (?, ?, ?, ?, CASE WHEN ? = 'verified' THEN datetime('now') ELSE NULL END)`
        ).run(
          payload.recordId,
          verificationStatus,
          payload.verificationMethod ?? 'manual',
          payload.verificationMessage ?? (verificationStatus === 'verified' ? '校验通过' : '校验失败'),
          verificationStatus
        )

        db.prepare(
          `UPDATE electronic_voucher_records
           SET status = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(verificationStatus === 'verified' ? 'verified' : 'rejected', payload.recordId)

        appendOperationLog(db, {
          ledgerId: record.ledger_id,
          userId: user.id,
          username: user.username,
          module: 'electronic_voucher',
          action: 'verify',
          targetType: 'electronic_voucher_record',
          targetId: payload.recordId,
          details: {
            verificationStatus,
            verificationMethod: payload.verificationMethod ?? 'manual'
          }
        })

        return {
          success: verificationStatus === 'verified',
          verificationStatus
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '电子凭证校验失败'
        }
      }
    }
  )

  ipcMain.handle(
    'eVoucher:parse',
    (
      event,
      payload: {
        recordId: number
        sourceNumber?: string | null
        sourceDate?: string | null
        amountCents?: number | null
        counterpartName?: string | null
      }
    ) => {
      try {
        const user = requirePermission(event, 'voucher_entry')
        const db = getDatabase()
        const record = db
          .prepare(
            `SELECT
               r.*,
               f.sha256,
               f.original_name
             FROM electronic_voucher_records r
             INNER JOIN electronic_voucher_files f ON f.id = r.file_id
             WHERE r.id = ?`
          )
          .get(payload.recordId) as
          | {
              id: number
              ledger_id: number
              voucher_type: 'digital_invoice' | 'bank_receipt' | 'bank_statement' | 'unknown'
              sha256: string
              original_name: string
            }
          | undefined

        if (!record) {
          return { success: false, error: '电子凭证记录不存在' }
        }
        requireLedgerAccess(event, db, record.ledger_id)

        const fingerprint = buildElectronicVoucherFingerprint({
          sha256: record.sha256,
          type: record.voucher_type,
          sourceNumber: payload.sourceNumber ?? null,
          sourceDate: payload.sourceDate ?? null,
          amountCents: payload.amountCents ?? null
        })

        const duplicate = db
          .prepare(
            `SELECT id
             FROM electronic_voucher_records
             WHERE ledger_id = ? AND fingerprint = ? AND id <> ?
             LIMIT 1`
          )
          .get(record.ledger_id, fingerprint, payload.recordId) as { id: number } | undefined

        if (duplicate) {
          return { success: false, error: '解析结果与已有电子凭证重复，已阻止更新' }
        }

        db.prepare(
          `UPDATE electronic_voucher_records
           SET source_number = ?,
               source_date = ?,
               amount_cents = ?,
               counterpart_name = ?,
               fingerprint = ?,
               status = 'parsed',
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          payload.sourceNumber ?? null,
          payload.sourceDate ?? null,
          payload.amountCents ?? null,
          payload.counterpartName ?? null,
          fingerprint,
          payload.recordId
        )

        appendOperationLog(db, {
          ledgerId: record.ledger_id,
          userId: user.id,
          username: user.username,
          module: 'electronic_voucher',
          action: 'parse',
          targetType: 'electronic_voucher_record',
          targetId: payload.recordId,
          details: {
            sourceNumber: payload.sourceNumber ?? null,
            sourceDate: payload.sourceDate ?? null,
            amountCents: payload.amountCents ?? null
          }
        })

        return {
          success: true,
          structuredData: {
            sourceNumber: payload.sourceNumber ?? null,
            sourceDate: payload.sourceDate ?? null,
            amountCents: payload.amountCents ?? null,
            counterpartName: payload.counterpartName ?? null,
            originalName: record.original_name
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '电子凭证解析失败'
        }
      }
    }
  )

  ipcMain.handle(
    'eVoucher:convert',
    (event, payload: { recordId: number; voucherDate?: string; voucherWord?: string }) => {
      try {
        const user = requirePermission(event, 'voucher_entry')
        const db = getDatabase()
        const record = db
          .prepare(
            `SELECT
               r.*,
               f.original_name
             FROM electronic_voucher_records r
             INNER JOIN electronic_voucher_files f ON f.id = r.file_id
             WHERE r.id = ?`
          )
          .get(payload.recordId) as
          | {
              id: number
              ledger_id: number
              source_number: string | null
              source_date: string | null
              counterpart_name: string | null
              amount_cents: number | null
              original_name: string
            }
          | undefined

        if (!record) {
          return { success: false, error: '电子凭证记录不存在' }
        }
        requireLedgerAccess(event, db, record.ledger_id)

        const draftVoucher = {
          ledgerId: record.ledger_id,
          voucherDate: payload.voucherDate ?? record.source_date ?? new Date().toISOString().slice(0, 10),
          voucherWord: payload.voucherWord ?? '记',
          summary:
            record.source_number?.trim() ||
            record.counterpart_name?.trim() ||
            record.original_name,
          sourceRecordId: record.id,
          entries: [] as Array<{
            summary: string
            subjectCode: string
            debitAmount: string
            creditAmount: string
            cashFlowItemId: number | null
          }>
        }

        db.prepare(
          `UPDATE electronic_voucher_records
           SET status = 'converted', updated_at = datetime('now')
           WHERE id = ?`
        ).run(payload.recordId)

        appendOperationLog(db, {
          ledgerId: record.ledger_id,
          userId: user.id,
          username: user.username,
          module: 'electronic_voucher',
          action: 'convert',
          targetType: 'electronic_voucher_record',
          targetId: payload.recordId,
          details: {
            voucherDate: draftVoucher.voucherDate
          }
        })

        return {
          success: true,
          draftVoucher
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '电子凭证转换失败'
        }
      }
    }
  )
}

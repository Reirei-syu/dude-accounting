import fs from 'node:fs'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import { buildArchiveManifest, writeArchiveManifest } from '../services/archiveExport'
import { buildTimestampToken, computeFileSha256, ensureDirectory } from '../services/fileIntegrity'
import { requireLedgerAccess, requirePermission } from './session'

function getArchiveRootDir(): string {
  return path.join(app.getPath('userData'), 'archive-exports')
}

export function registerArchiveHandlers(): void {
  ipcMain.handle(
    'archive:export',
    (event, payload: { ledgerId: number; fiscalYear: string }) => {
      try {
        const user = requirePermission(event, 'ledger_settings')
        const db = getDatabase()
        requireLedgerAccess(event, db, payload.ledgerId)
        const ledger = db.prepare('SELECT id, name FROM ledgers WHERE id = ?').get(payload.ledgerId) as
          | { id: number; name: string }
          | undefined

        if (!ledger) {
          return { success: false, error: '账套不存在' }
        }

        const exportDir = path.join(
          getArchiveRootDir(),
          `ledger-${payload.ledgerId}-${payload.fiscalYear}-${buildTimestampToken()}`
        )
        const originalVoucherDir = path.join(exportDir, 'original-vouchers')
        ensureDirectory(exportDir)
        ensureDirectory(originalVoucherDir)

        const periodLike = `${payload.fiscalYear}-%`
        const vouchers = db
          .prepare(
            `SELECT *
             FROM vouchers
             WHERE ledger_id = ? AND period LIKE ?
             ORDER BY voucher_date ASC, voucher_number ASC, id ASC`
          )
          .all(payload.ledgerId, periodLike)

        const voucherEntries = db
          .prepare(
            `SELECT ve.*
             FROM voucher_entries ve
             INNER JOIN vouchers v ON v.id = ve.voucher_id
             WHERE v.ledger_id = ? AND v.period LIKE ?
             ORDER BY ve.voucher_id ASC, ve.row_order ASC, ve.id ASC`
          )
          .all(payload.ledgerId, periodLike)

        const electronicVoucherRows = db
          .prepare(
            `SELECT
               r.*,
               f.original_name,
               f.stored_path,
               f.sha256,
               f.file_size
             FROM electronic_voucher_records r
             INNER JOIN electronic_voucher_files f ON f.id = r.file_id
             WHERE r.ledger_id = ? AND (
               r.source_date LIKE ? OR f.imported_at LIKE ?
             )
             ORDER BY r.id ASC`
          )
          .all(payload.ledgerId, periodLike, periodLike) as Array<{
          id: number
          original_name: string
          stored_path: string
          sha256: string
          file_size: number
        }>

        const operationLogs = db
          .prepare(
            `SELECT *
             FROM operation_logs
             WHERE ledger_id = ? AND created_at LIKE ?
             ORDER BY id ASC`
          )
          .all(payload.ledgerId, periodLike)

        fs.writeFileSync(path.join(exportDir, 'vouchers.json'), JSON.stringify(vouchers, null, 2), 'utf8')
        fs.writeFileSync(
          path.join(exportDir, 'voucher-entries.json'),
          JSON.stringify(voucherEntries, null, 2),
          'utf8'
        )
        fs.writeFileSync(
          path.join(exportDir, 'electronic-vouchers.json'),
          JSON.stringify(electronicVoucherRows, null, 2),
          'utf8'
        )
        fs.writeFileSync(
          path.join(exportDir, 'operation-logs.json'),
          JSON.stringify(operationLogs, null, 2),
          'utf8'
        )

        let copiedOriginalVoucherCount = 0
        for (const row of electronicVoucherRows) {
          if (!fs.existsSync(row.stored_path)) continue
          fs.copyFileSync(row.stored_path, path.join(originalVoucherDir, `${row.id}-${row.original_name}`))
          copiedOriginalVoucherCount += 1
        }

        const manifest = buildArchiveManifest({
          ledgerId: payload.ledgerId,
          ledgerName: ledger.name,
          fiscalYear: payload.fiscalYear,
          exportedAt: new Date().toISOString(),
          originalVoucherFileCount: copiedOriginalVoucherCount,
          voucherCount: vouchers.length,
          reportCount: 0,
          metadata: {
            exportMode: 'export-first',
            generatedFiles: [
              'manifest.json',
              'vouchers.json',
              'voucher-entries.json',
              'electronic-vouchers.json',
              'operation-logs.json'
            ],
            reportStatus: 'pending'
          }
        })

        const manifestPath = writeArchiveManifest(exportDir, manifest)
        const checksum = computeFileSha256(manifestPath)

        const result = db
          .prepare(
            `INSERT INTO archive_exports (
               ledger_id,
               fiscal_year,
               export_path,
               manifest_path,
               checksum,
               status,
               item_count,
               created_by
             ) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?)`
          )
          .run(
            payload.ledgerId,
            payload.fiscalYear,
            exportDir,
            manifestPath,
            checksum,
            vouchers.length + voucherEntries.length + electronicVoucherRows.length + operationLogs.length,
            user.id
          )

        appendOperationLog(db, {
          ledgerId: payload.ledgerId,
          userId: user.id,
          username: user.username,
          module: 'archive',
          action: 'export',
          targetType: 'archive_export',
          targetId: Number(result.lastInsertRowid),
          details: {
            fiscalYear: payload.fiscalYear,
            exportPath: exportDir,
            manifestPath,
            copiedOriginalVoucherCount
          }
        })

        return {
          success: true,
          exportId: Number(result.lastInsertRowid),
          exportPath: exportDir,
          manifestPath
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '导出电子档案失败'
        }
      }
    }
  )

  ipcMain.handle('archive:list', (event, ledgerId?: number) => {
    const user = requirePermission(event, 'ledger_settings')
    const db = getDatabase()

    if (typeof ledgerId === 'number') {
      requireLedgerAccess(event, db, ledgerId)
      return db
        .prepare(
          `SELECT *
           FROM archive_exports
           WHERE ledger_id = ?
           ORDER BY id DESC`
        )
        .all(ledgerId)
    }

    if (user.isAdmin) {
      return db.prepare('SELECT * FROM archive_exports ORDER BY id DESC').all()
    }

    return db
      .prepare(
        `SELECT ae.*
           FROM archive_exports ae
           INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = ae.ledger_id
          WHERE ulp.user_id = ?
          ORDER BY ae.id DESC`
      )
      .all(user.id)
  })

  ipcMain.handle('archive:getManifest', (event, exportId: number) => {
    requirePermission(event, 'ledger_settings')
    const db = getDatabase()
    const row = db.prepare('SELECT ledger_id, manifest_path FROM archive_exports WHERE id = ?').get(exportId) as
      | { ledger_id: number; manifest_path: string }
      | undefined

    if (!row) {
      throw new Error('档案导出记录不存在')
    }
    requireLedgerAccess(event, db, row.ledger_id)

    if (!fs.existsSync(row.manifest_path)) {
      throw new Error('归档清单文件不存在')
    }

    return JSON.parse(fs.readFileSync(row.manifest_path, 'utf8'))
  })
}

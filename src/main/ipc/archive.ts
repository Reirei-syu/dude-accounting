import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import {
  buildArchiveManifest,
  validateArchiveExportPackage,
  writeArchiveManifest
} from '../services/archiveExport'
import { buildTimestampToken, computeFileSha256, ensureDirectory } from '../services/fileIntegrity'
import { formatLocalDateTime } from '../services/localTime'
import { getPathPreference, rememberPathPreference } from '../services/pathPreference'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requireLedgerAccess, requirePermission } from './session'

const ARCHIVE_LAST_DIR_KEY = 'archive_export_last_dir'

function getDefaultArchiveRootDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '电子档案导出')
}

async function pickArchiveRootDirectory(
  sender: Electron.WebContents,
  defaultPath: string
): Promise<{ cancelled: boolean; directoryPath?: string }> {
  const browserWindow = BrowserWindow.fromWebContents(sender)
  const options = {
    title: '选择电子档案导出目录',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true }
  }

  return {
    cancelled: false,
    directoryPath: result.filePaths[0]
  }
}

export function registerArchiveHandlers(): void {
  ipcMain.handle(
    'archive:export',
    async (
      event,
      payload: { ledgerId: number; fiscalYear: string; directoryPath?: string }
    ) => {
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

        const preferredDir = getPathPreference(db, ARCHIVE_LAST_DIR_KEY) ?? getDefaultArchiveRootDir()
        const picked = payload.directoryPath
          ? { cancelled: false, directoryPath: payload.directoryPath }
          : await pickArchiveRootDirectory(event.sender, preferredDir)

        if (picked.cancelled || !picked.directoryPath) {
          return { success: false, cancelled: true }
        }

        rememberPathPreference(db, ARCHIVE_LAST_DIR_KEY, picked.directoryPath)

        const exportDir = path.join(
          picked.directoryPath,
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
            selectedDirectory: picked.directoryPath,
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
            selectedDirectory: picked.directoryPath,
            exportPath: exportDir,
            manifestPath,
            copiedOriginalVoucherCount
          }
        })

        return {
          success: true,
          exportId: Number(result.lastInsertRowid),
          directoryPath: picked.directoryPath,
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

  ipcMain.handle('archive:validate', (event, exportId: number) => {
    try {
      const user = requirePermission(event, 'ledger_settings')
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM archive_exports WHERE id = ?').get(exportId) as
        | {
            id: number
            ledger_id: number
            fiscal_year: string
            export_path: string
            manifest_path: string
            checksum: string | null
          }
        | undefined

      if (!row) {
        return { success: false, error: '电子档案导出记录不存在' }
      }

      requireLedgerAccess(event, db, row.ledger_id)

      const validation = validateArchiveExportPackage({
        exportPath: row.export_path,
        manifestPath: row.manifest_path,
        expectedChecksum: row.checksum,
        ledgerId: row.ledger_id,
        fiscalYear: row.fiscal_year
      })

      db.prepare(
        `UPDATE archive_exports
         SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END
         WHERE id = ?`
      ).run(
        validation.valid ? 'validated' : 'failed',
        validation.valid ? 'validated' : 'failed',
        validation.valid ? formatLocalDateTime() : null,
        exportId
      )

      appendOperationLog(db, {
        ledgerId: row.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'archive',
        action: 'validate',
        targetType: 'archive_export',
        targetId: row.id,
        details: {
          valid: validation.valid,
          actualChecksum: validation.actualChecksum,
          error: validation.error ?? null,
          manifest: validation.manifest ?? null,
          missingFiles: validation.missingFiles ?? []
        }
      })

      return {
        success: validation.valid,
        valid: validation.valid,
        actualChecksum: validation.actualChecksum,
        error: validation.error
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '校验电子档案失败'
      }
    }
  })

  ipcMain.handle('archive:delete', (event, exportId: number) => {
    try {
      const user = requirePermission(event, 'ledger_settings')
      const db = getDatabase()
      const row = db.prepare('SELECT * FROM archive_exports WHERE id = ?').get(exportId) as
        | {
            id: number
            ledger_id: number
            fiscal_year: string
            export_path: string
            manifest_path: string
          }
        | undefined

      if (!row) {
        return { success: false, error: '电子档案导出记录不存在' }
      }

      requireLedgerAccess(event, db, row.ledger_id)

      const versionRows = db
        .prepare(
          `SELECT id
             FROM archive_exports
            WHERE ledger_id = ? AND fiscal_year = ?
            ORDER BY id DESC`
        )
        .all(row.ledger_id, row.fiscal_year) as Array<{ id: number }>

      assertHistoricalVersionDeletable(
        row.id,
        versionRows.map((item) => item.id),
        '归档'
      )

      db.prepare('DELETE FROM archive_exports WHERE id = ?').run(exportId)

      if (fs.existsSync(row.export_path)) {
        fs.rmSync(row.export_path, { recursive: true, force: true })
      }

      appendOperationLog(db, {
        ledgerId: row.ledger_id,
        userId: user.id,
        username: user.username,
        module: 'archive',
        action: 'delete',
        targetType: 'archive_export',
        targetId: row.id,
        details: {
          fiscalYear: row.fiscal_year,
          exportPath: row.export_path,
          manifestPath: row.manifest_path
        }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '删除电子档案失败'
      }
    }
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

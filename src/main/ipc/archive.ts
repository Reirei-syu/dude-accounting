import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  createArchiveExportRecord,
  deleteArchiveExportRecord,
  getArchiveExportById,
  listArchiveExportIdsByLedger,
  listArchiveExports,
  updateArchiveExportValidation
} from '../services/archiveCatalog'
import { appendOperationLog } from '../services/auditLog'
import {
  buildArchiveManifest,
  validateArchiveExportPackage,
  writeArchiveManifest
} from '../services/archiveExport'
import {
  deleteArchivePhysicalPackage,
  getArchivePhysicalPackageStatus
} from '../services/packageDeletion'
import {
  buildUniqueDirectoryPath,
  computeFileSha256,
  ensureDirectory,
  sanitizePathSegment
} from '../services/fileIntegrity'
import { formatLocalDateTime } from '../services/localTime'
import { getPathPreference, rememberPathPreference } from '../services/pathPreference'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requireLedgerAccess, requirePermission } from './session'

const ARCHIVE_LAST_DIR_KEY = 'archive_export_last_dir'

function buildArchivePackageDirectoryName(ledgerName: string, fiscalYear: string): string {
  const ledgerLabel = sanitizePathSegment(ledgerName.trim() || '未命名账套', '未命名账套')
  const periodLabel = sanitizePathSegment(fiscalYear.trim() || '未设置期间', '未设置期间')
  return `${ledgerLabel}_${periodLabel}_档案包`
}

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
    async (event, payload: { ledgerId: number; fiscalYear: string; directoryPath?: string }) =>
      withIpcTelemetry(
        {
          channel: 'archive:export',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId,
            fiscalYear: payload.fiscalYear,
            hasDirectoryPath: Boolean(payload.directoryPath)
          }
        },
        async () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            const db = getDatabase()
            requireLedgerAccess(event, db, payload.ledgerId)
            const ledger = db
              .prepare('SELECT id, name FROM ledgers WHERE id = ?')
              .get(payload.ledgerId) as { id: number; name: string } | undefined

            if (!ledger) {
              return { success: false, error: '账套不存在' }
            }

            const preferredDir =
              getPathPreference(db, ARCHIVE_LAST_DIR_KEY) ?? getDefaultArchiveRootDir()
            const picked = payload.directoryPath
              ? { cancelled: false, directoryPath: payload.directoryPath }
              : await pickArchiveRootDirectory(event.sender, preferredDir)

            if (picked.cancelled || !picked.directoryPath) {
              return { success: false, cancelled: true }
            }

            rememberPathPreference(db, ARCHIVE_LAST_DIR_KEY, picked.directoryPath)
            const createdAt = formatLocalDateTime()

            const exportDir = buildUniqueDirectoryPath(
              picked.directoryPath,
              buildArchivePackageDirectoryName(ledger.name, payload.fiscalYear)
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

            fs.writeFileSync(
              path.join(exportDir, 'vouchers.json'),
              JSON.stringify(vouchers, null, 2),
              'utf8'
            )
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
              fs.copyFileSync(
                row.stored_path,
                path.join(originalVoucherDir, `${row.id}-${row.original_name}`)
              )
              copiedOriginalVoucherCount += 1
            }

            const manifest = buildArchiveManifest({
              ledgerId: payload.ledgerId,
              ledgerName: ledger.name,
              fiscalYear: payload.fiscalYear,
              exportedAt: createdAt,
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

            const exportId = createArchiveExportRecord(db, {
              ledgerId: payload.ledgerId,
              fiscalYear: payload.fiscalYear,
              exportPath: exportDir,
              manifestPath,
              checksum,
              itemCount:
                vouchers.length +
                voucherEntries.length +
                electronicVoucherRows.length +
                operationLogs.length,
              createdBy: user.id,
              createdAt
            })

            appendOperationLog(db, {
              ledgerId: payload.ledgerId,
              userId: user.id,
              username: user.username,
              module: 'archive',
              action: 'export',
              targetType: 'archive_export',
              targetId: exportId,
              details: {
                fiscalYear: payload.fiscalYear,
                selectedDirectory: picked.directoryPath,
                exportPath: exportDir,
                manifestPath,
                copiedOriginalVoucherCount,
                createdAt
              }
            })

            return {
              success: true,
              exportId,
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
  )

  ipcMain.handle('archive:list', (event, ledgerId?: number) =>
    withIpcTelemetry(
      {
        channel: 'archive:list',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: typeof ledgerId === 'number' ? ledgerId : null
        }
      },
      () => {
        const user = requirePermission(event, 'ledger_settings')
        const db = getDatabase()

        if (typeof ledgerId === 'number') {
          requireLedgerAccess(event, db, ledgerId)
          return listArchiveExports(db, {
            ledgerId,
            userId: user.id,
            isAdmin: user.isAdmin
          })
        }

        return listArchiveExports(db, {
          userId: user.id,
          isAdmin: user.isAdmin
        })
      }
    )
  )

  ipcMain.handle('archive:validate', (event, exportId: number) =>
    withIpcTelemetry(
      {
        channel: 'archive:validate',
        baseDir: app.getPath('userData'),
        context: { exportId }
      },
      () => {
        try {
          const user = requirePermission(event, 'ledger_settings')
          const db = getDatabase()
          const row = getArchiveExportById(db, exportId)

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

          updateArchiveExportValidation(db, exportId, {
            valid: validation.valid,
            validatedAt: validation.valid ? formatLocalDateTime() : null
          })

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
      }
    )
  )

  ipcMain.handle(
    'archive:delete',
    (
      event,
      payload: {
        exportId: number
        deleteRecordOnly?: boolean
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'archive:delete',
          baseDir: app.getPath('userData'),
          context: {
            exportId: payload.exportId,
            deleteRecordOnly: payload.deleteRecordOnly === true
          }
        },
        () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            const db = getDatabase()
            const row = getArchiveExportById(db, payload.exportId)

            if (!row) {
              return { success: false, error: '电子档案导出记录不存在' }
            }

            requireLedgerAccess(event, db, row.ledger_id)

            assertHistoricalVersionDeletable(
              row.id,
              listArchiveExportIdsByLedger(db, row.ledger_id),
              '归档'
            )

            const physicalStatus = getArchivePhysicalPackageStatus(row.export_path)

            if (payload.deleteRecordOnly && physicalStatus.physicalExists) {
              return {
                success: false,
                error: '路径下档案包仍存在，请执行正常删除以同时删除实体包。'
              }
            }

            const deletionResult = payload.deleteRecordOnly
              ? {
                  physicalExists: false,
                  deletedPaths: [],
                  packagePath: physicalStatus.packagePath
                }
              : deleteArchivePhysicalPackage(row.export_path)

            if (!payload.deleteRecordOnly && !deletionResult.physicalExists) {
              return {
                success: false,
                missingPhysicalPackage: true,
                requiresRecordDeletionConfirmation: true,
                packagePath: deletionResult.packagePath,
                error: '路径下档案包已不存在，是否删除本条记录？'
              }
            }

            deleteArchiveExportRecord(db, payload.exportId)

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
                manifestPath: row.manifest_path,
                deletedPaths: deletionResult.deletedPaths,
                deleteMode: payload.deleteRecordOnly ? 'record_only' : 'record_and_package',
                physicalPackageMissing: !deletionResult.physicalExists
              }
            })

            return {
              success: true,
              deletedPhysicalPackage: deletionResult.physicalExists,
              deletedPaths: deletionResult.deletedPaths
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '删除电子档案失败'
            }
          }
        }
      )
  )

  ipcMain.handle('archive:getManifest', (event, exportId: number) => {
    requirePermission(event, 'ledger_settings')
    const db = getDatabase()
    const row = getArchiveExportById(db, exportId)

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

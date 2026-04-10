import fs from 'node:fs'
import path from 'node:path'
import {
  createArchiveExportRecord,
  deleteArchiveExportRecord,
  getArchiveExportById,
  listArchiveExportIdsByLedger,
  listArchiveExports,
  updateArchiveExportValidation
} from '../services/archiveCatalog'
import {
  buildArchiveManifest,
  validateArchiveExportPackage,
  writeArchiveManifest
} from '../services/archiveExport'
import {
  buildUniqueDirectoryPath,
  computeFileSha256,
  ensureDirectory,
  sanitizePathSegment
} from '../services/fileIntegrity'
import { formatLocalDateTime } from '../services/localTime'
import {
  deleteArchivePhysicalPackage,
  getArchivePhysicalPackageStatus
} from '../services/packageDeletion'
import { rememberPathPreference } from '../services/pathPreference'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import {
  requireCommandLedgerAccess,
  requireCommandPermission
} from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

const ARCHIVE_LAST_DIR_KEY = 'archive_export_last_dir'

function buildArchivePackageDirectoryName(ledgerName: string, fiscalYear: string): string {
  const ledgerLabel = sanitizePathSegment(ledgerName.trim() || '未命名账套', '未命名账套')
  const periodLabel = sanitizePathSegment(fiscalYear.trim() || '未设置期间', '未设置期间')
  return `${ledgerLabel}_${periodLabel}_档案包`
}

export async function exportArchiveCommand(
  context: CommandContext,
  payload: { ledgerId: number; fiscalYear: string; directoryPath: string }
): Promise<
  CommandResult<{ exportId: number; directoryPath: string; exportPath: string; manifestPath: string }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const ledger = context.db
      .prepare('SELECT id, name FROM ledgers WHERE id = ?')
      .get(payload.ledgerId) as { id: number; name: string } | undefined
    if (!ledger) {
      throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId: payload.ledgerId }, 5)
    }

    rememberPathPreference(context.db, ARCHIVE_LAST_DIR_KEY, payload.directoryPath)
    const createdAt = formatLocalDateTime(context.now)
    const exportDir = buildUniqueDirectoryPath(
      payload.directoryPath,
      buildArchivePackageDirectoryName(ledger.name, payload.fiscalYear)
    )
    const originalVoucherDir = path.join(exportDir, 'original-vouchers')
    ensureDirectory(exportDir)
    ensureDirectory(originalVoucherDir)

    const periodLike = `${payload.fiscalYear}-%`
    const vouchers = context.db
      .prepare(
        `SELECT *
         FROM vouchers
         WHERE ledger_id = ? AND period LIKE ?
         ORDER BY voucher_date ASC, voucher_number ASC, id ASC`
      )
      .all(payload.ledgerId, periodLike)
    const voucherEntries = context.db
      .prepare(
        `SELECT ve.*
         FROM voucher_entries ve
         INNER JOIN vouchers v ON v.id = ve.voucher_id
         WHERE v.ledger_id = ? AND v.period LIKE ?
         ORDER BY ve.voucher_id ASC, ve.row_order ASC, ve.id ASC`
      )
      .all(payload.ledgerId, periodLike)
    const electronicVoucherRows = context.db
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
    const operationLogs = context.db
      .prepare(
        `SELECT *
         FROM operation_logs
         WHERE ledger_id = ? AND created_at LIKE ?
         ORDER BY id ASC`
      )
      .all(payload.ledgerId, periodLike)

    fs.writeFileSync(path.join(exportDir, 'vouchers.json'), JSON.stringify(vouchers, null, 2), 'utf8')
    fs.writeFileSync(path.join(exportDir, 'voucher-entries.json'), JSON.stringify(voucherEntries, null, 2), 'utf8')
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
      exportedAt: createdAt,
      originalVoucherFileCount: copiedOriginalVoucherCount,
      voucherCount: vouchers.length,
      reportCount: 0,
      metadata: {
        exportMode: 'export-first',
        selectedDirectory: payload.directoryPath,
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
    const exportId = createArchiveExportRecord(context.db, {
      ledgerId: payload.ledgerId,
      fiscalYear: payload.fiscalYear,
      exportPath: exportDir,
      manifestPath,
      checksum,
      itemCount: vouchers.length + voucherEntries.length + electronicVoucherRows.length + operationLogs.length,
      createdBy: actor.id,
      createdAt
    })

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: payload.ledgerId,
        module: 'archive',
        action: 'export',
        targetType: 'archive_export',
        targetId: exportId,
        details: {
          fiscalYear: payload.fiscalYear,
          selectedDirectory: payload.directoryPath,
          exportPath: exportDir,
          manifestPath,
          copiedOriginalVoucherCount,
          createdAt
        }
      }
    )

    return {
      exportId,
      directoryPath: payload.directoryPath,
      exportPath: exportDir,
      manifestPath
    }
  })
}

export async function listArchivesCommand(
  context: CommandContext,
  payload: { ledgerId?: number } = {}
): Promise<CommandResult<ReturnType<typeof listArchiveExports>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    if (typeof payload.ledgerId === 'number') {
      requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
      return listArchiveExports(context.db, {
        ledgerId: payload.ledgerId,
        userId: actor.id,
        isAdmin: actor.isAdmin
      })
    }

    return listArchiveExports(context.db, {
      userId: actor.id,
      isAdmin: actor.isAdmin
    })
  })
}

export async function validateArchiveCommand(
  context: CommandContext,
  payload: { exportId: number }
): Promise<CommandResult<{ valid: boolean; actualChecksum: string | null; error?: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const row = getArchiveExportById(context.db, payload.exportId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '电子档案导出记录不存在', { exportId: payload.exportId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
    const validation = validateArchiveExportPackage({
      exportPath: row.export_path,
      manifestPath: row.manifest_path,
      expectedChecksum: row.checksum,
      ledgerId: row.ledger_id,
      fiscalYear: row.fiscal_year
    })
    updateArchiveExportValidation(context.db, payload.exportId, {
      valid: validation.valid,
      validatedAt: validation.valid ? formatLocalDateTime(context.now) : null
    })
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: row.ledger_id,
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
      }
    )
    return {
      valid: validation.valid,
      actualChecksum: validation.actualChecksum,
      error: validation.error
    }
  })
}

export async function deleteArchiveCommand(
  context: CommandContext,
  payload: { exportId: number; deleteRecordOnly?: boolean }
): Promise<CommandResult<{ deletedPhysicalPackage: boolean; deletedPaths: string[]; packagePath?: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const row = getArchiveExportById(context.db, payload.exportId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '电子档案导出记录不存在', { exportId: payload.exportId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
    assertHistoricalVersionDeletable(row.id, listArchiveExportIdsByLedger(context.db, row.ledger_id), '归档')
    const physicalStatus = getArchivePhysicalPackageStatus(row.export_path)
    if (payload.deleteRecordOnly && physicalStatus.physicalExists) {
      throw new CommandError('VALIDATION_ERROR', '路径下档案包仍存在，请执行正常删除以同时删除实体包。', null, 2)
    }
    const deletionResult = payload.deleteRecordOnly
      ? { physicalExists: false, deletedPaths: [], packagePath: physicalStatus.packagePath }
      : deleteArchivePhysicalPackage(row.export_path)
    if (!payload.deleteRecordOnly && !deletionResult.physicalExists) {
      throw new CommandError(
        'RISK_CONFIRMATION_REQUIRED',
        '路径下档案包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
        {
          packagePath: deletionResult.packagePath,
          missingPhysicalPackage: true
        },
        2
      )
    }
    deleteArchiveExportRecord(context.db, payload.exportId)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: row.ledger_id,
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
      }
    )
    return {
      deletedPhysicalPackage: deletionResult.physicalExists,
      deletedPaths: deletionResult.deletedPaths,
      packagePath: deletionResult.packagePath
    }
  })
}

export async function getArchiveManifestCommand(
  context: CommandContext,
  payload: { exportId: number }
): Promise<CommandResult<unknown>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const row = getArchiveExportById(context.db, payload.exportId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '档案导出记录不存在', { exportId: payload.exportId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
    if (!fs.existsSync(row.manifest_path)) {
      throw new CommandError('NOT_FOUND', '归档清单文件不存在', { manifestPath: row.manifest_path }, 5)
    }
    return JSON.parse(fs.readFileSync(row.manifest_path, 'utf8')) as unknown
  })
}

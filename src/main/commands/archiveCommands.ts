import fs from 'node:fs'
import type { ArchiveManifest } from '../services/archiveExport'
import {
  fileOperationDeletionRecovery,
  prepareFileOperationDeletion
} from '../services/fileOperationDeletion'
import { fileOperationCommandError } from './fileOperationError'
import { resolveSessionActor } from '../security/sessionAuthority'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { FileOperationLifecycle } from '../services/fileOperationLifecycle'
import {
  fileOperationArtifactRecovery,
  prepareFileOperationArtifact
} from '../services/fileOperationArtifact'
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
import { computeFileSha256, ensureDirectory, sanitizePathSegment } from '../services/fileIntegrity'
import { formatLocalDateTime } from '../services/localTime'
import { getArchivePhysicalPackageStatus } from '../services/packageDeletion'
import { rememberPathPreference } from '../services/pathPreference'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requireCommandLedgerAccess, requireCommandPermission } from './authz'
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
  payload: { ledgerId: number; fiscalYear: string; directoryPath: string; operationId?: string }
): Promise<
  CommandResult<{
    operationId: string
    exportId: number
    directoryPath: string
    exportPath: string
    manifestPath: string
  }>
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

    const createdAt = formatLocalDateTime(context.now)
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(context.db.name)
    const lifecycle = new FileOperationLifecycle(journal, context.db)
    let publishedDirectory = ''
    let checksum = ''
    let itemCount = 0
    let copiedOriginalVoucherCount = 0
    try {
      return lifecycle.execute(
        {
          operationId,
          kind: 'archive_export',
          actorId: actor.id,
          username: actor.username,
          ledgerId: payload.ledgerId,
          requestHash: createHash('sha256')
            .update(
              JSON.stringify([
                payload.ledgerId,
                payload.fiscalYear,
                path.resolve(payload.directoryPath)
              ])
            )
            .digest('hex')
        },
        fileOperationArtifactRecovery,
        (lease) => {
          prepareFileOperationArtifact(
            journal,
            lease,
            operationId,
            payload.directoryPath,
            (staging, finalDirectory) => {
              const packageName = buildArchivePackageDirectoryName(ledger.name, payload.fiscalYear)
              const exportDir = path.join(staging, packageName)
              publishedDirectory = path.join(finalDirectory, packageName)
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

              copiedOriginalVoucherCount = 0
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
              checksum = computeFileSha256(manifestPath)
              itemCount =
                vouchers.length +
                voucherEntries.length +
                electronicVoucherRows.length +
                operationLogs.length
            }
          )
        },
        () => {
          context.actor = resolveSessionActor(context.db, actor.session, actor.source)
          requireCommandPermission(context.actor, 'ledger_settings')
          requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
          const exportDir = publishedDirectory
          const manifestPath = path.join(exportDir, 'manifest.json')
          rememberPathPreference(context.db, ARCHIVE_LAST_DIR_KEY, payload.directoryPath)
          const exportId = createArchiveExportRecord(context.db, {
            ledgerId: payload.ledgerId,
            fiscalYear: payload.fiscalYear,
            exportPath: exportDir,
            manifestPath,
            checksum,
            itemCount,
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
                operationId,
                copiedOriginalVoucherCount,
                createdAt
              }
            }
          )

          return {
            operationId,
            exportId,
            directoryPath: payload.directoryPath,
            exportPath: exportDir,
            manifestPath
          }
        }
      )
    } catch (error) {
      throw fileOperationCommandError(error, operationId, journal)
    } finally {
      journal.close()
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
      throw new CommandError(
        'NOT_FOUND',
        '电子档案导出记录不存在',
        { exportId: payload.exportId },
        5
      )
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
  payload: { exportId: number; deleteRecordOnly?: boolean; operationId?: string }
): Promise<
  CommandResult<{
    operationId: string
    deletedPhysicalPackage: boolean
    deletedPaths: string[]
    packagePath?: string
  }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(context.db.name)
    try {
      const row = getArchiveExportById(context.db, payload.exportId)
      const prior = journal.getRecoveryRecord(operationId)
      const ledgerId = row?.ledger_id ?? prior?.ledgerId
      if (ledgerId !== null && ledgerId !== undefined)
        requireCommandLedgerAccess(context.db, context.actor, ledgerId)
      let targets: string[] = []
      let packagePath = ''
      const validate = (): void => {
        if (!row) throw new CommandError('NOT_FOUND', '归档记录不存在', null, 5)
        assertHistoricalVersionDeletable(
          row.id,
          listArchiveExportIdsByLedger(context.db, row.ledger_id),
          '归档'
        )
      }
      return new FileOperationLifecycle(journal, context.db).execute(
        {
          operationId,
          kind: 'archive_delete',
          actorId: actor.id,
          username: actor.username,
          ledgerId: ledgerId ?? null,
          requestHash: createHash('sha256')
            .update(JSON.stringify([payload.exportId, Boolean(payload.deleteRecordOnly)]))
            .digest('hex')
        },
        fileOperationDeletionRecovery,
        (lease) => {
          validate()
          if (!row) throw new Error('归档记录不存在')
          const physicalStatus = getArchivePhysicalPackageStatus(row.export_path)
          packagePath = physicalStatus.packagePath
          if (payload.deleteRecordOnly && physicalStatus.physicalExists)
            throw new CommandError('VALIDATION_ERROR', '实体包仍存在，请执行正常删除', null, 2)
          if (!payload.deleteRecordOnly && !physicalStatus.physicalExists)
            throw new CommandError(
              'RISK_CONFIRMATION_REQUIRED',
              '实体包已不存在，请显式传入 deleteRecordOnly=true',
              { packagePath, missingPhysicalPackage: true },
              2
            )
          targets = payload.deleteRecordOnly ? [] : [physicalStatus.packagePath]
          const parent = targets.length ? path.dirname(targets[0]) : path.dirname(context.db.name)
          prepareFileOperationDeletion(journal, lease, operationId, targets, parent)
        },
        () => {
          context.actor = resolveSessionActor(context.db, actor.session, actor.source)
          requireCommandPermission(context.actor, 'ledger_settings')
          if (ledgerId !== null && ledgerId !== undefined)
            requireCommandLedgerAccess(context.db, context.actor, ledgerId)
          validate()
          deleteArchiveExportRecord(context.db, payload.exportId)
          appendActorOperationLog(context, {
            ledgerId: ledgerId ?? null,
            module: 'archive',
            action: 'delete',
            targetType: 'archive_export',
            targetId: payload.exportId,
            details: {
              operationId,
              deleteMode: payload.deleteRecordOnly ? 'record_only' : 'record_and_package'
            }
          })
          return {
            operationId,
            deletedPhysicalPackage: targets.length > 0,
            deletedPaths: targets,
            packagePath
          }
        }
      )
    } catch (error) {
      throw fileOperationCommandError(error, operationId, journal)
    } finally {
      journal.close()
    }
  })
}

export async function getArchiveManifestCommand(
  context: CommandContext,
  payload: { exportId: number }
): Promise<CommandResult<ArchiveManifest>> {
  return withCommandResult(context, () => {
    requireCommandPermission(context.actor, 'ledger_settings')
    const row = getArchiveExportById(context.db, payload.exportId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '档案导出记录不存在', { exportId: payload.exportId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
    if (!fs.existsSync(row.manifest_path)) {
      throw new CommandError(
        'NOT_FOUND',
        '归档清单文件不存在',
        { manifestPath: row.manifest_path },
        5
      )
    }
    return JSON.parse(fs.readFileSync(row.manifest_path, 'utf8')) as ArchiveManifest
  })
}

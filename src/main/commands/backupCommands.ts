import fs from 'node:fs'
import { fileOperationDeletionRecovery, prepareFileOperationDeletion } from '../services/fileOperationDeletion'
import { fileOperationCommandError } from './fileOperationError'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveSessionActor } from '../security/sessionAuthority'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { FileOperationLifecycle } from '../services/fileOperationLifecycle'
import { fileOperationDatabaseRecovery } from '../services/fileOperationDatabaseRecovery'
import { withDatabaseReplacementLock } from '../services/databaseFileSwitch'
import { computeFileSha256 } from '../services/fileIntegrity'
import {
  fileOperationArtifactRecovery,
  treeDigest,
  prepareFileOperationArtifact
} from '../services/fileOperationArtifact'
import { closeDatabase, getDatabase, initializeDatabase } from '../database/init'
import {
  createBackupPackageRecord,
  deleteBackupPackageRecord,
  getBackupPackageById,
  listBackupPackageIdsByLedger,
  listBackupPackages,
  updateBackupPackageValidation
} from '../services/backupCatalog'
import {
  createLedgerBackupArtifact,
  importLedgerBackupArtifact,
  resolveBackupArtifactPaths,
  restoreBackupArtifact,
  type BackupManifest,
  validateBackupArtifact,
  validateLedgerBackupArtifact
} from '../services/backupRecovery'
import { formatLocalDateTime } from '../services/localTime'
import {
  getBackupPhysicalPackageStatus
} from '../services/packageDeletion'
import { rememberPathPreference } from '../services/pathPreference'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requestEmbeddedCliRelaunch } from '../runtime/embeddedCliState'
import { appendCliE2eEvent, shouldSuppressCliE2eRelaunch } from '../runtime/cliE2eEvents'
import { requireCommandAdmin, requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import { normalizePositiveInteger } from './payloadNormalizers'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

export const BACKUP_LAST_DIR_LEGACY_KEY = 'backup_last_dir'
export const BACKUP_CREATE_LAST_DIR_KEY = 'backup_create_last_dir'
export const BACKUP_IMPORT_LAST_DIR_KEY = 'backup_import_last_dir'
export const BACKUP_RESTORE_LAST_DIR_KEY = 'backup_restore_last_dir'

function getElectronicVoucherRootDir(context: CommandContext): string {
  return path.join(context.runtime.userDataPath, 'electronic-vouchers')
}

function readBackupManifest(manifestPath: string): BackupManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
}

function assertRestorePackageSupported(
  packageType: 'ledger_backup' | 'system_db_snapshot_legacy' | 'system_backup' | undefined,
  details: Record<string, unknown>
): void {
  if (packageType === 'ledger_backup') {
    throw new CommandError(
      'VALIDATION_ERROR',
      '账套备份不支持整库恢复，请改用 backup import 导入为新账套',
      details,
      2
    )
  }
}

export async function createBackupCommand(
  context: CommandContext,
  payload: {
    ledgerId: number
    period?: string | null
    directoryPath: string
    operationId?: string
  }
): Promise<
  CommandResult<{
    operationId: string
    backupId: number
    directoryPath: string
    period: string | null
    backupPath: string
    manifestPath: string
    checksum: string
    fileSize: number
  }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const ledgerId = normalizePositiveInteger(payload.ledgerId, 'ledgerId')
    if (!Number.isSafeInteger(ledgerId) || ledgerId <= 0) {
      throw new CommandError('VALIDATION_ERROR', 'ledgerId 必须为有效正整数', { field: 'ledgerId' }, 2)
    }
    requireCommandLedgerAccess(context.db, context.actor, ledgerId)
    const ledger = context.db
      .prepare('SELECT id, name FROM ledgers WHERE id = ?')
      .get(ledgerId) as { id: number; name: string } | undefined
    if (!ledger) {
      throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId }, 5)
    }

    const createdAtDate = context.now
    const backupPeriod = null
    const fiscalYear = null
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(context.db.name)
    const lifecycle = new FileOperationLifecycle(journal, context.db)
    let artifact: ReturnType<typeof createLedgerBackupArtifact>
    try {
      return lifecycle.execute(
        {
          operationId,
          kind: 'backup_create',
          actorId: actor.id,
          username: actor.username,
          ledgerId,
          requestHash: createHash('sha256')
            .update(JSON.stringify([ledgerId, path.resolve(payload.directoryPath)]))
            .digest('hex')
        },
        fileOperationArtifactRecovery,
        (lease) => {
          context.db.pragma('wal_checkpoint(TRUNCATE)')
          prepareFileOperationArtifact(
            journal,
            lease,
            operationId,
            payload.directoryPath,
            (staging, finalDirectory) => {
              const staged = createLedgerBackupArtifact({
                sourcePath: context.db.name,
                backupDir: staging,
                ledgerId,
                ledgerName: ledger.name,
                period: null,
                fiscalYear: null,
                now: createdAtDate
              })
              artifact = {
                ...staged,
                packageDir: path.join(finalDirectory, path.relative(staging, staged.packageDir)),
                backupPath: path.join(finalDirectory, path.relative(staging, staged.backupPath)),
                manifestPath: path.join(finalDirectory, path.relative(staging, staged.manifestPath))
              }
            }
          )
        },
        () => {
          context.actor = resolveSessionActor(context.db, actor.session, actor.source)
          requireCommandPermission(context.actor, 'ledger_settings')
          requireCommandLedgerAccess(context.db, context.actor, ledgerId)
          rememberPathPreference(context.db, BACKUP_CREATE_LAST_DIR_KEY, payload.directoryPath)
          const createdAt = formatLocalDateTime(createdAtDate)
          const backupId = createBackupPackageRecord(context.db, {
            ledgerId,
            backupPeriod,
            fiscalYear,
            packageType: 'ledger_backup',
            packageSchemaVersion: '2.1',
            backupPath: artifact.backupPath,
            manifestPath: artifact.manifestPath,
            checksum: artifact.checksum,
            fileSize: artifact.fileSize,
            createdBy: actor.id,
            createdAt
          })

          appendActorOperationLog(
            {
              ...context,
              actor
            },
            {
              ledgerId,
              module: 'backup',
              action: 'create',
              targetType: 'backup_package',
              targetId: backupId,
              details: {
                period: backupPeriod,
                fiscalYear,
                operationId,
                fileSize: artifact.fileSize,
                createdAt,
                backupMode: 'ledger_current_state_backup',
                packageType: 'ledger_backup'
              }
            }
          )

          return {
            operationId,
            backupId,
            directoryPath: payload.directoryPath,
            period: backupPeriod,
            backupPath: artifact.backupPath,
            manifestPath: artifact.manifestPath,
            checksum: artifact.checksum,
            fileSize: artifact.fileSize
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

export async function listBackupsCommand(
  context: CommandContext,
  payload: { ledgerId?: number } = {}
): Promise<CommandResult<ReturnType<typeof listBackupPackages>>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    if (typeof payload.ledgerId === 'number') {
      requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
      return listBackupPackages(context.db, {
        ledgerId: payload.ledgerId,
        userId: actor.id,
        isAdmin: actor.isAdmin
      })
    }

    return listBackupPackages(context.db, {
      userId: actor.id,
      isAdmin: actor.isAdmin
    })
  })
}

export async function validateBackupCommand(
  context: CommandContext,
  payload: { backupId: number }
): Promise<CommandResult<{ valid: boolean; actualChecksum: string | null; error?: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const row = getBackupPackageById(context.db, payload.backupId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '备份记录不存在', { backupId: payload.backupId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)

    const validation =
      row.package_type === 'ledger_backup'
        ? validateLedgerBackupArtifact(row.backup_path, row.manifest_path ?? '')
        : validateBackupArtifact(row.backup_path, row.checksum, row.manifest_path)
    updateBackupPackageValidation(context.db, payload.backupId, {
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
        module: 'backup',
        action: 'validate',
        targetType: 'backup_package',
        targetId: row.id,
        details: {
          ...validation,
          manifestPath: row.manifest_path,
          packageType: row.package_type
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

export async function importBackupCommand(
  context: CommandContext,
  payload: { backupId?: number; packagePath?: string; operationId?: string }
): Promise<CommandResult<{ operationId: string; importedLedgerId: number; importedLedgerName: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    let backupPath = ''
    let manifestPath = ''
    let sourceBackupId: number | null = null
    let sourceLedgerId: number | null = null

    if (typeof payload.backupId === 'number') {
      const row = getBackupPackageById(context.db, payload.backupId)
      if (!row) {
        throw new CommandError('NOT_FOUND', '备份记录不存在', { backupId: payload.backupId }, 5)
      }
      requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
      if (row.package_type !== 'ledger_backup') {
        throw new CommandError('VALIDATION_ERROR', '历史整库备份不支持导入为新账套', null, 2)
      }
      backupPath = row.backup_path
      manifestPath = row.manifest_path ?? ''
      sourceBackupId = row.id
      sourceLedgerId = row.ledger_id
    } else {
      const packagePath = payload.packagePath?.trim()
      if (!packagePath) {
        throw new CommandError('VALIDATION_ERROR', '请提供账套备份目录路径', null, 2)
      }
      rememberPathPreference(context.db, BACKUP_IMPORT_LAST_DIR_KEY, path.dirname(packagePath))
      const resolved = resolveBackupArtifactPaths(packagePath)
      backupPath = resolved.backupPath
      manifestPath = resolved.manifestPath
    }

    const expectedManifestDigest = createHash('sha256')
      .update(JSON.stringify(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))).digest('hex')
    const targetPath = context.db.name
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(targetPath)
    try {
      return new FileOperationLifecycle(journal, context.db).executeReplacement<{
        operationId: string
        importedLedgerId: number
        importedLedgerName: string
      }>(
        {
          operationId,
          kind: 'backup_import',
          actorId: actor.id,
          username: actor.username,
          ledgerId: sourceLedgerId,
          requestHash: createHash('sha256')
            .update(
              JSON.stringify([
                targetPath,
                expectedManifestDigest,
                computeFileSha256(backupPath)
              ])
            )
            .digest('hex')
        },
        fileOperationDatabaseRecovery,
        (commitCandidate, lease) => {
          withDatabaseReplacementLock(targetPath, () => {
            journal.saveRecoveryPlan(lease, operationId, { targetPath })
            context.actor = resolveSessionActor(context.db, actor.session, actor.source)
            requireCommandPermission(context.actor, 'ledger_settings')
            if (sourceLedgerId !== null)
              requireCommandLedgerAccess(context.db, context.actor, sourceLedgerId)
            context.db.pragma('wal_checkpoint(TRUNCATE)')
            let closed = false
            try {
              importLedgerBackupArtifact({
                expectedManifestDigest,
                operationId,
                backupPath,
                manifestPath,
                targetPath,
                attachmentRootDir: getElectronicVoucherRootDir(context),
                operatorUserId: actor.id,
                operatorIsAdmin: context.actor!.isAdmin,
                preparedAssets(staging, assetPath) {
                  journal.saveRecoveryPlan(lease, operationId, {
                    targetPath,
                    assetPath,
                    assetDigest: treeDigest(staging)
                  })
                },
                beforeSwitch() {
                  closeDatabase()
                  closed = true
                },
                appendImportLog(db, imported) {
                  if (payload.packagePath) rememberPathPreference(db, BACKUP_IMPORT_LAST_DIR_KEY, path.dirname(payload.packagePath))
                  appendActorOperationLog(
                    { ...context, db, actor },
                    {
                      ledgerId: imported.importedLedgerId,
                      module: 'backup',
                      action: 'import',
                      targetType: 'ledger',
                      targetId: imported.importedLedgerId,
                      details: {
                        operationId,
                        sourceBackupId,
                        sourceLedgerId,
                        packageType: 'ledger_backup'
                      }
                    }
                  )
                  commitCandidate(db, { ...imported, operationId })
                }
              })
            } finally {
              if (closed) {
                initializeDatabase()
                context.db = getDatabase()
              }
            }
          })
        },
        () => {
          if (!context.db.open) {
            initializeDatabase()
            context.db = getDatabase()
          }
          return context.db
        }
      )
    } catch (error) {
      throw fileOperationCommandError(error, operationId, journal)
    } finally {
      journal.close()
    }
  })
}

export async function deleteBackupCommand(
  context: CommandContext,
  payload: { backupId: number; deleteRecordOnly?: boolean; operationId?: string }
): Promise<CommandResult<{ operationId: string; deletedPhysicalPackage: boolean; deletedPaths: string[]; packagePath?: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(context.db.name)
    try {
      const row = getBackupPackageById(context.db, payload.backupId)
      const prior = journal.getRecoveryRecord(operationId)
      const ledgerId = row?.ledger_id ?? prior?.ledgerId
      if (ledgerId !== null && ledgerId !== undefined) requireCommandLedgerAccess(context.db, context.actor, ledgerId)
      let targets: string[] = []
      let packagePath = ''
      const validate = (): void => {
        if (!row) throw new CommandError('NOT_FOUND', '备份记录不存在', null, 5)
        assertHistoricalVersionDeletable(row.id, listBackupPackageIdsByLedger(context.db, row.ledger_id), '备份')
      }
      return new FileOperationLifecycle(journal, context.db).execute(
        { operationId, kind: 'backup_delete', actorId: actor.id, username: actor.username,
          ledgerId: ledgerId ?? null, requestHash: createHash('sha256').update(JSON.stringify([payload.backupId, Boolean(payload.deleteRecordOnly)])).digest('hex') },
        fileOperationDeletionRecovery,
        lease => {
          validate()
          if (!row) throw new Error('备份记录不存在')
          const physicalStatus = getBackupPhysicalPackageStatus({ backupPath: row.backup_path, manifestPath: row.manifest_path, protectedDir: path.dirname(context.db.name) })
          packagePath = physicalStatus.packagePath
          if (payload.deleteRecordOnly && physicalStatus.physicalExists)
            throw new CommandError('VALIDATION_ERROR', '实体包仍存在，请执行正常删除', null, 2)
          if (!payload.deleteRecordOnly && !physicalStatus.physicalExists)
            throw new CommandError('RISK_CONFIRMATION_REQUIRED', '实体包已不存在，请显式传入 deleteRecordOnly=true', { packagePath, missingPhysicalPackage: true }, 2)
          targets = payload.deleteRecordOnly ? [] : path.resolve(physicalStatus.packagePath) === path.dirname(context.db.name)
        ? [row.backup_path, row.manifest_path].filter((value): value is string => Boolean(value && fs.existsSync(value)))
        : [physicalStatus.packagePath]
          const parent = targets.length ? path.dirname(targets[0]) : path.dirname(context.db.name)
          prepareFileOperationDeletion(journal, lease, operationId, targets, parent)
        },
        () => {
          context.actor = resolveSessionActor(context.db, actor.session, actor.source)
          requireCommandPermission(context.actor, 'ledger_settings')
          if (ledgerId !== null && ledgerId !== undefined) requireCommandLedgerAccess(context.db, context.actor, ledgerId)
          validate()
          deleteBackupPackageRecord(context.db, payload.backupId)
          appendActorOperationLog(context, { ledgerId: ledgerId ?? null, module: 'backup', action: 'delete',
            targetType: 'backup_package', targetId: payload.backupId,
            details: { operationId, deleteMode: payload.deleteRecordOnly ? 'record_only' : 'record_and_package' } })
          return { operationId, deletedPhysicalPackage: targets.length > 0, deletedPaths: targets, packagePath }
        }
      )
    } catch (error) { throw fileOperationCommandError(error, operationId, journal) }
    finally { journal.close() }
  })
}

export async function restoreBackupCommand(
  context: CommandContext,
  payload: { backupId?: number; packagePath?: string; operationId?: string }
): Promise<CommandResult<{ operationId: string; restartRequired: true; backupPath: string }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandAdmin(context.actor)

    let backupPath = ''
    let manifestPath: string | null = null
    let expectedChecksum = ''
    let ledgerId: number | null = null

    if (typeof payload.backupId === 'number') {
      const row = getBackupPackageById(context.db, payload.backupId)
      if (!row) {
        throw new CommandError('NOT_FOUND', '备份记录不存在', { backupId: payload.backupId }, 5)
      }
      requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
      assertRestorePackageSupported(row.package_type, {
        backupId: payload.backupId,
        packageType: row.package_type
      })
      backupPath = row.backup_path
      manifestPath = row.manifest_path
      expectedChecksum = row.checksum
      ledgerId = row.ledger_id
    } else {
      const packagePath = payload.packagePath?.trim()
      if (!packagePath) {
        throw new CommandError('VALIDATION_ERROR', '请提供整库备份包目录路径', null, 2)
      }
      rememberPathPreference(context.db, BACKUP_RESTORE_LAST_DIR_KEY, path.dirname(packagePath))
      const resolved = resolveBackupArtifactPaths(packagePath)
      const manifest = readBackupManifest(resolved.manifestPath)
      assertRestorePackageSupported(manifest.packageType, {
        packagePath,
        packageType: manifest.packageType ?? null
      })
      backupPath = resolved.backupPath
      manifestPath = resolved.manifestPath
      expectedChecksum = manifest.checksum
      ledgerId = manifest.ledgerId ?? null
    }

    const validation = validateBackupArtifact(backupPath, expectedChecksum, manifestPath)
    if (!validation.valid) {
      throw new CommandError(
        'VALIDATION_ERROR',
        validation.error ?? '备份文件校验失败',
        { backupPath, manifestPath },
        2
      )
    }

    const targetPath = context.db.name
    const operationId = requireOperationId(payload.operationId)
    const journal = new FileOperationJournal(targetPath)
    try {
      const result = new FileOperationLifecycle(journal, context.db).executeReplacement<{ operationId: string; restartRequired: true; backupPath: string }>(
        {
          operationId,
          kind: 'backup_restore',
          actorId: actor.id,
          username: actor.username,
          ledgerId,
          requestHash: createHash('sha256')
            .update(JSON.stringify([expectedChecksum, targetPath]))
            .digest('hex')
        },
        fileOperationDatabaseRecovery,
        (commitCandidate, lease) => {
          withDatabaseReplacementLock(targetPath, () => {
            journal.saveRecoveryPlan(lease, operationId, { targetPath })
            context.actor = resolveSessionActor(context.db, actor.session, actor.source)
            requireCommandAdmin(context.actor)
            appendCliE2eEvent('backup.restore.requested', {
              backupPath,
              manifestPath,
              ledgerId,
              backupId: payload.backupId ?? null,
              packagePath: payload.packagePath ?? null
            })
            closeDatabase()
            try {
              restoreBackupArtifact({
                backupPath,
                manifestPath,
                expectedChecksum,
                targetPath,
                  commitCandidate(candidate) {
                    if (payload.packagePath) rememberPathPreference(candidate, BACKUP_RESTORE_LAST_DIR_KEY, path.dirname(payload.packagePath))
                  appendActorOperationLog(
                    { ...context, db: candidate, actor },
                    {
                      ledgerId,
                      module: 'backup',
                      action: 'restore',
                      targetType: 'file_operation',
                      targetId: operationId,
                      details: { operationId, backupMode: 'system_db_snapshot' }
                    }
                  )
                  commitCandidate(candidate, {
                    restartRequired: true as const,
                    backupPath,
                    operationId
                  })
                }
              })
            } finally {
              initializeDatabase()
              context.db = getDatabase()
            }
          })
        },
        () => {
          initializeDatabase()
          context.db = getDatabase()
          return context.db
        }
      )
      appendCliE2eEvent('backup.restore.relaunch-requested', {
        backupPath,
        manifestPath
      })
      if (!shouldSuppressCliE2eRelaunch()) {
        requestEmbeddedCliRelaunch()
      }
      return result
    } catch (error) {
      throw fileOperationCommandError(error, operationId, journal)
    } finally {
      journal.close()
    }
  })
}

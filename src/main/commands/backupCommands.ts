import fs from 'node:fs'
import path from 'node:path'
import { closeDatabase, getDatabasePath, initializeDatabase } from '../database/init'
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
  deleteBackupPhysicalPackage,
  getBackupPhysicalPackageStatus
} from '../services/packageDeletion'
import { rememberPathPreference } from '../services/pathPreference'
import {
  clearPendingRestoreLog,
  getPendingRestoreLogPath,
  writePendingRestoreLog
} from '../services/pendingRestoreLog'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requestEmbeddedCliRelaunch } from '../runtime/embeddedCliState'
import { requireCommandAdmin, requireCommandLedgerAccess, requireCommandPermission } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

const BACKUP_LAST_DIR_KEY = 'backup_last_dir'

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
      '账套级备份包不支持整库恢复，请改用 backup import 导入为新账套',
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
  }
): Promise<
  CommandResult<{
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
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const ledger = context.db
      .prepare('SELECT id, name FROM ledgers WHERE id = ?')
      .get(payload.ledgerId) as { id: number; name: string } | undefined
    if (!ledger) {
      throw new CommandError('NOT_FOUND', '账套不存在', { ledgerId: payload.ledgerId }, 5)
    }

    rememberPathPreference(context.db, BACKUP_LAST_DIR_KEY, payload.directoryPath)
    context.db.pragma('wal_checkpoint(TRUNCATE)')
    const createdAtDate = context.now
    const backupPeriod = payload.period?.trim() || null
    const fiscalYear = backupPeriod ? backupPeriod.slice(0, 4) : null
    const artifact = createLedgerBackupArtifact({
      sourcePath: getDatabasePath(),
      backupDir: payload.directoryPath,
      ledgerId: payload.ledgerId,
      ledgerName: ledger.name,
      period: backupPeriod,
      fiscalYear,
      now: createdAtDate
    })
    const createdAt = formatLocalDateTime(createdAtDate)
    const backupId = createBackupPackageRecord(context.db, {
      ledgerId: payload.ledgerId,
      backupPeriod,
      fiscalYear,
      packageType: 'ledger_backup',
      packageSchemaVersion: '2.0',
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
        ledgerId: payload.ledgerId,
        module: 'backup',
        action: 'create',
        targetType: 'backup_package',
        targetId: backupId,
        details: {
          period: backupPeriod,
          fiscalYear,
          selectedDirectory: payload.directoryPath,
          packageDir: artifact.packageDir,
          backupPath: artifact.backupPath,
          manifestPath: artifact.manifestPath,
          fileSize: artifact.fileSize,
          createdAt,
          backupMode: 'ledger_backup_package',
          packageType: 'ledger_backup'
        }
      }
    )

    return {
      backupId,
      directoryPath: payload.directoryPath,
      period: backupPeriod,
      backupPath: artifact.backupPath,
      manifestPath: artifact.manifestPath,
      checksum: artifact.checksum,
      fileSize: artifact.fileSize
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
  payload: { backupId?: number; packagePath?: string }
): Promise<CommandResult<{ importedLedgerId: number; importedLedgerName: string }>> {
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
        throw new CommandError('VALIDATION_ERROR', '历史整库快照不支持导入为新账套', null, 2)
      }
      backupPath = row.backup_path
      manifestPath = row.manifest_path ?? ''
      sourceBackupId = row.id
      sourceLedgerId = row.ledger_id
    } else {
      const packagePath = payload.packagePath?.trim()
      if (!packagePath) {
        throw new CommandError('VALIDATION_ERROR', '请提供账套备份包目录路径', null, 2)
      }
      rememberPathPreference(context.db, BACKUP_LAST_DIR_KEY, path.dirname(packagePath))
      const resolved = resolveBackupArtifactPaths(packagePath)
      backupPath = resolved.backupPath
      manifestPath = resolved.manifestPath
    }

    context.db.pragma('wal_checkpoint(TRUNCATE)')
    const imported = importLedgerBackupArtifact({
      backupPath,
      manifestPath,
      targetPath: getDatabasePath(),
      attachmentRootDir: getElectronicVoucherRootDir(context),
      operatorUserId: actor.id,
      operatorIsAdmin: actor.isAdmin
    })

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: imported.importedLedgerId,
        module: 'backup',
        action: 'import',
        targetType: 'ledger',
        targetId: imported.importedLedgerId,
        details: {
          sourceBackupId,
          sourceLedgerId,
          sourcePackagePath: backupPath,
          manifestPath,
          packageType: 'ledger_backup',
          importedLedgerName: imported.importedLedgerName
        }
      }
    )

    return imported
  })
}

export async function deleteBackupCommand(
  context: CommandContext,
  payload: { backupId: number; deleteRecordOnly?: boolean }
): Promise<
  CommandResult<{ deletedPhysicalPackage: boolean; deletedPaths: string[]; packagePath?: string }>
> {
  return withCommandResult(context, () => {
    const actor = requireCommandPermission(context.actor, 'ledger_settings')
    const row = getBackupPackageById(context.db, payload.backupId)
    if (!row) {
      throw new CommandError('NOT_FOUND', '备份记录不存在', { backupId: payload.backupId }, 5)
    }
    requireCommandLedgerAccess(context.db, context.actor, row.ledger_id)
    assertHistoricalVersionDeletable(
      row.id,
      listBackupPackageIdsByLedger(context.db, row.ledger_id),
      '备份'
    )
    const physicalStatus = getBackupPhysicalPackageStatus({
      backupPath: row.backup_path,
      manifestPath: row.manifest_path,
      protectedDir: path.dirname(getDatabasePath())
    })

    if (payload.deleteRecordOnly && physicalStatus.physicalExists) {
      throw new CommandError(
        'VALIDATION_ERROR',
        '路径下备份包仍存在，请执行正常删除以同时删除实体包。',
        null,
        2
      )
    }

    const deletionResult = payload.deleteRecordOnly
      ? {
          physicalExists: false,
          deletedPaths: [],
          packagePath: physicalStatus.packagePath
        }
      : deleteBackupPhysicalPackage({
          backupPath: row.backup_path,
          manifestPath: row.manifest_path,
          protectedDir: path.dirname(getDatabasePath())
        })

    if (!payload.deleteRecordOnly && !deletionResult.physicalExists) {
      throw new CommandError(
        'RISK_CONFIRMATION_REQUIRED',
        '路径下备份包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
        {
          packagePath: deletionResult.packagePath,
          missingPhysicalPackage: true
        },
        2
      )
    }

    deleteBackupPackageRecord(context.db, payload.backupId)
    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: row.ledger_id,
        module: 'backup',
        action: 'delete',
        targetType: 'backup_package',
        targetId: row.id,
        details: {
          period: row.backup_period,
          backupPath: row.backup_path,
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

export async function restoreBackupCommand(
  context: CommandContext,
  payload: { backupId?: number; packagePath?: string }
): Promise<CommandResult<{ restartRequired: true; backupPath: string }>> {
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
        throw new CommandError('VALIDATION_ERROR', '请提供备份包目录路径', null, 2)
      }
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

    const pendingRestoreLogPath = getPendingRestoreLogPath(context.runtime.userDataPath)
    let databaseClosed = false
    try {
      writePendingRestoreLog(pendingRestoreLogPath, {
        userId: actor.id,
        username: actor.username,
        ledgerId,
        targetType: typeof payload.backupId === 'number' ? 'backup_package' : 'backup_package_path',
        targetId:
          typeof payload.backupId === 'number' ? payload.backupId : (payload.packagePath ?? null),
        backupPath,
        manifestPath,
        backupMode: 'system_db_snapshot'
      })

      closeDatabase()
      databaseClosed = true
      restoreBackupArtifact({
        backupPath,
        targetPath: getDatabasePath()
      })
      requestEmbeddedCliRelaunch()
      return {
        restartRequired: true as const,
        backupPath
      }
    } catch (error) {
      clearPendingRestoreLog(pendingRestoreLogPath)
      if (databaseClosed) {
        initializeDatabase()
      }
      throw error
    }

    throw new CommandError(
      'NOT_IMPLEMENTED',
      'CLI 恢复整库备份需要在嵌入 Electron 模式下执行重启流程，当前先保留为安装版能力。',
      {
        backupPath,
        manifestPath
      },
      2
    )
  })
}

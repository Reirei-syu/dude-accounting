import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { closeDatabase, getDatabase, getDatabasePath, initializeDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
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
import { getPathPreference, rememberPathPreference } from '../services/pathPreference'
import {
  clearPendingRestoreLog,
  getPendingRestoreLogPath,
  writePendingRestoreLog
} from '../services/pendingRestoreLog'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { assertHistoricalVersionDeletable } from '../services/versionRetention'
import { requireAdmin, requireLedgerAccess, requirePermission } from './session'

const BACKUP_LAST_DIR_KEY = 'backup_last_dir'

function getElectronicVoucherRootDir(): string {
  return path.join(app.getPath('userData'), 'electronic-vouchers')
}

function getDefaultBackupRootDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '系统备份')
}

async function pickDirectory(
  sender: Electron.WebContents,
  options: {
    defaultPath: string
    title: string
    createDirectory?: boolean
  }
): Promise<{ cancelled: boolean; directoryPath?: string }> {
  const browserWindow = BrowserWindow.fromWebContents(sender)
  const openOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    properties: options.createDirectory
      ? (['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>)
      : (['openDirectory'] as Array<'openDirectory'>)
  }
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, openOptions)
    : await dialog.showOpenDialog(openOptions)

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true }
  }

  return {
    cancelled: false,
    directoryPath: result.filePaths[0]
  }
}

function readBackupManifest(manifestPath: string): BackupManifest {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
}

export function registerBackupHandlers(): void {
  ipcMain.handle(
    'backup:create',
    async (
      event,
      payload: {
        ledgerId: number
        period?: string | null
        directoryPath?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'backup:create',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId,
            period: payload.period ?? null,
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
              getPathPreference(db, BACKUP_LAST_DIR_KEY) ?? getDefaultBackupRootDir()
            const backupPeriod = payload.period?.trim() || null
            const fiscalYear = backupPeriod ? backupPeriod.slice(0, 4) : null
            const picked = payload.directoryPath
              ? { cancelled: false, directoryPath: payload.directoryPath }
              : await pickDirectory(event.sender, {
                  defaultPath: preferredDir,
                  title: '选择备份保存目录',
                  createDirectory: true
                })

            if (picked.cancelled || !picked.directoryPath) {
              return { success: false, cancelled: true }
            }

            rememberPathPreference(db, BACKUP_LAST_DIR_KEY, picked.directoryPath)
            db.pragma('wal_checkpoint(TRUNCATE)')
            const createdAtDate = new Date()

            const artifact = createLedgerBackupArtifact({
              sourcePath: getDatabasePath(),
              backupDir: picked.directoryPath,
              ledgerId: payload.ledgerId,
              ledgerName: ledger.name,
              period: backupPeriod,
              fiscalYear,
              now: createdAtDate
            })
            const createdAt = formatLocalDateTime(createdAtDate)

            const backupId = createBackupPackageRecord(db, {
              ledgerId: payload.ledgerId,
              backupPeriod,
              fiscalYear,
              packageType: 'ledger_backup',
              packageSchemaVersion: '2.0',
              backupPath: artifact.backupPath,
              manifestPath: artifact.manifestPath,
              checksum: artifact.checksum,
              fileSize: artifact.fileSize,
              createdBy: user.id,
              createdAt
            })

            appendOperationLog(db, {
              ledgerId: payload.ledgerId,
              userId: user.id,
              username: user.username,
              module: 'backup',
              action: 'create',
              targetType: 'backup_package',
              targetId: backupId,
              details: {
                period: backupPeriod,
                fiscalYear,
                selectedDirectory: picked.directoryPath,
                packageDir: artifact.packageDir,
                backupPath: artifact.backupPath,
                manifestPath: artifact.manifestPath,
                fileSize: artifact.fileSize,
                createdAt,
                backupMode: 'ledger_backup_package',
                packageType: 'ledger_backup'
              }
            })

            return {
              success: true,
              backupId,
              directoryPath: picked.directoryPath,
              period: backupPeriod,
              backupPath: artifact.backupPath,
              manifestPath: artifact.manifestPath,
              checksum: artifact.checksum,
              fileSize: artifact.fileSize
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '创建备份失败'
            }
          }
        }
      )
  )

  ipcMain.handle('backup:list', (event, ledgerId?: number) =>
    withIpcTelemetry(
      {
        channel: 'backup:list',
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
          return listBackupPackages(db, {
            ledgerId,
            userId: user.id,
            isAdmin: user.isAdmin
          })
        }

        return listBackupPackages(db, {
          userId: user.id,
          isAdmin: user.isAdmin
        })
      }
    )
  )

  ipcMain.handle('backup:validate', (event, backupId: number) =>
    withIpcTelemetry(
      {
        channel: 'backup:validate',
        baseDir: app.getPath('userData'),
        context: { backupId }
      },
      () => {
        try {
          const user = requirePermission(event, 'ledger_settings')
          const db = getDatabase()
          const row = getBackupPackageById(db, backupId)

          if (!row) {
            return { success: false, error: '备份记录不存在' }
          }
          requireLedgerAccess(event, db, row.ledger_id)

          const validation =
            row.package_type === 'ledger_backup'
              ? validateLedgerBackupArtifact(row.backup_path, row.manifest_path ?? '')
              : validateBackupArtifact(row.backup_path, row.checksum, row.manifest_path)
          updateBackupPackageValidation(db, backupId, {
            valid: validation.valid,
            validatedAt: validation.valid ? formatLocalDateTime() : null
          })

          appendOperationLog(db, {
            ledgerId: row.ledger_id,
            userId: user.id,
            username: user.username,
            module: 'backup',
            action: 'validate',
            targetType: 'backup_package',
            targetId: row.id,
            details: {
              ...validation,
              manifestPath: row.manifest_path,
              packageType: row.package_type
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
            error: error instanceof Error ? error.message : '校验备份失败'
          }
        }
      }
    )
  )

  ipcMain.handle(
    'backup:import',
    async (
      event,
      payload?: {
        backupId?: number
        packagePath?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'backup:import',
          baseDir: app.getPath('userData'),
          context: {
            backupId: payload?.backupId ?? null,
            hasPackagePath: Boolean(payload?.packagePath)
          }
        },
        async () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            const db = getDatabase()
            const preferredDir =
              getPathPreference(db, BACKUP_LAST_DIR_KEY) ?? getDefaultBackupRootDir()

            let backupPath = ''
            let manifestPath = ''
            let sourceBackupId: number | null = null
            let sourceLedgerId: number | null = null

            if (typeof payload?.backupId === 'number') {
              const row = getBackupPackageById(db, payload.backupId)

              if (!row) {
                return { success: false, error: '备份记录不存在' }
              }

              requireLedgerAccess(event, db, row.ledger_id)
              if (row.package_type !== 'ledger_backup') {
                return { success: false, error: '历史整库快照不支持导入为新账套' }
              }

              backupPath = row.backup_path
              manifestPath = row.manifest_path ?? ''
              sourceBackupId = row.id
              sourceLedgerId = row.ledger_id
            } else {
              const picked = payload?.packagePath
                ? { cancelled: false, directoryPath: payload.packagePath }
                : await pickDirectory(event.sender, {
                    defaultPath: preferredDir,
                    title: '选择需要导入的账套备份包目录'
                  })

              if (picked.cancelled || !picked.directoryPath) {
                return { success: false, cancelled: true }
              }

              rememberPathPreference(db, BACKUP_LAST_DIR_KEY, path.dirname(picked.directoryPath))
              const resolved = resolveBackupArtifactPaths(picked.directoryPath)
              backupPath = resolved.backupPath
              manifestPath = resolved.manifestPath
            }

            db.pragma('wal_checkpoint(TRUNCATE)')

            const imported = importLedgerBackupArtifact({
              backupPath,
              manifestPath,
              targetPath: getDatabasePath(),
              attachmentRootDir: getElectronicVoucherRootDir(),
              operatorUserId: user.id,
              operatorIsAdmin: user.isAdmin
            })

            appendOperationLog(db, {
              ledgerId: imported.importedLedgerId,
              userId: user.id,
              username: user.username,
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
            })

            return {
              success: true,
              importedLedgerId: imported.importedLedgerId,
              importedLedgerName: imported.importedLedgerName
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '导入账套备份失败'
            }
          }
        }
      )
  )

  ipcMain.handle(
    'backup:delete',
    (
      event,
      payload: {
        backupId: number
        deleteRecordOnly?: boolean
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'backup:delete',
          baseDir: app.getPath('userData'),
          context: {
            backupId: payload.backupId,
            deleteRecordOnly: payload.deleteRecordOnly === true
          }
        },
        () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            const db = getDatabase()
            const row = getBackupPackageById(db, payload.backupId)

            if (!row) {
              return { success: false, error: '备份记录不存在' }
            }

            requireLedgerAccess(event, db, row.ledger_id)

            assertHistoricalVersionDeletable(
              row.id,
              listBackupPackageIdsByLedger(db, row.ledger_id),
              '备份'
            )

            const physicalStatus = getBackupPhysicalPackageStatus({
              backupPath: row.backup_path,
              manifestPath: row.manifest_path,
              protectedDir: path.dirname(getDatabasePath())
            })

            if (payload.deleteRecordOnly && physicalStatus.physicalExists) {
              return {
                success: false,
                error: '路径下备份包仍存在，请执行正常删除以同时删除实体包。'
              }
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
              return {
                success: false,
                missingPhysicalPackage: true,
                requiresRecordDeletionConfirmation: true,
                packagePath: deletionResult.packagePath,
                error: '路径下备份包已不存在，是否删除本条记录？'
              }
            }

            deleteBackupPackageRecord(db, payload.backupId)

            appendOperationLog(db, {
              ledgerId: row.ledger_id,
              userId: user.id,
              username: user.username,
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
            })

            return {
              success: true,
              deletedPhysicalPackage: deletionResult.physicalExists,
              deletedPaths: deletionResult.deletedPaths
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '删除备份失败'
            }
          }
        }
      )
  )

  ipcMain.handle(
    'backup:restore',
    async (
      event,
      payload?: {
        backupId?: number
        packagePath?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'backup:restore',
          baseDir: app.getPath('userData'),
          context: {
            backupId: payload?.backupId ?? null,
            hasPackagePath: Boolean(payload?.packagePath)
          }
        },
        async () => {
          let databaseClosed = false
          let pendingRestoreLogPath: string | null = null
          let restoreLogContext: {
            ledgerId: number | null
            targetType: string
            targetId: string | number | null
            backupPath: string
            manifestPath: string | null
            userId: number
            username: string
          } | null = null

          try {
            const user = requireAdmin(event)
            const db = getDatabase()
            const preferredDir =
              getPathPreference(db, BACKUP_LAST_DIR_KEY) ?? getDefaultBackupRootDir()

            let backupPath = ''
            let manifestPath: string | null = null
            let ledgerId: number | null = null
            let targetType = 'backup_package'
            let targetId: string | number | null = payload?.backupId ?? null
            let expectedChecksum = ''

            if (typeof payload?.backupId === 'number') {
              const row = getBackupPackageById(db, payload.backupId)

              if (!row) {
                return { success: false, error: '备份记录不存在' }
              }

              requireLedgerAccess(event, db, row.ledger_id)
              backupPath = row.backup_path
              manifestPath = row.manifest_path
              ledgerId = row.ledger_id
              expectedChecksum = row.checksum
            } else {
              const picked = payload?.packagePath
                ? { cancelled: false, directoryPath: payload.packagePath }
                : await pickDirectory(event.sender, {
                    defaultPath: preferredDir,
                    title: '选择需要恢复的备份包目录'
                  })

              if (picked.cancelled || !picked.directoryPath) {
                return { success: false, cancelled: true }
              }

              rememberPathPreference(db, BACKUP_LAST_DIR_KEY, path.dirname(picked.directoryPath))
              const resolved = resolveBackupArtifactPaths(picked.directoryPath)
              const manifest = readBackupManifest(resolved.manifestPath)

              backupPath = resolved.backupPath
              manifestPath = resolved.manifestPath
              ledgerId = manifest.ledgerId ?? null
              expectedChecksum = manifest.checksum
              targetType = 'backup_package_path'
              targetId = picked.directoryPath
            }

            const validation = validateBackupArtifact(backupPath, expectedChecksum, manifestPath)
            if (!validation.valid) {
              return { success: false, error: validation.error ?? '备份文件校验失败' }
            }

            restoreLogContext = {
              ledgerId,
              targetType,
              targetId,
              backupPath,
              manifestPath,
              userId: user.id,
              username: user.username
            }

            pendingRestoreLogPath = getPendingRestoreLogPath(app.getPath('userData'))
            writePendingRestoreLog(pendingRestoreLogPath, {
              userId: restoreLogContext.userId,
              username: restoreLogContext.username,
              ledgerId: restoreLogContext.ledgerId,
              targetType: restoreLogContext.targetType,
              targetId: restoreLogContext.targetId,
              backupPath: restoreLogContext.backupPath,
              manifestPath: restoreLogContext.manifestPath,
              backupMode: 'system_db_snapshot'
            })

            closeDatabase()
            databaseClosed = true

            restoreBackupArtifact({
              backupPath,
              targetPath: getDatabasePath()
            })
            app.relaunch()
            app.exit(0)

            return {
              success: true,
              restartRequired: true
            }
          } catch (error) {
            if (pendingRestoreLogPath) {
              clearPendingRestoreLog(pendingRestoreLogPath)
            }

            if (databaseClosed) {
              initializeDatabase()
              databaseClosed = false
            }

            if (restoreLogContext) {
              appendOperationLog(getDatabase(), {
                ledgerId: restoreLogContext.ledgerId,
                userId: restoreLogContext.userId,
                username: restoreLogContext.username,
                module: 'backup',
                action: 'restore_failed',
                targetType: restoreLogContext.targetType,
                targetId: restoreLogContext.targetId,
                details: {
                  backupPath: restoreLogContext.backupPath,
                  manifestPath: restoreLogContext.manifestPath,
                  backupMode: 'system_db_snapshot',
                  error: error instanceof Error ? error.message : '恢复备份失败'
                }
              })
            }

            return {
              success: false,
              error: error instanceof Error ? error.message : '恢复备份失败'
            }
          }
        }
      )
  )
}

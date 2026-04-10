import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { closeDatabase, getDatabase, getDatabasePath, initializeDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import { getBackupPackageById } from '../services/backupCatalog'
import {
  createBackupCommand,
  deleteBackupCommand,
  importBackupCommand,
  listBackupsCommand,
  validateBackupCommand
} from '../commands/backupCommands'
import {
  resolveBackupArtifactPaths,
  restoreBackupArtifact,
  validateBackupArtifact
} from '../services/backupRecovery'
import { getPathPreference, rememberPathPreference } from '../services/pathPreference'
import {
  clearPendingRestoreLog,
  getPendingRestoreLogPath,
  writePendingRestoreLog
} from '../services/pendingRestoreLog'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import { requireAdmin, requireLedgerAccess } from './session'

const BACKUP_LAST_DIR_KEY = 'backup_last_dir'

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

function buildUnsupportedLedgerRestoreResponse(details: Record<string, unknown>): {
  success: false
  error: string
  errorCode: 'VALIDATION_ERROR'
  errorDetails: Record<string, unknown>
} {
  return {
    success: false,
    error: '账套级备份包不支持整库恢复，请改用 backup import 导入为新账套',
    errorCode: 'VALIDATION_ERROR',
    errorDetails: details
  }
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
            const result = await createBackupCommand(createCommandContextFromEvent(event), {
              ledgerId: payload.ledgerId,
              period: backupPeriod,
              directoryPath: picked.directoryPath
            })
            if (!isCommandSuccess(result)) {
              return {
                success: false,
                error: result.error?.message ?? '创建备份失败'
              }
            }

            return {
              success: true,
              ...result.data
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
      async () => {
        const db = getDatabase()

        if (typeof ledgerId === 'number') {
          requireLedgerAccess(event, db, ledgerId)
        }

        const result = await listBackupsCommand(createCommandContextFromEvent(event), {
          ledgerId
        })
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取备份列表失败')
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
      async () => {
        try {
          const result = await validateBackupCommand(createCommandContextFromEvent(event), {
            backupId
          })
          return isCommandSuccess(result)
            ? {
                success: result.data.valid,
                valid: result.data.valid,
                actualChecksum: result.data.actualChecksum,
                error: result.data.error
              }
            : {
                success: false,
                error: result.error?.message ?? '校验备份失败'
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
            const db = getDatabase()
            const preferredDir =
              getPathPreference(db, BACKUP_LAST_DIR_KEY) ?? getDefaultBackupRootDir()

            if (typeof payload?.backupId === 'number') {
              const row = getDatabase()
                .prepare(
                  'SELECT id, ledger_id, package_type, backup_path, manifest_path FROM backup_packages WHERE id = ?'
                )
                .get(payload.backupId) as
                | {
                    id: number
                    ledger_id: number
                    package_type: string
                    backup_path: string
                    manifest_path: string | null
                  }
                | undefined

              if (!row) {
                return { success: false, error: '备份记录不存在' }
              }

              requireLedgerAccess(event, db, row.ledger_id)
              if (row.package_type !== 'ledger_backup') {
                return { success: false, error: '历史整库快照不支持导入为新账套' }
              }
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
              resolveBackupArtifactPaths(picked.directoryPath)
            }

            const result = await importBackupCommand(createCommandContextFromEvent(event), {
              backupId: payload?.backupId,
              packagePath: payload?.backupId ? undefined : payload?.packagePath
            })
            if (!isCommandSuccess(result)) {
              return {
                success: false,
                error: result.error?.message ?? '导入账套备份失败'
              }
            }

            return {
              success: true,
              importedLedgerId: result.data.importedLedgerId,
              importedLedgerName: result.data.importedLedgerName
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
        async () => {
          const result = await deleteBackupCommand(createCommandContextFromEvent(event), payload)
          return isCommandSuccess(result)
            ? {
                success: true,
                deletedPhysicalPackage: result.data.deletedPhysicalPackage,
                deletedPaths: result.data.deletedPaths
              }
            : {
                success: false,
                error: result.error?.message ?? '删除备份失败',
                errorCode: result.error?.code ?? 'INTERNAL_ERROR',
                errorDetails: result.error?.details ?? null,
                requiresRecordDeletionConfirmation:
                  result.error?.code === 'RISK_CONFIRMATION_REQUIRED',
                missingPhysicalPackage: result.error?.details?.missingPhysicalPackage === true,
                packagePath:
                  typeof result.error?.details?.packagePath === 'string'
                    ? result.error.details.packagePath
                    : undefined
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
              if (row.package_type === 'ledger_backup') {
                return buildUnsupportedLedgerRestoreResponse({
                  backupId: payload.backupId,
                  packageType: row.package_type
                })
              }
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
              const manifest = JSON.parse(fs.readFileSync(resolved.manifestPath, 'utf8')) as {
                checksum: string
                ledgerId?: number | null
                packageType?: string
              }
              if (manifest.packageType === 'ledger_backup') {
                return buildUnsupportedLedgerRestoreResponse({
                  packagePath: picked.directoryPath,
                  packageType: 'ledger_backup'
                })
              }

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

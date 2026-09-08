import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { handleInvoke } from './typedInvoke'
import { getDatabase } from '../database/init'
import {
  BACKUP_CREATE_LAST_DIR_KEY,
  BACKUP_IMPORT_LAST_DIR_KEY,
  BACKUP_LAST_DIR_LEGACY_KEY,
  BACKUP_RESTORE_LAST_DIR_KEY,
  createBackupCommand,
  deleteBackupCommand,
  importBackupCommand,
  listBackupsCommand,
  restoreBackupCommand,
  validateBackupCommand
} from '../commands/backupCommands'
import { resolveBackupArtifactPaths } from '../services/backupRecovery'
import { getPathPreferenceWithFallback, rememberPathPreference } from '../services/pathPreference'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import { requireAdmin, requireLedgerAccess } from './session'

function getDefaultBackupRootDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '系统备份')
}

function getPreferredBackupDir(db: ReturnType<typeof getDatabase>, primaryKey: string): string {
  return (
    getPathPreferenceWithFallback(db, [primaryKey, BACKUP_LAST_DIR_LEGACY_KEY]) ??
    getDefaultBackupRootDir()
  )
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

export function registerBackupHandlers(): void {
  handleInvoke(
    'backup:create',
    async (
      event,
      payload: {
        ledgerId: number
        period?: string | null
        directoryPath?: string
        operationId?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'backup:create',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId,
            period: null,
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

            const preferredDir = getPreferredBackupDir(db, BACKUP_CREATE_LAST_DIR_KEY)
            const picked = payload.directoryPath
              ? { cancelled: false, directoryPath: payload.directoryPath }
              : await pickDirectory(event.sender, {
                  defaultPath: preferredDir,
                  title: '选择账套备份保存目录',
                  createDirectory: true
                })

            if (picked.cancelled || !picked.directoryPath) {
              return { success: false, cancelled: true }
            }

            rememberPathPreference(db, BACKUP_CREATE_LAST_DIR_KEY, picked.directoryPath)
            const result = await createBackupCommand(createCommandContextFromEvent(event), {
              ledgerId: payload.ledgerId,
              period: null,
              directoryPath: picked.directoryPath,
              ...(payload.operationId ? { operationId: payload.operationId } : {})
            })
            if (!isCommandSuccess(result)) {
              return {
                success: false,
                error: result.error?.message ?? '创建备份失败',
                errorCode: result.error?.code,
                errorDetails: result.error?.details
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

  handleInvoke('backup:list', (event, ledgerId?: number) =>
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

  handleInvoke('backup:validate', (event, backupId: number) =>
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

  handleInvoke(
    'backup:import',
    async (
      event,
      payload?: {
        backupId?: number
        packagePath?: string
        operationId?: string
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
            const preferredDir = getPreferredBackupDir(db, BACKUP_IMPORT_LAST_DIR_KEY)
            let selectedPackagePath: string | undefined

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
                return { success: false, error: '历史整库备份不支持导入为新账套' }
              }
            } else {
              const picked = payload?.packagePath
                ? { cancelled: false, directoryPath: payload.packagePath }
                : await pickDirectory(event.sender, {
                    defaultPath: preferredDir,
                    title: '选择需要导入的账套备份目录'
                  })

              if (picked.cancelled || !picked.directoryPath) {
                return { success: false, cancelled: true }
              }

              selectedPackagePath = picked.directoryPath
              rememberPathPreference(
                db,
                BACKUP_IMPORT_LAST_DIR_KEY,
                path.dirname(picked.directoryPath)
              )
              resolveBackupArtifactPaths(picked.directoryPath)
            }

            const result = await importBackupCommand(createCommandContextFromEvent(event), {
              backupId: payload?.backupId,
              packagePath: payload?.backupId ? undefined : selectedPackagePath,
              ...(payload?.operationId ? { operationId: payload.operationId } : {})
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

  handleInvoke(
    'backup:delete',
    (
      event,
      payload: {
        backupId: number
        deleteRecordOnly?: boolean
        operationId?: string
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
                operationId: result.data.operationId,
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

  handleInvoke(
    'backup:restore',
    async (
      event,
      payload?: {
        backupId?: number
        packagePath?: string
        operationId?: string
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
          try {
            requireAdmin(event)
            const db = getDatabase()
            let packagePath = payload?.packagePath
            if (typeof payload?.backupId !== 'number' && !packagePath) {
              const picked = await pickDirectory(event.sender, {
                defaultPath: getPreferredBackupDir(db, BACKUP_RESTORE_LAST_DIR_KEY),
                title: '选择需要恢复的备份包目录'
              })
              if (picked.cancelled || !picked.directoryPath)
                return { success: false, cancelled: true }
              packagePath = picked.directoryPath
            }
            const result = await restoreBackupCommand(createCommandContextFromEvent(event), {
              backupId: payload?.backupId,
              packagePath,
              ...(payload?.operationId ? { operationId: payload.operationId } : {})
            })
            if (!isCommandSuccess(result))
              return {
                success: false,
                error: result.error?.message ?? '恢复失败',
                errorCode: result.error?.code,
                errorDetails: result.error?.details
              }
            app.relaunch()
            app.exit(0)
            return { success: true, restartRequired: true, operationId: result.data.operationId }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '恢复备份失败'
            }
          }
        }
      )
  )
}

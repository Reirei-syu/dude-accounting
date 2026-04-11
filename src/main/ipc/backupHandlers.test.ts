import { beforeEach, describe, expect, it, vi } from 'vitest'

const backupHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : 'D:/UserData')),
    showOpenDialog: vi.fn(),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT id, name FROM ledgers')) {
          return {
            get: () => ({ id: 1, name: '测试账套' })
          }
        }
        if (sql.includes('SELECT id, ledger_id, package_type, backup_path, manifest_path')) {
          return {
            get: () => undefined
          }
        }
        return {
          get: () => undefined
        }
      })
    })),
    withIpcTelemetry: vi.fn(
      async (_options: unknown, operation: () => unknown) => await operation()
    ),
    createBackupCommand: vi.fn(),
    deleteBackupCommand: vi.fn(),
    importBackupCommand: vi.fn(),
    listBackupsCommand: vi.fn(),
    validateBackupCommand: vi.fn(),
    getBackupPackageById: vi.fn(),
    getPathPreferenceWithFallback: vi.fn(),
    rememberPathPreference: vi.fn(),
    resolveBackupArtifactPaths: vi.fn(),
    validateBackupArtifact: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: backupHandlerMocks.appGetPath },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {
    showOpenDialog: backupHandlerMocks.showOpenDialog
  },
  ipcMain: {
    handle: backupHandlerMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: backupHandlerMocks.getDatabase,
  closeDatabase: vi.fn(),
  getDatabasePath: vi.fn(() => 'D:/tmp/dude-accounting.db'),
  initializeDatabase: vi.fn()
}))

vi.mock('../services/auditLog', () => ({
  appendOperationLog: vi.fn()
}))

vi.mock('../services/backupCatalog', () => ({
  getBackupPackageById: backupHandlerMocks.getBackupPackageById
}))

vi.mock('../services/backupRecovery', () => ({
  resolveBackupArtifactPaths: backupHandlerMocks.resolveBackupArtifactPaths,
  restoreBackupArtifact: vi.fn(),
  validateBackupArtifact: backupHandlerMocks.validateBackupArtifact
}))

vi.mock('../services/pathPreference', () => ({
  getPathPreferenceWithFallback: backupHandlerMocks.getPathPreferenceWithFallback,
  rememberPathPreference: backupHandlerMocks.rememberPathPreference
}))

vi.mock('../services/pendingRestoreLog', () => ({
  clearPendingRestoreLog: vi.fn(),
  getPendingRestoreLogPath: vi.fn(),
  writePendingRestoreLog: vi.fn()
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: backupHandlerMocks.withIpcTelemetry
}))

vi.mock('../commands/backupCommands', () => ({
  BACKUP_CREATE_LAST_DIR_KEY: 'backup_create_last_dir',
  BACKUP_IMPORT_LAST_DIR_KEY: 'backup_import_last_dir',
  BACKUP_LAST_DIR_LEGACY_KEY: 'backup_last_dir',
  BACKUP_RESTORE_LAST_DIR_KEY: 'backup_restore_last_dir',
  createBackupCommand: backupHandlerMocks.createBackupCommand,
  deleteBackupCommand: backupHandlerMocks.deleteBackupCommand,
  importBackupCommand: backupHandlerMocks.importBackupCommand,
  listBackupsCommand: backupHandlerMocks.listBackupsCommand,
  validateBackupCommand: backupHandlerMocks.validateBackupCommand
}))

vi.mock('./session', () => ({
  getSessionByEvent: vi.fn(() => ({
    id: 1,
    username: 'admin',
    permissions: {},
    isAdmin: true,
    source: 'ipc'
  })),
  requireAuth: vi.fn(() => ({
    id: 1,
    username: 'admin',
    permissions: {},
    isAdmin: true,
    source: 'ipc'
  })),
  requireAdmin: vi.fn(),
  requireLedgerAccess: vi.fn()
}))

import { registerBackupHandlers } from './backup'

describe('backup IPC handlers', () => {
  beforeEach(() => {
    backupHandlerMocks.handlers.clear()
    vi.clearAllMocks()
    backupHandlerMocks.getPathPreferenceWithFallback.mockReturnValue(null)
    backupHandlerMocks.createBackupCommand.mockResolvedValue({
      status: 'success',
      data: {
        backupId: 21,
        directoryPath: 'D:/exports',
        period: null,
        backupPath: 'D:/exports/backup.db',
        manifestPath: 'D:/exports/manifest.json',
        checksum: 'checksum-1',
        fileSize: 128
      },
      error: null
    })
    backupHandlerMocks.importBackupCommand.mockResolvedValue({
      status: 'success',
      data: {
        importedLedgerId: 12,
        importedLedgerName: '导入账套'
      },
      error: null
    })
    backupHandlerMocks.getBackupPackageById.mockReturnValue({
      id: 7,
      ledger_id: 1,
      package_type: 'system_db_snapshot_legacy',
      backup_path: 'D:/exports/legacy-backup/data.db',
      manifest_path: 'D:/exports/legacy-backup/manifest.json',
      checksum: 'checksum-1'
    })
    registerBackupHandlers()
  })

  it('uses dedicated remembered directories for create/import/restore backup dialogs', async () => {
    backupHandlerMocks.getPathPreferenceWithFallback
      .mockReturnValueOnce('D:/preferred-create')
      .mockReturnValueOnce('D:/preferred-import')
      .mockReturnValueOnce('D:/preferred-restore')
    backupHandlerMocks.showOpenDialog
      .mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })
      .mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })
      .mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      })

    const createHandler = backupHandlerMocks.handlers.get('backup:create')
    const importHandler = backupHandlerMocks.handlers.get('backup:import')
    const restoreHandler = backupHandlerMocks.handlers.get('backup:restore')
    const event = { sender: { id: 1 } }

    await createHandler?.(event, { ledgerId: 1 })
    await importHandler?.(event, {})
    await restoreHandler?.(event, {})

    expect(backupHandlerMocks.getPathPreferenceWithFallback).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      ['backup_create_last_dir', 'backup_last_dir']
    )
    expect(backupHandlerMocks.getPathPreferenceWithFallback).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      ['backup_import_last_dir', 'backup_last_dir']
    )
    expect(backupHandlerMocks.getPathPreferenceWithFallback).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      ['backup_restore_last_dir', 'backup_last_dir']
    )

    expect(backupHandlerMocks.showOpenDialog.mock.calls[0]?.[0]).toMatchObject({
      defaultPath: 'D:/preferred-create'
    })
    expect(backupHandlerMocks.showOpenDialog.mock.calls[1]?.[0]).toMatchObject({
      defaultPath: 'D:/preferred-import'
    })
    expect(backupHandlerMocks.showOpenDialog.mock.calls[2]?.[0]).toMatchObject({
      defaultPath: 'D:/preferred-restore'
    })
  })

  it('surfaces record-only deletion guidance when the physical package is already missing', async () => {
    backupHandlerMocks.deleteBackupCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: {
        code: 'RISK_CONFIRMATION_REQUIRED',
        message: '路径下备份包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
        details: {
          packagePath: 'D:/exports/missing-backup',
          missingPhysicalPackage: true
        }
      }
    })

    const handler = backupHandlerMocks.handlers.get('backup:delete')
    const result = await handler?.({ sender: { id: 1 } }, { backupId: 7 })

    expect(result).toEqual({
      success: false,
      error: '路径下备份包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
      errorCode: 'RISK_CONFIRMATION_REQUIRED',
      errorDetails: {
        packagePath: 'D:/exports/missing-backup',
        missingPhysicalPackage: true
      },
      requiresRecordDeletionConfirmation: true,
      missingPhysicalPackage: true,
      packagePath: 'D:/exports/missing-backup'
    })
  })

  it('guides users to backup import when restore target is a ledger backup package', async () => {
    backupHandlerMocks.getBackupPackageById.mockReturnValue({
      id: 9,
      ledger_id: 1,
      package_type: 'ledger_backup',
      backup_path: 'D:/exports/ledger-backup/data.db',
      manifest_path: 'D:/exports/ledger-backup/manifest.json',
      checksum: 'checksum-2'
    })

    const handler = backupHandlerMocks.handlers.get('backup:restore')
    const result = await handler?.({ sender: { id: 1 } }, { backupId: 9 })

    expect(result).toEqual({
      success: false,
      error: '账套备份不支持整库恢复，请改用 backup import 导入为新账套',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: {
        backupId: 9,
        packageType: 'ledger_backup'
      }
    })
    expect(backupHandlerMocks.validateBackupArtifact).not.toHaveBeenCalled()
  })
})

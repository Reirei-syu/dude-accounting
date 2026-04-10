import { beforeEach, describe, expect, it, vi } from 'vitest'

const backupHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : 'D:/UserData')),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    withIpcTelemetry: vi.fn(
      async (_options: unknown, operation: () => unknown) => await operation()
    ),
    deleteBackupCommand: vi.fn(),
    getBackupPackageById: vi.fn(),
    resolveBackupArtifactPaths: vi.fn(),
    validateBackupArtifact: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: backupHandlerMocks.appGetPath },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {
    showOpenDialog: vi.fn()
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
  getPathPreference: vi.fn(),
  rememberPathPreference: vi.fn()
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
  createBackupCommand: vi.fn(),
  deleteBackupCommand: backupHandlerMocks.deleteBackupCommand,
  importBackupCommand: vi.fn(),
  listBackupsCommand: vi.fn(),
  validateBackupCommand: vi.fn()
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
      error: '账套级备份包不支持整库恢复，请改用 backup import 导入为新账套',
      errorCode: 'VALIDATION_ERROR',
      errorDetails: {
        backupId: 9,
        packageType: 'ledger_backup'
      }
    })
    expect(backupHandlerMocks.validateBackupArtifact).not.toHaveBeenCalled()
  })
})

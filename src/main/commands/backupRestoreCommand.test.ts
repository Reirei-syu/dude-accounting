import { beforeEach, describe, expect, it, vi } from 'vitest'

const backupMocks = vi.hoisted(() => ({
  getBackupPackageById: vi.fn(),
  validateBackupArtifact: vi.fn(),
  resolveBackupArtifactPaths: vi.fn(),
  restoreBackupArtifact: vi.fn(),
  closeDatabase: vi.fn(),
  initializeDatabase: vi.fn(),
  writePendingRestoreLog: vi.fn(),
  clearPendingRestoreLog: vi.fn(),
  getPendingRestoreLogPath: vi.fn(() => 'D:/tmp/pending-restore-log.json'),
  requestEmbeddedCliRelaunch: vi.fn(),
  requireCommandAdmin: vi.fn((actor) => actor),
  requireCommandLedgerAccess: vi.fn((...args) => args[1])
}))

vi.mock('../database/init', () => ({
  closeDatabase: backupMocks.closeDatabase,
  getDatabasePath: () => 'D:/tmp/dude-accounting.db',
  initializeDatabase: backupMocks.initializeDatabase
}))

vi.mock('../services/backupCatalog', async () => {
  const actual = await vi.importActual('../services/backupCatalog')
  return {
    ...(actual as object),
    getBackupPackageById: backupMocks.getBackupPackageById
  }
})

vi.mock('../services/backupRecovery', async () => {
  const actual = await vi.importActual('../services/backupRecovery')
  return {
    ...(actual as object),
    resolveBackupArtifactPaths: backupMocks.resolveBackupArtifactPaths,
    restoreBackupArtifact: backupMocks.restoreBackupArtifact,
    validateBackupArtifact: backupMocks.validateBackupArtifact
  }
})

vi.mock('../services/pendingRestoreLog', () => ({
  clearPendingRestoreLog: backupMocks.clearPendingRestoreLog,
  getPendingRestoreLogPath: backupMocks.getPendingRestoreLogPath,
  writePendingRestoreLog: backupMocks.writePendingRestoreLog
}))

vi.mock('../runtime/embeddedCliState', () => ({
  requestEmbeddedCliRelaunch: backupMocks.requestEmbeddedCliRelaunch
}))

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandAdmin: backupMocks.requireCommandAdmin,
    requireCommandLedgerAccess: backupMocks.requireCommandLedgerAccess
  }
})

import { restoreBackupCommand } from './backupCommands'

describe('restoreBackupCommand', () => {
  const context = {
    db: {
      prepare: vi.fn(),
      pragma: vi.fn()
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli' as const
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-10T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    backupMocks.getBackupPackageById.mockReturnValue({
      id: 11,
      ledger_id: 7,
      package_type: 'system_db_snapshot_legacy',
      backup_path: 'D:/backup/package/data.db',
      manifest_path: 'D:/backup/package/manifest.json',
      checksum: 'checksum-1'
    })
    backupMocks.validateBackupArtifact.mockReturnValue({
      valid: true,
      actualChecksum: 'checksum-1'
    })
  })

  it('writes pending log and requests relaunch on successful restore', async () => {
    const result = await restoreBackupCommand(context as never, { backupId: 11 })

    expect(result.status).toBe('success')
    expect(result.data).toMatchObject({
      restartRequired: true,
      backupPath: 'D:/backup/package/data.db'
    })
    expect(backupMocks.writePendingRestoreLog).toHaveBeenCalledTimes(1)
    expect(backupMocks.closeDatabase).toHaveBeenCalledTimes(1)
    expect(backupMocks.restoreBackupArtifact).toHaveBeenCalledWith({
      backupPath: 'D:/backup/package/data.db',
      targetPath: 'D:/tmp/dude-accounting.db'
    })
    expect(backupMocks.requestEmbeddedCliRelaunch).toHaveBeenCalledTimes(1)
    expect(backupMocks.initializeDatabase).not.toHaveBeenCalled()
  })

  it('rejects ledger backup packages with a clear import guidance message', async () => {
    backupMocks.getBackupPackageById.mockReturnValue({
      id: 11,
      ledger_id: 7,
      package_type: 'ledger_backup',
      backup_path: 'D:/backup/package/data.db',
      manifest_path: 'D:/backup/package/manifest.json',
      checksum: 'checksum-1'
    })

    const result = await restoreBackupCommand(context as never, { backupId: 11 })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '账套级备份包不支持整库恢复，请改用 backup import 导入为新账套',
      details: {
        backupId: 11,
        packageType: 'ledger_backup'
      }
    })
    expect(backupMocks.validateBackupArtifact).not.toHaveBeenCalled()
    expect(backupMocks.restoreBackupArtifact).not.toHaveBeenCalled()
    expect(backupMocks.requestEmbeddedCliRelaunch).not.toHaveBeenCalled()
  })

  it('clears pending log and reopens database when restore fails', async () => {
    backupMocks.restoreBackupArtifact.mockImplementation(() => {
      throw new Error('restore failed')
    })

    const result = await restoreBackupCommand(context as never, { backupId: 11 })

    expect(result.status).toBe('error')
    expect(result.error?.message).toBe('restore failed')
    expect(backupMocks.clearPendingRestoreLog).toHaveBeenCalledTimes(1)
    expect(backupMocks.initializeDatabase).toHaveBeenCalledTimes(1)
  })
})

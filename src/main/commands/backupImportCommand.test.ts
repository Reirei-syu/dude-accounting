import { beforeEach, describe, expect, it, vi } from 'vitest'

const backupImportMocks = vi.hoisted(() => ({
  importLedgerBackupArtifact: vi.fn(),
  resolveBackupArtifactPaths: vi.fn(),
  rememberPathPreference: vi.fn(),
  requireCommandPermission: vi.fn((actor) => actor),
  requireCommandLedgerAccess: vi.fn(),
  appendActorOperationLog: vi.fn()
}))

vi.mock('../database/init', () => ({
  getDatabasePath: () => 'D:/tmp/dude-accounting.db'
}))

vi.mock('../services/backupRecovery', async () => {
  const actual = await vi.importActual('../services/backupRecovery')
  return {
    ...(actual as object),
    importLedgerBackupArtifact: backupImportMocks.importLedgerBackupArtifact,
    resolveBackupArtifactPaths: backupImportMocks.resolveBackupArtifactPaths
  }
})

vi.mock('../services/pathPreference', () => ({
  rememberPathPreference: backupImportMocks.rememberPathPreference
}))

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandPermission: backupImportMocks.requireCommandPermission,
    requireCommandLedgerAccess: backupImportMocks.requireCommandLedgerAccess
  }
})

vi.mock('./operationLog', async () => {
  const actual = await vi.importActual('./operationLog')
  return {
    ...(actual as object),
    appendActorOperationLog: backupImportMocks.appendActorOperationLog
  }
})

import { importBackupCommand } from './backupCommands'

describe('importBackupCommand', () => {
  const context = {
    db: {
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
    now: new Date('2026-04-11T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    backupImportMocks.resolveBackupArtifactPaths.mockReturnValue({
      backupPath: 'D:/backups/ledger-backup/data.db',
      manifestPath: 'D:/backups/ledger-backup/manifest.json'
    })
    backupImportMocks.importLedgerBackupArtifact.mockReturnValue({
      importedLedgerId: 12,
      importedLedgerName: '导入账套'
    })
  })

  it('remembers import directories when importing from an explicit package path', async () => {
    const result = await importBackupCommand(context as never, {
      packagePath: 'D:/backups/ledger-backup'
    })

    expect(result.status).toBe('success')
    expect(backupImportMocks.rememberPathPreference).toHaveBeenCalledWith(
      expect.anything(),
      'backup_import_last_dir',
      'D:/backups'
    )
    expect(backupImportMocks.importLedgerBackupArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        backupPath: 'D:/backups/ledger-backup/data.db',
        manifestPath: 'D:/backups/ledger-backup/manifest.json',
        targetPath: 'D:/tmp/dude-accounting.db'
      })
    )
  })
})

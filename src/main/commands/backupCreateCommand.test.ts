import { beforeEach, describe, expect, it, vi } from 'vitest'

const backupCreateMocks = vi.hoisted(() => ({
  createBackupPackageRecord: vi.fn(),
  createLedgerBackupArtifact: vi.fn(),
  rememberPathPreference: vi.fn(),
  requireCommandPermission: vi.fn((actor) => actor),
  requireCommandLedgerAccess: vi.fn(),
  appendActorOperationLog: vi.fn()
}))

vi.mock('../services/backupCatalog', async () => {
  const actual = await vi.importActual('../services/backupCatalog')
  return {
    ...(actual as object),
    createBackupPackageRecord: backupCreateMocks.createBackupPackageRecord
  }
})

vi.mock('../services/backupRecovery', async () => {
  const actual = await vi.importActual('../services/backupRecovery')
  return {
    ...(actual as object),
    createLedgerBackupArtifact: backupCreateMocks.createLedgerBackupArtifact
  }
})

vi.mock('../services/pathPreference', () => ({
  rememberPathPreference: backupCreateMocks.rememberPathPreference
}))

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandPermission: backupCreateMocks.requireCommandPermission,
    requireCommandLedgerAccess: backupCreateMocks.requireCommandLedgerAccess
  }
})

vi.mock('./operationLog', () => ({
  appendActorOperationLog: backupCreateMocks.appendActorOperationLog
}))

import { createBackupCommand } from './backupCommands'

describe('createBackupCommand', () => {
  const ledgerQuery = {
    get: vi.fn(() => ({
      id: 7,
      name: '千千结账套'
    }))
  }

  const context = {
    db: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT id, name FROM ledgers')) {
          return ledgerQuery
        }
        throw new Error(`unexpected sql: ${sql}`)
      }),
      pragma: vi.fn()
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli' as const
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-11T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ledgerQuery.get.mockReturnValue({
      id: 7,
      name: '千千结账套'
    })
    backupCreateMocks.createLedgerBackupArtifact.mockReturnValue({
      packageDir: 'D:/exports/千千结账套_备份_20260411-180000',
      backupPath: 'D:/exports/千千结账套_备份_20260411-180000/千千结账套_备份_20260411-180000.db',
      manifestPath: 'D:/exports/千千结账套_备份_20260411-180000/manifest.json',
      checksum: 'checksum-1',
      fileSize: 2048,
      createdAt: '2026-04-11 18:00:00',
      attachments: [],
      settingsAssets: []
    })
    backupCreateMocks.createBackupPackageRecord.mockReturnValue(88)
  })

  it('creates backup records with schema version 2.1 and null period metadata', async () => {
    const result = await createBackupCommand(context as never, {
      ledgerId: 7,
      period: '2026-03',
      directoryPath: 'D:/exports'
    })

    expect(result.status).toBe('success')
    expect(backupCreateMocks.rememberPathPreference).toHaveBeenCalledWith(
      context.db,
      'backup_create_last_dir',
      'D:/exports'
    )
    expect(backupCreateMocks.createLedgerBackupArtifact).toHaveBeenCalledWith({
      sourcePath: expect.any(String),
      backupDir: 'D:/exports',
      ledgerId: 7,
      ledgerName: '千千结账套',
      period: null,
      fiscalYear: null,
      now: context.now
    })
    expect(backupCreateMocks.createBackupPackageRecord).toHaveBeenCalledWith(
      context.db,
      expect.objectContaining({
        ledgerId: 7,
        backupPeriod: null,
        fiscalYear: null,
        packageType: 'ledger_backup',
        packageSchemaVersion: '2.1'
      })
    )
    expect(result.data).toMatchObject({
      backupId: 88,
      directoryPath: 'D:/exports',
      period: null
    })
  })
})

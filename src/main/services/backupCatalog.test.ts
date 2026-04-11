import { describe, expect, it } from 'vitest'
import {
  createBackupPackageRecord,
  deleteBackupPackageRecord,
  getBackupPackageById,
  listBackupPackageIdsByLedger,
  listBackupPackages,
  updateBackupPackageValidation
} from './backupCatalog'

type BackupRow = {
  id: number
  ledger_id: number
  backup_period: string | null
  fiscal_year: string | null
  package_type: string
  package_schema_version: string
  backup_path: string
  manifest_path: string
  checksum: string
  file_size: number
  status: string
  created_by: number
  created_at: string
  validated_at: string | null
}

class FakeBackupCatalogDb {
  rows: BackupRow[] = []
  permissions: Array<{ user_id: number; ledger_id: number }> = []
  private nextId = 1

  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { lastInsertRowid: number; changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      `INSERT INTO backup_packages ( ledger_id, backup_period, fiscal_year, package_type, package_schema_version, backup_path, manifest_path, checksum, file_size, status, created_by, created_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?)`
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          ledgerId,
          backupPeriod,
          fiscalYear,
          packageType,
          packageSchemaVersion,
          backupPath,
          manifestPath,
          checksum,
          fileSize,
          createdBy,
          createdAt
        ) => {
          const id = this.nextId++
          this.rows.push({
            id,
            ledger_id: Number(ledgerId),
            backup_period: backupPeriod === null ? null : String(backupPeriod),
            fiscal_year: fiscalYear === null ? null : String(fiscalYear),
            package_type: String(packageType),
            package_schema_version: String(packageSchemaVersion),
            backup_path: String(backupPath),
            manifest_path: String(manifestPath),
            checksum: String(checksum),
            file_size: Number(fileSize),
            status: 'generated',
            created_by: Number(createdBy),
            created_at: String(createdAt),
            validated_at: null
          })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT * FROM backup_packages WHERE id = ?') {
      return {
        get: (backupId) => this.rows.find((row) => row.id === Number(backupId)),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT id FROM backup_packages WHERE ledger_id = ? ORDER BY id DESC') {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.rows
            .filter((row) => row.ledger_id === Number(ledgerId))
            .sort((left, right) => right.id - left.id)
            .map((row) => ({ id: row.id })),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT * FROM backup_packages WHERE ledger_id = ? ORDER BY id DESC') {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.rows
            .filter((row) => row.ledger_id === Number(ledgerId))
            .sort((left, right) => right.id - left.id),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT * FROM backup_packages ORDER BY id DESC') {
      return {
        get: () => undefined,
        all: () => [...this.rows].sort((left, right) => right.id - left.id),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT bp.* FROM backup_packages bp INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = bp.ledger_id WHERE ulp.user_id = ? ORDER BY bp.id DESC'
    ) {
      return {
        get: () => undefined,
        all: (userId) => {
          const allowedLedgerIds = new Set(
            this.permissions
              .filter((item) => item.user_id === Number(userId))
              .map((item) => item.ledger_id)
          )

          return this.rows
            .filter((row) => allowedLedgerIds.has(row.ledger_id))
            .sort((left, right) => right.id - left.id)
        },
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      "UPDATE backup_packages SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END WHERE id = ?"
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (status, _validatedKeyword, validatedAt, backupId) => {
          const row = this.rows.find((item) => item.id === Number(backupId))
          if (!row) {
            return { lastInsertRowid: 0, changes: 0 }
          }

          row.status = String(status)
          if (String(status) === 'validated') {
            row.validated_at = validatedAt === null ? null : String(validatedAt)
          }
          return { lastInsertRowid: 0, changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM backup_packages WHERE id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (backupId) => {
          const before = this.rows.length
          this.rows = this.rows.filter((row) => row.id !== Number(backupId))
          return { lastInsertRowid: 0, changes: before === this.rows.length ? 0 : 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeBackupCatalogDb: ${normalized}`)
  }
}

describe('backupCatalog service', () => {
  it('lists backup packages by permission scope', () => {
    const db = new FakeBackupCatalogDb()
    const firstId = createBackupPackageRecord(db as never, {
      ledgerId: 1,
      backupPeriod: '2026-03',
      fiscalYear: '2026',
      packageType: 'ledger_backup',
      packageSchemaVersion: '2.0',
      backupPath: 'D:/tmp/backup-1.db',
      manifestPath: 'D:/tmp/backup-1/manifest.json',
      checksum: 'checksum-1',
      fileSize: 100,
      createdBy: 1,
      createdAt: '2026-03-19 10:00:00'
    })
    const secondId = createBackupPackageRecord(db as never, {
      ledgerId: 2,
      backupPeriod: '2026-02',
      fiscalYear: '2026',
      packageType: 'system_db_snapshot_legacy',
      packageSchemaVersion: '1.0',
      backupPath: 'D:/tmp/backup-2.db',
      manifestPath: 'D:/tmp/backup-2/manifest.json',
      checksum: 'checksum-2',
      fileSize: 200,
      createdBy: 1,
      createdAt: '2026-03-19 10:05:00'
    })

    db.permissions.push({ user_id: 100, ledger_id: 1 })

    expect(
      listBackupPackages(db as never, {
        userId: 1,
        isAdmin: true
      }).map((row) => row.id)
    ).toEqual([secondId, firstId])

    expect(
      listBackupPackages(db as never, {
        userId: 100,
        isAdmin: false
      }).map((row) => row.id)
    ).toEqual([firstId])

    expect(
      listBackupPackages(db as never, {
        ledgerId: 2,
        userId: 100,
        isAdmin: false
      }).map((row) => row.id)
    ).toEqual([secondId])
  })

  it('updates validation state and deletes records', () => {
    const db = new FakeBackupCatalogDb()
    const backupId = createBackupPackageRecord(db as never, {
      ledgerId: 1,
      backupPeriod: '2026-03',
      fiscalYear: '2026',
      packageType: 'ledger_backup',
      packageSchemaVersion: '2.0',
      backupPath: 'D:/tmp/backup-1.db',
      manifestPath: 'D:/tmp/backup-1/manifest.json',
      checksum: 'checksum-1',
      fileSize: 100,
      createdBy: 1,
      createdAt: '2026-03-19 10:00:00'
    })

    updateBackupPackageValidation(db as never, backupId, {
      valid: true,
      validatedAt: '2026-03-19 10:10:00'
    })

    expect(getBackupPackageById(db as never, backupId)).toMatchObject({
      id: backupId,
      package_type: 'ledger_backup',
      package_schema_version: '2.0',
      status: 'validated',
      validated_at: '2026-03-19 10:10:00'
    })
    expect(listBackupPackageIdsByLedger(db as never, 1)).toEqual([backupId])

    deleteBackupPackageRecord(db as never, backupId)

    expect(getBackupPackageById(db as never, backupId)).toBeUndefined()
    expect(listBackupPackageIdsByLedger(db as never, 1)).toEqual([])
  })

  it('allows snapshot records without backup period or fiscal year', () => {
    const db = new FakeBackupCatalogDb()
    const backupId = createBackupPackageRecord(db as never, {
      ledgerId: 1,
      backupPeriod: null,
      fiscalYear: null,
      packageType: 'ledger_backup',
      packageSchemaVersion: '2.1',
      backupPath: 'D:/tmp/backup-snapshot.db',
      manifestPath: 'D:/tmp/backup-snapshot/manifest.json',
      checksum: 'checksum-snapshot',
      fileSize: 300,
      createdBy: 1,
      createdAt: '2026-04-11 18:00:00'
    })

    expect(getBackupPackageById(db as never, backupId)).toMatchObject({
      id: backupId,
      backup_period: null,
      fiscal_year: null,
      package_schema_version: '2.1'
    })
  })
})

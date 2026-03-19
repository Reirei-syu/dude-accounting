import { describe, expect, it } from 'vitest'
import {
  createArchiveExportRecord,
  deleteArchiveExportRecord,
  getArchiveExportById,
  listArchiveExportIdsByLedger,
  listArchiveExports,
  updateArchiveExportValidation
} from './archiveCatalog'

type ArchiveRow = {
  id: number
  ledger_id: number
  fiscal_year: string
  export_path: string
  manifest_path: string
  checksum: string | null
  status: string
  item_count: number
  created_by: number
  created_at: string
  validated_at: string | null
}

class FakeArchiveCatalogDb {
  rows: ArchiveRow[] = []
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
      `INSERT INTO archive_exports ( ledger_id, fiscal_year, export_path, manifest_path, checksum, status, item_count, created_by, created_at ) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?)`
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          ledgerId,
          fiscalYear,
          exportPath,
          manifestPath,
          checksum,
          itemCount,
          createdBy,
          createdAt
        ) => {
          const id = this.nextId++
          this.rows.push({
            id,
            ledger_id: Number(ledgerId),
            fiscal_year: String(fiscalYear),
            export_path: String(exportPath),
            manifest_path: String(manifestPath),
            checksum: checksum === null ? null : String(checksum),
            status: 'generated',
            item_count: Number(itemCount),
            created_by: Number(createdBy),
            created_at: String(createdAt),
            validated_at: null
          })
          return { lastInsertRowid: id, changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT * FROM archive_exports WHERE id = ?') {
      return {
        get: (exportId) => this.rows.find((row) => row.id === Number(exportId)),
        all: () => [],
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT id FROM archive_exports WHERE ledger_id = ? ORDER BY id DESC') {
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

    if (normalized === 'SELECT * FROM archive_exports WHERE ledger_id = ? ORDER BY id DESC') {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.rows
            .filter((row) => row.ledger_id === Number(ledgerId))
            .sort((left, right) => right.id - left.id),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (normalized === 'SELECT * FROM archive_exports ORDER BY id DESC') {
      return {
        get: () => undefined,
        all: () => [...this.rows].sort((left, right) => right.id - left.id),
        run: () => ({ lastInsertRowid: 0, changes: 0 })
      }
    }

    if (
      normalized ===
      'SELECT ae.* FROM archive_exports ae INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = ae.ledger_id WHERE ulp.user_id = ? ORDER BY ae.id DESC'
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
      "UPDATE archive_exports SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END WHERE id = ?"
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (status, _validatedKeyword, validatedAt, exportId) => {
          const row = this.rows.find((item) => item.id === Number(exportId))
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

    if (normalized === 'DELETE FROM archive_exports WHERE id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (exportId) => {
          const before = this.rows.length
          this.rows = this.rows.filter((row) => row.id !== Number(exportId))
          return { lastInsertRowid: 0, changes: before === this.rows.length ? 0 : 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeArchiveCatalogDb: ${normalized}`)
  }
}

describe('archiveCatalog service', () => {
  it('lists archive exports by permission scope', () => {
    const db = new FakeArchiveCatalogDb()
    const firstId = createArchiveExportRecord(db as never, {
      ledgerId: 1,
      fiscalYear: '2026',
      exportPath: 'D:/tmp/archive-1',
      manifestPath: 'D:/tmp/archive-1/manifest.json',
      checksum: 'checksum-1',
      itemCount: 10,
      createdBy: 1,
      createdAt: '2026-03-19 11:00:00'
    })
    const secondId = createArchiveExportRecord(db as never, {
      ledgerId: 2,
      fiscalYear: '2025',
      exportPath: 'D:/tmp/archive-2',
      manifestPath: 'D:/tmp/archive-2/manifest.json',
      checksum: 'checksum-2',
      itemCount: 20,
      createdBy: 1,
      createdAt: '2026-03-19 11:05:00'
    })

    db.permissions.push({ user_id: 100, ledger_id: 1 })

    expect(
      listArchiveExports(db as never, {
        userId: 1,
        isAdmin: true
      }).map((row) => row.id)
    ).toEqual([secondId, firstId])

    expect(
      listArchiveExports(db as never, {
        userId: 100,
        isAdmin: false
      }).map((row) => row.id)
    ).toEqual([firstId])

    expect(
      listArchiveExports(db as never, {
        ledgerId: 2,
        userId: 100,
        isAdmin: false
      }).map((row) => row.id)
    ).toEqual([secondId])
  })

  it('updates validation state and deletes records', () => {
    const db = new FakeArchiveCatalogDb()
    const exportId = createArchiveExportRecord(db as never, {
      ledgerId: 1,
      fiscalYear: '2026',
      exportPath: 'D:/tmp/archive-1',
      manifestPath: 'D:/tmp/archive-1/manifest.json',
      checksum: 'checksum-1',
      itemCount: 10,
      createdBy: 1,
      createdAt: '2026-03-19 11:00:00'
    })

    updateArchiveExportValidation(db as never, exportId, {
      valid: true,
      validatedAt: '2026-03-19 11:10:00'
    })

    expect(getArchiveExportById(db as never, exportId)).toMatchObject({
      id: exportId,
      status: 'validated',
      validated_at: '2026-03-19 11:10:00'
    })
    expect(listArchiveExportIdsByLedger(db as never, 1)).toEqual([exportId])

    deleteArchiveExportRecord(db as never, exportId)

    expect(getArchiveExportById(db as never, exportId)).toBeUndefined()
    expect(listArchiveExportIdsByLedger(db as never, 1)).toEqual([])
  })
})

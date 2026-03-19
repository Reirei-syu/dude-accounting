import type Database from 'better-sqlite3'

export interface ArchiveExportRecord {
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

export interface CreateArchiveExportInput {
  ledgerId: number
  fiscalYear: string
  exportPath: string
  manifestPath: string
  checksum: string
  itemCount: number
  createdBy: number
  createdAt: string
}

export interface ArchiveExportListScope {
  ledgerId?: number
  userId: number
  isAdmin: boolean
}

export function createArchiveExportRecord(
  db: Database.Database,
  input: CreateArchiveExportInput
): number {
  const result = db
    .prepare(
      `INSERT INTO archive_exports (
         ledger_id,
         fiscal_year,
         export_path,
         manifest_path,
         checksum,
         status,
         item_count,
         created_by,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?)`
    )
    .run(
      input.ledgerId,
      input.fiscalYear,
      input.exportPath,
      input.manifestPath,
      input.checksum,
      input.itemCount,
      input.createdBy,
      input.createdAt
    )

  return Number(result.lastInsertRowid)
}

export function getArchiveExportById(
  db: Database.Database,
  exportId: number
): ArchiveExportRecord | undefined {
  return db.prepare('SELECT * FROM archive_exports WHERE id = ?').get(exportId) as
    | ArchiveExportRecord
    | undefined
}

export function listArchiveExportIdsByLedger(db: Database.Database, ledgerId: number): number[] {
  const rows = db
    .prepare(
      `SELECT id
         FROM archive_exports
        WHERE ledger_id = ?
        ORDER BY id DESC`
    )
    .all(ledgerId) as Array<{ id: number }>

  return rows.map((row) => row.id)
}

export function listArchiveExports(
  db: Database.Database,
  scope: ArchiveExportListScope
): ArchiveExportRecord[] {
  if (typeof scope.ledgerId === 'number') {
    return db
      .prepare(
        `SELECT *
           FROM archive_exports
          WHERE ledger_id = ?
          ORDER BY id DESC`
      )
      .all(scope.ledgerId) as ArchiveExportRecord[]
  }

  if (scope.isAdmin) {
    return db
      .prepare('SELECT * FROM archive_exports ORDER BY id DESC')
      .all() as ArchiveExportRecord[]
  }

  return db
    .prepare(
      `SELECT ae.*
         FROM archive_exports ae
         INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = ae.ledger_id
        WHERE ulp.user_id = ?
        ORDER BY ae.id DESC`
    )
    .all(scope.userId) as ArchiveExportRecord[]
}

export function updateArchiveExportValidation(
  db: Database.Database,
  exportId: number,
  validation: {
    valid: boolean
    validatedAt?: string | null
  }
): void {
  db.prepare(
    `UPDATE archive_exports
       SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END
     WHERE id = ?`
  ).run(
    validation.valid ? 'validated' : 'failed',
    validation.valid ? 'validated' : 'failed',
    validation.valid ? (validation.validatedAt ?? null) : null,
    exportId
  )
}

export function deleteArchiveExportRecord(db: Database.Database, exportId: number): void {
  db.prepare('DELETE FROM archive_exports WHERE id = ?').run(exportId)
}

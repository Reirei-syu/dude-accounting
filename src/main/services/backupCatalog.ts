import type Database from 'better-sqlite3'

export interface BackupPackageRecord {
  id: number
  ledger_id: number
  backup_period: string | null
  fiscal_year: string | null
  package_type: 'ledger_backup' | 'system_db_snapshot_legacy'
  package_schema_version: string
  backup_path: string
  manifest_path: string | null
  checksum: string
  file_size: number
  status: string
  created_by: number
  created_at: string
  validated_at: string | null
}

export interface CreateBackupPackageInput {
  ledgerId: number
  backupPeriod: string | null
  fiscalYear: string | null
  packageType: 'ledger_backup' | 'system_db_snapshot_legacy'
  packageSchemaVersion: string
  backupPath: string
  manifestPath: string
  checksum: string
  fileSize: number
  createdBy: number
  createdAt: string
}

export interface BackupPackageListScope {
  ledgerId?: number
  userId: number
  isAdmin: boolean
}

export function createBackupPackageRecord(
  db: Database.Database,
  input: CreateBackupPackageInput
): number {
  const result = db
    .prepare(
       `INSERT INTO backup_packages (
          ledger_id,
          backup_period,
          fiscal_year,
          package_type,
          package_schema_version,
          backup_path,
          manifest_path,
          checksum,
          file_size,
          status,
          created_by,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?, ?)`
    )
    .run(
      input.ledgerId,
      input.backupPeriod,
      input.fiscalYear,
      input.packageType,
      input.packageSchemaVersion,
      input.backupPath,
      input.manifestPath,
      input.checksum,
      input.fileSize,
      input.createdBy,
      input.createdAt
    )

  return Number(result.lastInsertRowid)
}

export function getBackupPackageById(
  db: Database.Database,
  backupId: number
): BackupPackageRecord | undefined {
  return db.prepare('SELECT * FROM backup_packages WHERE id = ?').get(backupId) as
    | BackupPackageRecord
    | undefined
}

export function listBackupPackageIdsByLedger(db: Database.Database, ledgerId: number): number[] {
  const rows = db
    .prepare(
      `SELECT id
         FROM backup_packages
        WHERE ledger_id = ?
        ORDER BY id DESC`
    )
    .all(ledgerId) as Array<{ id: number }>

  return rows.map((row) => row.id)
}

export function listBackupPackages(
  db: Database.Database,
  scope: BackupPackageListScope
): BackupPackageRecord[] {
  if (typeof scope.ledgerId === 'number') {
    return db
      .prepare(
        `SELECT *
           FROM backup_packages
          WHERE ledger_id = ?
          ORDER BY id DESC`
      )
      .all(scope.ledgerId) as BackupPackageRecord[]
  }

  if (scope.isAdmin) {
    return db
      .prepare('SELECT * FROM backup_packages ORDER BY id DESC')
      .all() as BackupPackageRecord[]
  }

  return db
    .prepare(
      `SELECT bp.*
         FROM backup_packages bp
         INNER JOIN user_ledger_permissions ulp ON ulp.ledger_id = bp.ledger_id
        WHERE ulp.user_id = ?
        ORDER BY bp.id DESC`
    )
    .all(scope.userId) as BackupPackageRecord[]
}

export function updateBackupPackageValidation(
  db: Database.Database,
  backupId: number,
  validation: {
    valid: boolean
    validatedAt?: string | null
  }
): void {
  db.prepare(
    `UPDATE backup_packages
       SET status = ?, validated_at = CASE WHEN ? = 'validated' THEN ? ELSE validated_at END
     WHERE id = ?`
  ).run(
    validation.valid ? 'validated' : 'failed',
    validation.valid ? 'validated' : 'failed',
    validation.valid ? (validation.validatedAt ?? null) : null,
    backupId
  )
}

export function deleteBackupPackageRecord(db: Database.Database, backupId: number): void {
  db.prepare('DELETE FROM backup_packages WHERE id = ?').run(backupId)
}

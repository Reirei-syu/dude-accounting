import type Database from 'better-sqlite3'

export interface LedgerDeletionPrerequisites {
  validatedBackupCount: number
  validatedArchiveCount: number
}

export interface LedgerDeletionRiskSnapshot extends LedgerDeletionPrerequisites {
  missingValidatedBackup: boolean
  missingValidatedArchive: boolean
}

export function getLedgerDeletionPrerequisites(
  db: Database.Database,
  ledgerId: number
): LedgerDeletionPrerequisites {
  const backupRow = db
    .prepare(
      `SELECT COUNT(1) AS count
       FROM backup_packages
       WHERE ledger_id = ? AND status = 'validated'`
    )
    .get(ledgerId) as { count: number }

  const archiveRow = db
    .prepare(
      `SELECT COUNT(1) AS count
       FROM archive_exports
       WHERE ledger_id = ? AND status = 'validated'`
    )
    .get(ledgerId) as { count: number }

  return {
    validatedBackupCount: Number(backupRow?.count ?? 0),
    validatedArchiveCount: Number(archiveRow?.count ?? 0)
  }
}

export function getLedgerDeletionRiskSnapshot(
  db: Database.Database,
  ledgerId: number
): LedgerDeletionRiskSnapshot {
  const prerequisites = getLedgerDeletionPrerequisites(db, ledgerId)
  return {
    ...prerequisites,
    missingValidatedBackup: prerequisites.validatedBackupCount <= 0,
    missingValidatedArchive: prerequisites.validatedArchiveCount <= 0
  }
}

import { describe, expect, it } from 'vitest'
import { getLedgerDeletionPrerequisites, getLedgerDeletionRiskSnapshot } from './ledgerCompliance'

class FakeLedgerComplianceDb {
  backupPackages: Array<{ ledger_id: number; status: string }> = []
  archiveExports: Array<{ ledger_id: number; status: string }> = []

  prepare(sql: string): { get: (ledgerId: number) => { count: number } } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      "SELECT COUNT(1) AS count FROM backup_packages WHERE ledger_id = ? AND status = 'validated'"
    ) {
      return {
        get: (ledgerId) => ({
          count: this.backupPackages.filter(
            (item) => item.ledger_id === ledgerId && item.status === 'validated'
          ).length
        })
      }
    }

    if (
      normalized ===
      "SELECT COUNT(1) AS count FROM archive_exports WHERE ledger_id = ? AND status = 'validated'"
    ) {
      return {
        get: (ledgerId) => ({
          count: this.archiveExports.filter(
            (item) => item.ledger_id === ledgerId && item.status === 'validated'
          ).length
        })
      }
    }

    throw new Error(`Unhandled SQL in FakeLedgerComplianceDb: ${normalized}`)
  }
}

describe('ledgerCompliance service', () => {
  it('returns deletion risk warnings instead of hard blocking', () => {
    const db = new FakeLedgerComplianceDb()

    expect(getLedgerDeletionRiskSnapshot(db as never, 1)).toEqual({
      validatedBackupCount: 0,
      validatedArchiveCount: 0,
      missingValidatedBackup: true,
      missingValidatedArchive: true
    })

    db.backupPackages.push({ ledger_id: 1, status: 'validated' })
    expect(getLedgerDeletionRiskSnapshot(db as never, 1)).toEqual({
      validatedBackupCount: 1,
      validatedArchiveCount: 0,
      missingValidatedBackup: false,
      missingValidatedArchive: true
    })
  })

  it('keeps prerequisite counters for delete warnings', () => {
    const db = new FakeLedgerComplianceDb()
    db.backupPackages.push({ ledger_id: 1, status: 'validated' })
    db.archiveExports.push({ ledger_id: 1, status: 'validated' })

    expect(getLedgerDeletionPrerequisites(db as never, 1)).toEqual({
      validatedBackupCount: 1,
      validatedArchiveCount: 1
    })
    expect(getLedgerDeletionRiskSnapshot(db as never, 1)).toEqual({
      validatedBackupCount: 1,
      validatedArchiveCount: 1,
      missingValidatedBackup: false,
      missingValidatedArchive: false
    })
  })
})

import { describe, expect, it } from 'vitest'
import { assertLedgerDeletionAllowed, getLedgerDeletionPrerequisites } from './ledgerCompliance'

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
  it('blocks deletion when validated backup or archive export is missing', () => {
    const db = new FakeLedgerComplianceDb()

    expect(() => assertLedgerDeletionAllowed(db as never, 1)).toThrow(
      '删除账套前必须先完成已校验的系统备份和电子档案导出'
    )

    db.backupPackages.push({ ledger_id: 1, status: 'validated' })
    expect(() => assertLedgerDeletionAllowed(db as never, 1)).toThrow(
      '删除账套前必须先完成已校验的电子档案导出'
    )
  })

  it('allows deletion only after both validated backup and archive export exist', () => {
    const db = new FakeLedgerComplianceDb()
    db.backupPackages.push({ ledger_id: 1, status: 'validated' })
    db.archiveExports.push({ ledger_id: 1, status: 'validated' })

    expect(getLedgerDeletionPrerequisites(db as never, 1)).toEqual({
      validatedBackupCount: 1,
      validatedArchiveCount: 1
    })
    expect(() => assertLedgerDeletionAllowed(db as never, 1)).not.toThrow()
  })
})

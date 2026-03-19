import { describe, expect, it } from 'vitest'
import {
  applyVoucherBatchAction,
  isVoucherEligibleForBatchAction,
  listVoucherBatchTargets,
  splitVouchersByBatchAction,
  type VoucherBatchAction,
  type VoucherBatchTarget
} from './voucherBatchLifecycle'

class FakeVoucherBatchDb {
  vouchers: VoucherBatchTarget[] = []

  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized.startsWith(
        'SELECT id, status, deleted_from_status, ledger_id, period, voucher_word, auditor_id, bookkeeper_id FROM vouchers WHERE id IN ('
      )
    ) {
      return {
        all: (...voucherIds) =>
          this.vouchers.filter((voucher) => voucherIds.map(Number).includes(voucher.id)),
        run: () => ({ changes: 0 })
      }
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 1, auditor_id = ?, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher, userId) => {
        voucher.status = 1
        voucher.auditor_id = Number(userId)
      })
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 2, bookkeeper_id = ?, posted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher, userId) => {
        voucher.status = 2
        voucher.bookkeeper_id = Number(userId)
      })
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 1, bookkeeper_id = NULL, emergency_reversal_reason = ?, emergency_reversal_by = ?, emergency_reversal_at = datetime('now'), reversal_approval_tag = ?, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher) => {
        voucher.status = 1
        voucher.bookkeeper_id = null
      }, 3)
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 0, auditor_id = NULL, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher) => {
        voucher.status = 0
        voucher.auditor_id = null
      }, 0)
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 3, deleted_from_status = status, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher) => {
        voucher.deleted_from_status = voucher.status
        voucher.status = 3
      }, 0)
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 0, deleted_from_status = NULL, auditor_id = NULL, bookkeeper_id = NULL, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher) => {
        voucher.status = 0
        voucher.deleted_from_status = null
        voucher.auditor_id = null
        voucher.bookkeeper_id = null
      }, 0)
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = 1, deleted_from_status = NULL, bookkeeper_id = NULL, updated_at = datetime('now') WHERE id = ?"
    ) {
      return this.createUpdater((voucher) => {
        voucher.status = 1
        voucher.deleted_from_status = null
        voucher.bookkeeper_id = null
      }, 0)
    }

    if (
      normalized ===
      "UPDATE vouchers SET status = ?, deleted_from_status = NULL, updated_at = datetime('now') WHERE id = ?"
    ) {
      return {
        all: () => [],
        run: (status, voucherId) => {
          const voucher = this.vouchers.find((item) => item.id === Number(voucherId))
          if (!voucher) {
            return { changes: 0 }
          }
          voucher.status = Number(status)
          voucher.deleted_from_status = null
          return { changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM vouchers WHERE id = ?') {
      return {
        all: () => [],
        run: (voucherId) => {
          const before = this.vouchers.length
          this.vouchers = this.vouchers.filter((voucher) => voucher.id !== Number(voucherId))
          return { changes: before === this.vouchers.length ? 0 : 1 }
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeVoucherBatchDb: ${normalized}`)
  }

  transaction<T>(callback: () => T): () => T {
    return () => callback()
  }

  private createUpdater(
    apply: (voucher: VoucherBatchTarget, ...prefixArgs: unknown[]) => void,
    prefixArgCount = 1
  ): {
    all: (...args: unknown[]) => unknown[]
    run: (...args: unknown[]) => { changes: number }
  } {
    return {
      all: () => [],
      run: (...args) => {
        const voucherId = Number(args[prefixArgCount])
        const voucher = this.vouchers.find((item) => item.id === voucherId)
        if (!voucher) {
          return { changes: 0 }
        }
        apply(voucher, ...args.slice(0, prefixArgCount))
        return { changes: 1 }
      }
    }
  }
}

describe('voucherBatchLifecycle service', () => {
  it.each<[VoucherBatchAction, number, boolean]>([
    ['audit', 0, true],
    ['audit', 1, false],
    ['bookkeep', 1, true],
    ['unbookkeep', 2, true],
    ['delete', 1, true],
    ['restoreDelete', 3, true],
    ['purgeDelete', 3, true]
  ])('checks %s eligibility for status %s', (action, status, expected) => {
    expect(isVoucherEligibleForBatchAction(action, status)).toBe(expected)
  })

  it('lists targets and splits applicable vouchers', () => {
    const db = new FakeVoucherBatchDb()
    db.vouchers = [
      {
        id: 1,
        status: 0,
        deleted_from_status: null,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: null,
        bookkeeper_id: null
      },
      {
        id: 2,
        status: 1,
        deleted_from_status: null,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: null,
        bookkeeper_id: null
      }
    ]

    const targets = listVoucherBatchTargets(db as never, [1, 2])
    const split = splitVouchersByBatchAction('audit', targets)

    expect(targets.map((target) => target.id)).toEqual([1, 2])
    expect(split.applicable.map((target) => target.id)).toEqual([1])
    expect(split.skipped.map((target) => target.id)).toEqual([2])
  })

  it('applies audit and unbookkeep actions', () => {
    const db = new FakeVoucherBatchDb()
    db.vouchers = [
      {
        id: 1,
        status: 0,
        deleted_from_status: null,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: null,
        bookkeeper_id: null
      },
      {
        id: 2,
        status: 2,
        deleted_from_status: null,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: 5,
        bookkeeper_id: 6
      }
    ]

    const auditResult = applyVoucherBatchAction(db as never, 'audit', [db.vouchers[0]], 99, null)
    expect(auditResult.applicable).toHaveLength(1)
    expect(db.vouchers[0]).toMatchObject({
      status: 1,
      auditor_id: 99
    })

    const reversalResult = applyVoucherBatchAction(
      db as never,
      'unbookkeep',
      [db.vouchers[1]],
      77,
      {
        reason: '冲销调整',
        approvalTag: '审批-1'
      }
    )
    expect(reversalResult.applicable).toHaveLength(1)
    expect(db.vouchers[1]).toMatchObject({
      status: 1,
      bookkeeper_id: null
    })
  })

  it('applies delete, restore and purge actions', () => {
    const db = new FakeVoucherBatchDb()
    db.vouchers = [
      {
        id: 1,
        status: 1,
        deleted_from_status: null,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: 9,
        bookkeeper_id: null
      },
      {
        id: 2,
        status: 3,
        deleted_from_status: 1,
        ledger_id: 1,
        period: '2026-03',
        voucher_word: '记',
        auditor_id: 9,
        bookkeeper_id: null
      }
    ]

    applyVoucherBatchAction(db as never, 'delete', [db.vouchers[0]], 1, null)
    expect(db.vouchers[0]).toMatchObject({
      status: 3,
      deleted_from_status: 1
    })

    applyVoucherBatchAction(db as never, 'restoreDelete', [db.vouchers[1]], 1, null)
    expect(db.vouchers[1]).toMatchObject({
      status: 1,
      deleted_from_status: null,
      bookkeeper_id: null
    })

    applyVoucherBatchAction(db as never, 'purgeDelete', [db.vouchers[0]], 1, null)
    expect(db.vouchers.map((voucher) => voucher.id)).toEqual([2])
  })
})

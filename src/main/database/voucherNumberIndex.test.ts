import { describe, expect, it } from 'vitest'
import { ensureVoucherActiveNumberIndex } from './init'

interface VoucherIndexRow {
  ledger_id: number
  period: string
  voucher_word: string
  voucher_number: number
  status: number
}

interface FakeIndexState {
  unique: boolean
  activeOnly: boolean
}

class FakeVoucherIndexDb {
  vouchers: VoucherIndexRow[] = []
  indexes = new Map<string, FakeIndexState>()

  prepare(sql: string) {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim()

    if (normalizedSql.startsWith('SELECT ledger_id, period, voucher_word, voucher_number')) {
      return {
        get: () => this.findActiveDuplicate()
      }
    }

    if (normalizedSql === 'DROP INDEX IF EXISTS idx_vouchers_unique_number') {
      return {
        run: () => {
          this.indexes.delete('idx_vouchers_unique_number')
        }
      }
    }

    if (
      normalizedSql.startsWith(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_vouchers_unique_active_number'
      )
    ) {
      return {
        run: () => {
          this.indexes.set('idx_vouchers_unique_active_number', {
            unique: true,
            activeOnly: normalizedSql.includes('WHERE status <> 3')
          })
        }
      }
    }

    throw new Error(`Unexpected SQL in fake voucher index db: ${normalizedSql}`)
  }

  insertVoucher(row: VoucherIndexRow): void {
    const activeIndex = this.indexes.get('idx_vouchers_unique_active_number')
    if (activeIndex?.unique && row.status !== 3) {
      const conflict = this.vouchers.find(
        (item) =>
          item.status !== 3 &&
          item.ledger_id === row.ledger_id &&
          item.period === row.period &&
          item.voucher_word === row.voucher_word &&
          item.voucher_number === row.voucher_number
      )
      if (conflict) {
        throw new Error('UNIQUE constraint failed: vouchers active number')
      }
    }

    this.vouchers.push(row)
  }

  private findActiveDuplicate():
    | {
        ledger_id: number
        period: string
        voucher_word: string
        voucher_number: number
        count: number
      }
    | undefined {
    const counts = new Map<string, { row: VoucherIndexRow; count: number }>()
    for (const row of this.vouchers) {
      if (row.status === 3) {
        continue
      }
      const key = [row.ledger_id, row.period, row.voucher_word, row.voucher_number].join('\0')
      const existing = counts.get(key)
      counts.set(key, {
        row,
        count: (existing?.count ?? 0) + 1
      })
    }

    for (const item of counts.values()) {
      if (item.count > 1) {
        return {
          ledger_id: item.row.ledger_id,
          period: item.row.period,
          voucher_word: item.row.voucher_word,
          voucher_number: item.row.voucher_number,
          count: item.count
        }
      }
    }

    return undefined
  }
}

function insertRow(db: FakeVoucherIndexDb, status: number): void {
  db.insertVoucher({
    ledger_id: 1,
    period: '2026-01',
    voucher_word: '记',
    voucher_number: 1,
    status
  })
}

describe('voucher active number index migration', () => {
  it('creates an active-only unique index that allows deleted vouchers to keep historical numbers', () => {
    const db = new FakeVoucherIndexDb()
    ensureVoucherActiveNumberIndex(db as never)

    insertRow(db, 0)
    insertRow(db, 3)

    expect(() => insertRow(db, 1)).toThrow('UNIQUE constraint failed')
  })

  it('replaces the legacy full unique index with the active-only index', () => {
    const db = new FakeVoucherIndexDb()
    db.indexes.set('idx_vouchers_unique_number', {
      unique: true,
      activeOnly: false
    })

    ensureVoucherActiveNumberIndex(db as never)

    expect(db.indexes.has('idx_vouchers_unique_number')).toBe(false)
    expect(db.indexes.get('idx_vouchers_unique_active_number')).toEqual({
      unique: true,
      activeOnly: true
    })
  })

  it('stops safely when active vouchers already have duplicate numbers', () => {
    const db = new FakeVoucherIndexDb()
    db.vouchers.push(
      {
        ledger_id: 1,
        period: '2026-01',
        voucher_word: '记',
        voucher_number: 1,
        status: 0
      },
      {
        ledger_id: 1,
        period: '2026-01',
        voucher_word: '记',
        voucher_number: 1,
        status: 1
      }
    )

    expect(() => ensureVoucherActiveNumberIndex(db as never)).toThrow('有效凭证存在重复编号')
    expect(db.indexes.has('idx_vouchers_unique_active_number')).toBe(false)
  })
})

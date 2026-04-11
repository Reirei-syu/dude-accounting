import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPLCarryForwardCompleted,
  executePLCarryForward,
  listPLCarryForwardRules,
  savePLCarryForwardRules,
  previewPLCarryForward
} from './plCarryForward'

type LedgerRow = {
  id: number
  name: string
  standard_type: string
  start_period: string
  current_period: string
}

type SubjectRow = {
  id: number
  ledger_id: number
  code: string
  name: string
  category: string
  balance_direction: number
}

type RuleRow = {
  id: number
  ledger_id: number
  from_subject_code: string
  to_subject_code: string
}

type VoucherRow = {
  id: number
  ledger_id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: number
  creator_id: number | null
  auditor_id: number | null
  bookkeeper_id: number | null
  is_carry_forward: number
}

type VoucherEntryRow = {
  id: number
  voucher_id: number
  row_order: number
  summary: string
  subject_code: string
  debit_amount: number
  credit_amount: number
}

type SettingRow = {
  key: string
  value: string
}

class FakeDatabase {
  ledgers: LedgerRow[] = []
  subjects: SubjectRow[] = []
  rules: RuleRow[] = []
  vouchers: VoucherRow[] = []
  voucherEntries: VoucherEntryRow[] = []
  systemSettings: SettingRow[] = []

  private nextSubjectId = 1
  private nextRuleId = 1
  private nextVoucherId = 1
  private nextEntryId = 1

  seedLedger(row: LedgerRow): void {
    this.ledgers.push(row)
  }

  seedSetting(key: string, value: string): void {
    const existing = this.systemSettings.find((item) => item.key === key)
    if (existing) {
      existing.value = value
      return
    }
    this.systemSettings.push({ key, value })
  }

  insertSubject(
    ledgerId: number,
    code: string,
    name: string,
    category: string,
    balanceDirection: number
  ): void {
    this.subjects.push({
      id: this.nextSubjectId++,
      ledger_id: ledgerId,
      code,
      name,
      category,
      balance_direction: balanceDirection
    })
  }

  insertRule(ledgerId: number, fromSubjectCode: string, toSubjectCode: string): void {
    this.rules.push({
      id: this.nextRuleId++,
      ledger_id: ledgerId,
      from_subject_code: fromSubjectCode,
      to_subject_code: toSubjectCode
    })
  }

  insertVoucher(data: {
    ledgerId: number
    period: string
    voucherDate: string
    voucherNumber: number
    voucherWord?: string
    status: number
    isCarryForward?: boolean
    entries: Array<{
      subjectCode: string
      debitAmount: number
      creditAmount: number
      summary?: string
    }>
  }): number {
    const voucherId = this.nextVoucherId++
    this.vouchers.push({
      id: voucherId,
      ledger_id: data.ledgerId,
      period: data.period,
      voucher_date: data.voucherDate,
      voucher_number: data.voucherNumber,
      voucher_word: data.voucherWord ?? '记',
      status: data.status,
      creator_id: 1,
      auditor_id: 1,
      bookkeeper_id: 1,
      is_carry_forward: data.isCarryForward ? 1 : 0
    })

    data.entries.forEach((entry, index) => {
      this.voucherEntries.push({
        id: this.nextEntryId++,
        voucher_id: voucherId,
        row_order: index + 1,
        summary: entry.summary ?? '测试分录',
        subject_code: entry.subjectCode,
        debit_amount: entry.debitAmount,
        credit_amount: entry.creditAmount
      })
    })

    return voucherId
  }

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => { lastInsertRowid?: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT id FROM ledgers WHERE id = ?') {
      return {
        get: (ledgerId) => this.ledgers.find((item) => item.id === Number(ledgerId)),
        all: () => [],
        run: () => ({})
      }
    }

    if (normalized === 'SELECT id, standard_type FROM ledgers WHERE id = ?') {
      return {
        get: (ledgerId) => this.ledgers.find((item) => item.id === Number(ledgerId)),
        all: () => [],
        run: () => ({})
      }
    }

    if (normalized === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key) => this.systemSettings.find((item) => item.key === String(key)),
        all: () => [],
        run: () => ({})
      }
    }

    if (
      normalized.includes('FROM pl_carry_forward_rules r') &&
      normalized.includes('ORDER BY r.from_subject_code ASC, r.to_subject_code ASC') &&
      !normalized.includes('COALESCE(SUM(ve.debit_amount), 0) AS debit_sum')
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) => {
          const currentLedgerId = Number(ledgerId)
          return this.rules
            .filter((item) => item.ledger_id === currentLedgerId)
            .slice()
            .sort((left, right) => {
              const byFrom = left.from_subject_code.localeCompare(right.from_subject_code)
              return byFrom !== 0
                ? byFrom
                : left.to_subject_code.localeCompare(right.to_subject_code)
            })
            .map((rule) => {
              const fromSubject = this.subjects.find(
                (subject) =>
                  subject.ledger_id === currentLedgerId && subject.code === rule.from_subject_code
              )
              const toSubject = this.subjects.find(
                (subject) =>
                  subject.ledger_id === currentLedgerId && subject.code === rule.to_subject_code
              )
              return {
                id: rule.id,
                from_subject_code: rule.from_subject_code,
                from_subject_name: fromSubject?.name ?? '',
                to_subject_code: rule.to_subject_code,
                to_subject_name: toSubject?.name ?? ''
              }
            })
        },
        run: () => ({})
      }
    }

    if (
      normalized.includes('FROM subjects s') &&
      normalized.includes('EXISTS ( SELECT 1 FROM subjects child')
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) => {
          const currentLedgerId = Number(ledgerId)
          return this.subjects
            .filter((subject) => subject.ledger_id === currentLedgerId)
            .slice()
            .sort((left, right) => left.code.localeCompare(right.code))
            .map((subject) => ({
              code: subject.code,
              name: subject.name,
              category: subject.category,
              has_children: this.subjects.some(
                (child) =>
                  child.ledger_id === currentLedgerId &&
                  child.code !== subject.code &&
                  child.code.startsWith(subject.code)
              )
                ? 1
                : 0
            }))
        },
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT id, from_subject_code, to_subject_code FROM pl_carry_forward_rules WHERE ledger_id = ? ORDER BY from_subject_code ASC, id ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.rules
            .filter((item) => item.ledger_id === Number(ledgerId))
            .slice()
            .sort((left, right) => {
              const byFrom = left.from_subject_code.localeCompare(right.from_subject_code)
              return byFrom !== 0 ? byFrom : left.id - right.id
            })
            .map((rule) => ({
              id: rule.id,
              from_subject_code: rule.from_subject_code,
              to_subject_code: rule.to_subject_code
            })),
        run: () => ({})
      }
    }

    if (
      normalized.includes('ve.subject_code AS subject_code') &&
      normalized.includes('FROM vouchers v') &&
      normalized.includes('INNER JOIN voucher_entries ve')
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, period) => {
          const currentLedgerId = Number(ledgerId)
          const currentPeriod = String(period)
          const includeUnpostedVouchers = !normalized.includes('AND v.status = 2')
          const eligibleVoucherIds = new Set(
            this.vouchers
              .filter(
                (voucher) =>
                  voucher.ledger_id === currentLedgerId &&
                  voucher.period === currentPeriod &&
                  voucher.is_carry_forward === 0 &&
                  (includeUnpostedVouchers || voucher.status === 2)
              )
              .map((voucher) => voucher.id)
          )

          const movementBySubjectCode = new Map<
            string,
            { subject_code: string; subject_name: string; debit_sum: number; credit_sum: number }
          >()

          this.voucherEntries
            .filter((entry) => eligibleVoucherIds.has(entry.voucher_id))
            .forEach((entry) => {
              const current = movementBySubjectCode.get(entry.subject_code)
              if (current) {
                current.debit_sum += entry.debit_amount
                current.credit_sum += entry.credit_amount
                return
              }

              movementBySubjectCode.set(entry.subject_code, {
                subject_code: entry.subject_code,
                subject_name:
                  this.subjects.find(
                    (subject) =>
                      subject.ledger_id === currentLedgerId && subject.code === entry.subject_code
                  )?.name ?? '',
                debit_sum: entry.debit_amount,
                credit_sum: entry.credit_amount
              })
            })

          return [...movementBySubjectCode.values()].sort((left, right) =>
            left.subject_code.localeCompare(right.subject_code)
          )
        },
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT id, voucher_number, voucher_date, status FROM vouchers WHERE ledger_id = ? AND period = ? AND is_carry_forward = 1 ORDER BY id ASC'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, period) =>
          this.vouchers
            .filter(
              (voucher) =>
                voucher.ledger_id === Number(ledgerId) &&
                voucher.period === String(period) &&
                voucher.is_carry_forward === 1
            )
            .slice()
            .sort((left, right) => left.id - right.id)
            .map((voucher) => ({
              id: voucher.id,
              voucher_number: voucher.voucher_number,
              voucher_date: voucher.voucher_date,
              status: voucher.status
            })),
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
    ) {
      return {
        get: (ledgerId, period) => ({
          max_num: this.vouchers
            .filter(
              (voucher) =>
                voucher.ledger_id === Number(ledgerId) && voucher.period === String(period)
            )
            .reduce((max, voucher) => Math.max(max, voucher.voucher_number), 0)
        }),
        all: () => [],
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ? AND voucher_word = ?'
    ) {
      return {
        get: (ledgerId, period, voucherWord) => ({
          max_num: this.vouchers
            .filter(
              (voucher) =>
                voucher.ledger_id === Number(ledgerId) &&
                voucher.period === String(period) &&
                voucher.voucher_word === String(voucherWord)
            )
            .reduce((max, voucher) => Math.max(max, voucher.voucher_number), 0)
        }),
        all: () => [],
        run: () => ({})
      }
    }

    if (normalized.startsWith('DELETE FROM voucher_entries WHERE voucher_id IN (')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...voucherIds) => {
          const targetIds = new Set(voucherIds.map((id) => Number(id)))
          this.voucherEntries = this.voucherEntries.filter(
            (entry) => !targetIds.has(entry.voucher_id)
          )
          return {}
        }
      }
    }

    if (normalized === 'DELETE FROM pl_carry_forward_rules WHERE ledger_id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (ledgerId) => {
          this.rules = this.rules.filter((rule) => rule.ledger_id !== Number(ledgerId))
          return {}
        }
      }
    }

    if (normalized.startsWith('DELETE FROM vouchers WHERE id IN (')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (...voucherIds) => {
          const targetIds = new Set(voucherIds.map((id) => Number(id)))
          this.vouchers = this.vouchers.filter((voucher) => !targetIds.has(voucher.id))
          return {}
        }
      }
    }

    if (normalized.startsWith('INSERT INTO vouchers (')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          ledgerId,
          period,
          voucherDate,
          voucherNumber,
          voucherWord,
          status,
          creatorId,
          auditorId,
          bookkeeperId
        ) => {
          const voucherId = this.nextVoucherId++
          this.vouchers.push({
            id: voucherId,
            ledger_id: Number(ledgerId),
            period: String(period),
            voucher_date: String(voucherDate),
            voucher_number: Number(voucherNumber),
            voucher_word: String(voucherWord),
            status: Number(status),
            creator_id: creatorId === null ? null : Number(creatorId),
            auditor_id: auditorId === null ? null : Number(auditorId),
            bookkeeper_id: bookkeeperId === null ? null : Number(bookkeeperId),
            is_carry_forward: 1
          })
          return { lastInsertRowid: voucherId }
        }
      }
    }

    if (normalized.startsWith('INSERT INTO voucher_entries (')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (voucherId, rowOrder, summary, subjectCode, debitAmount, creditAmount) => {
          this.voucherEntries.push({
            id: this.nextEntryId++,
            voucher_id: Number(voucherId),
            row_order: Number(rowOrder),
            summary: String(summary),
            subject_code: String(subjectCode),
            debit_amount: Number(debitAmount),
            credit_amount: Number(creditAmount)
          })
          return {}
        }
      }
    }

    if (normalized.startsWith('INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code) VALUES (?, ?, ?)')) {
      return {
        get: () => undefined,
        all: () => [],
        run: (ledgerId, fromSubjectCode, toSubjectCode) => {
          this.rules.push({
            id: this.nextRuleId++,
            ledger_id: Number(ledgerId),
            from_subject_code: String(fromSubjectCode),
            to_subject_code: String(toSubjectCode)
          })
          return {}
        }
      }
    }

    throw new Error(`Unhandled SQL in fake database: ${normalized}`)
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult
  ): (...args: TArgs) => TResult {
    return (...args: TArgs) => fn(...args)
  }

  close(): void {
    // no-op
  }
}

type TestDb = FakeDatabase

function createTestDb(): TestDb {
  const db = new FakeDatabase()
  db.seedLedger({
    id: 1,
    name: '企业账套',
    standard_type: 'enterprise',
    start_period: '2026-01',
    current_period: '2026-03'
  })
  db.seedLedger({
    id: 2,
    name: '民非账套',
    standard_type: 'npo',
    start_period: '2026-01',
    current_period: '2026-03'
  })
  db.seedSetting('allow_same_maker_auditor', '0')
  return db
}

function seedSubject(
  db: TestDb,
  ledgerId: number,
  code: string,
  name: string,
  category: string,
  balanceDirection: number
): void {
  db.insertSubject(ledgerId, code, name, category, balanceDirection)
}

function seedRule(
  db: TestDb,
  ledgerId: number,
  fromSubjectCode: string,
  toSubjectCode: string
): void {
  db.insertRule(ledgerId, fromSubjectCode, toSubjectCode)
}

function insertVoucher(
  db: TestDb,
  data: {
    ledgerId: number
    period: string
    voucherDate: string
    voucherNumber: number
    voucherWord?: string
    status: number
    isCarryForward?: boolean
    entries: Array<{
      subjectCode: string
      debitAmount: number
      creditAmount: number
      summary?: string
    }>
  }
): number {
  return db.insertVoucher(data)
}

describe('pl carry forward service', () => {
  const openDbs: TestDb[] = []

  afterEach(() => {
    while (openDbs.length > 0) {
      openDbs.pop()?.close()
    }
  })

  it('lists carry-forward rules for the current ledger', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')
    seedRule(db, 1, '6602', '4103')

    const rules = listPLCarryForwardRules(db as never, 1)

    expect(rules).toEqual([
      {
        id: expect.any(Number),
        fromSubjectCode: '6001',
        fromSubjectName: '主营业务收入',
        toSubjectCode: '4103',
        toSubjectName: '本年利润'
      },
      {
        id: expect.any(Number),
        fromSubjectCode: '6602',
        fromSubjectName: '管理费用',
        toSubjectCode: '4103',
        toSubjectName: '本年利润'
      }
    ])
  })

  it('filters duplicate legacy parent rules when listing carry-forward rules', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 2, '4101', '捐赠收入', 'income', -1)
    seedSubject(db, 2, '410101', '捐赠收入-非限定性', 'income', -1)
    seedSubject(db, 2, '410102', '捐赠收入-限定性', 'income', -1)
    seedSubject(db, 2, '3101', '非限定性净资产', 'net_assets', -1)
    seedSubject(db, 2, '3102', '限定性净资产', 'net_assets', -1)
    seedRule(db, 2, '4101', '3101')
    seedRule(db, 2, '4101', '3101')
    seedRule(db, 2, '410101', '3101')
    seedRule(db, 2, '410102', '3102')

    const rules = listPLCarryForwardRules(db as never, 2)

    expect(rules).toEqual([
      {
        id: expect.any(Number),
        fromSubjectCode: '410101',
        fromSubjectName: '捐赠收入-非限定性',
        toSubjectCode: '3101',
        toSubjectName: '非限定性净资产'
      },
      {
        id: expect.any(Number),
        fromSubjectCode: '410102',
        fromSubjectName: '捐赠收入-限定性',
        toSubjectCode: '3102',
        toSubjectName: '限定性净资产'
      }
    ])
  })

  it('auto-fills a missing sibling leaf rule when the parent only keeps descendant rules', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '600101', '主业1', 'profit_loss', -1)
    seedSubject(db, 1, '600102', '主业2', 'profit_loss', -1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '600101', '4103')

    const preview = previewPLCarryForward(db as never, { ledgerId: 1, period: '2026-03' })

    expect(preview.required).toBe(false)
    expect(
      db.rules
        .filter((rule) => rule.ledger_id === 1)
        .map((rule) => ({
          from_subject_code: rule.from_subject_code,
          to_subject_code: rule.to_subject_code
        }))
        .sort((left, right) => left.from_subject_code.localeCompare(right.from_subject_code))
    ).toEqual([
      { from_subject_code: '600101', to_subject_code: '4103' },
      { from_subject_code: '600102', to_subject_code: '4103' }
    ])
  })

  it('saves a complete rule set and replaces previous mappings', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedSubject(db, 1, '410301', '本年利润-经营结转', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    savePLCarryForwardRules(db as never, {
      ledgerId: 1,
      rules: [
        { fromSubjectCode: '6001', toSubjectCode: '410301' },
        { fromSubjectCode: '6602', toSubjectCode: '410301' }
      ]
    })

    expect(
      db.rules
        .filter((rule) => rule.ledger_id === 1)
        .map((rule) => ({
          from_subject_code: rule.from_subject_code,
          to_subject_code: rule.to_subject_code
        }))
        .sort((left, right) => left.from_subject_code.localeCompare(right.from_subject_code))
    ).toEqual([
      {
        from_subject_code: '6001',
        to_subject_code: '410301'
      },
      {
        from_subject_code: '6602',
        to_subject_code: '410301'
      }
    ])
  })

  it('rejects saving when a leaf profit-loss subject has no configured rule', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)

    expect(() =>
      savePLCarryForwardRules(db as never, {
        ledgerId: 1,
        rules: [{ fromSubjectCode: '6001', toSubjectCode: '4103' }]
      })
    ).toThrow('以下损益科目尚未配置结转目标：6602 管理费用')
  })

  it('prevents preview when carry-forward rules are incomplete', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-05',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 10000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 10000 }
      ]
    })

    expect(() => previewPLCarryForward(db as never, { ledgerId: 1, period: '2026-03' })).toThrow(
      '以下损益科目尚未配置结转目标：6602 管理费用'
    )
  })

  it('previews successfully when duplicate parent rules exist but leaf rules are complete', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 2, '1002', '银行存款', 'asset', 1)
    seedSubject(db, 2, '4101', '捐赠收入', 'income', -1)
    seedSubject(db, 2, '410101', '捐赠收入-非限定性', 'income', -1)
    seedSubject(db, 2, '410102', '捐赠收入-限定性', 'income', -1)
    seedSubject(db, 2, '3101', '非限定性净资产', 'net_assets', -1)
    seedSubject(db, 2, '3102', '限定性净资产', 'net_assets', -1)
    seedRule(db, 2, '4101', '3101')
    seedRule(db, 2, '4101', '3101')
    seedRule(db, 2, '410101', '3101')
    seedRule(db, 2, '410102', '3102')

    insertVoucher(db, {
      ledgerId: 2,
      period: '2026-03',
      voucherDate: '2026-03-08',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1002', debitAmount: 50000, creditAmount: 0 },
        { subjectCode: '410101', debitAmount: 0, creditAmount: 50000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 2,
      period: '2026-03',
      voucherDate: '2026-03-12',
      voucherNumber: 2,
      status: 2,
      entries: [
        { subjectCode: '1002', debitAmount: 20000, creditAmount: 0 },
        { subjectCode: '410102', debitAmount: 0, creditAmount: 20000 }
      ]
    })

    const preview = previewPLCarryForward(db as never, { ledgerId: 2, period: '2026-03' })

    expect(preview.required).toBe(true)
    expect(preview.totalDebit).toBe(70000)
    expect(preview.totalCredit).toBe(70000)
    expect(preview.entries).toEqual([
      {
        summary: '期末损益结转',
        subjectCode: '410101',
        subjectName: '捐赠收入-非限定性',
        debitAmount: 50000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '410102',
        subjectName: '捐赠收入-限定性',
        debitAmount: 20000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '3101',
        subjectName: '非限定性净资产',
        debitAmount: 0,
        creditAmount: 50000
      },
      {
        summary: '期末损益结转',
        subjectCode: '3102',
        subjectName: '限定性净资产',
        debitAmount: 0,
        creditAmount: 20000
      }
    ])
  })

  it('previews enterprise carry-forward entries for the selected period', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '1002', '银行存款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')
    seedRule(db, 1, '6602', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-10',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 120000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 120000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-18',
      voucherNumber: 2,
      status: 2,
      entries: [
        { subjectCode: '6602', debitAmount: 45000, creditAmount: 0 },
        { subjectCode: '1002', debitAmount: 0, creditAmount: 45000 }
      ]
    })

    const preview = previewPLCarryForward(db as never, { ledgerId: 1, period: '2026-03' })

    expect(preview.required).toBe(true)
    expect(preview.canExecute).toBe(true)
    expect(preview.voucherDate).toBe('2026-03-31')
    expect(preview.totalDebit).toBe(165000)
    expect(preview.totalCredit).toBe(165000)
    expect(preview.entries).toEqual([
      {
        summary: '期末损益结转',
        subjectCode: '6001',
        subjectName: '主营业务收入',
        debitAmount: 120000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '6602',
        subjectName: '管理费用',
        debitAmount: 0,
        creditAmount: 45000
      },
      {
        summary: '期末损益结转',
        subjectCode: '4103',
        subjectName: '本年利润',
        debitAmount: 45000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '4103',
        subjectName: '本年利润',
        debitAmount: 0,
        creditAmount: 120000
      }
    ])
  })

  it('defaults to posted vouchers and expands to all statuses when requested', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '1002', '银行存款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '6602', '管理费用', 'profit_loss', 1)
    seedSubject(db, 1, '6603', '财务费用', 'profit_loss', 1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')
    seedRule(db, 1, '6602', '4103')
    seedRule(db, 1, '6603', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-08',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 50000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 50000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-12',
      voucherNumber: 2,
      status: 1,
      entries: [
        { subjectCode: '6602', debitAmount: 12000, creditAmount: 0 },
        { subjectCode: '1002', debitAmount: 0, creditAmount: 12000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-18',
      voucherNumber: 3,
      status: 0,
      entries: [
        { subjectCode: '6603', debitAmount: 8000, creditAmount: 0 },
        { subjectCode: '1002', debitAmount: 0, creditAmount: 8000 }
      ]
    })

    const defaultPreview = previewPLCarryForward(db as never, {
      ledgerId: 1,
      period: '2026-03'
    })
    const expandedPreview = previewPLCarryForward(db as never, {
      ledgerId: 1,
      period: '2026-03',
      includeUnpostedVouchers: true
    })

    expect(defaultPreview.includeUnpostedVouchers).toBe(false)
    expect(defaultPreview.totalDebit).toBe(50000)
    expect(defaultPreview.totalCredit).toBe(50000)
    expect(defaultPreview.entries).toHaveLength(2)

    expect(expandedPreview.includeUnpostedVouchers).toBe(true)
    expect(expandedPreview.totalDebit).toBe(70000)
    expect(expandedPreview.totalCredit).toBe(70000)
    expect(expandedPreview.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectCode: '6602',
          creditAmount: 12000
        }),
        expect.objectContaining({
          subjectCode: '6603',
          creditAmount: 8000
        }),
        expect.objectContaining({
          subjectCode: '4103',
          debitAmount: 20000
        })
      ])
    )
  })

  it('previews NPO carry-forward entries against the correct net-asset targets', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 2, '1002', '银行存款', 'asset', 1)
    seedSubject(db, 2, '410101', '捐赠收入-非限定性', 'income', -1)
    seedSubject(db, 2, '410102', '捐赠收入-限定性', 'income', -1)
    seedSubject(db, 2, '5101', '业务活动成本', 'expense', 1)
    seedSubject(db, 2, '3101', '非限定性净资产', 'net_assets', -1)
    seedSubject(db, 2, '3102', '限定性净资产', 'net_assets', -1)
    seedRule(db, 2, '410101', '3101')
    seedRule(db, 2, '410102', '3102')
    seedRule(db, 2, '5101', '3101')

    insertVoucher(db, {
      ledgerId: 2,
      period: '2026-03',
      voucherDate: '2026-03-08',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1002', debitAmount: 50000, creditAmount: 0 },
        { subjectCode: '410101', debitAmount: 0, creditAmount: 50000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 2,
      period: '2026-03',
      voucherDate: '2026-03-12',
      voucherNumber: 2,
      status: 2,
      entries: [
        { subjectCode: '1002', debitAmount: 20000, creditAmount: 0 },
        { subjectCode: '410102', debitAmount: 0, creditAmount: 20000 }
      ]
    })
    insertVoucher(db, {
      ledgerId: 2,
      period: '2026-03',
      voucherDate: '2026-03-20',
      voucherNumber: 3,
      status: 2,
      entries: [
        { subjectCode: '5101', debitAmount: 12000, creditAmount: 0 },
        { subjectCode: '1002', debitAmount: 0, creditAmount: 12000 }
      ]
    })

    const preview = previewPLCarryForward(db as never, { ledgerId: 2, period: '2026-03' })

    expect(preview.entries).toEqual([
      {
        summary: '期末损益结转',
        subjectCode: '410101',
        subjectName: '捐赠收入-非限定性',
        debitAmount: 50000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '410102',
        subjectName: '捐赠收入-限定性',
        debitAmount: 20000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '5101',
        subjectName: '业务活动成本',
        debitAmount: 0,
        creditAmount: 12000
      },
      {
        summary: '期末损益结转',
        subjectCode: '3101',
        subjectName: '非限定性净资产',
        debitAmount: 12000,
        creditAmount: 0
      },
      {
        summary: '期末损益结转',
        subjectCode: '3101',
        subjectName: '非限定性净资产',
        debitAmount: 0,
        creditAmount: 50000
      },
      {
        summary: '期末损益结转',
        subjectCode: '3102',
        subjectName: '限定性净资产',
        debitAmount: 0,
        creditAmount: 20000
      }
    ])
  })

  it('rejects preview when the same leaf source keeps multiple carry-forward targets', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 2, '410101', '捐赠收入-非限定性', 'income', -1)
    seedSubject(db, 2, '3101', '非限定性净资产', 'net_assets', -1)
    seedSubject(db, 2, '3102', '限定性净资产', 'net_assets', -1)
    seedRule(db, 2, '410101', '3101')
    seedRule(db, 2, '410101', '3102')

    expect(() => previewPLCarryForward(db as never, { ledgerId: 2, period: '2026-03' })).toThrow(
      /410101.*3101.*3102/
    )
  })

  it('rebuilds draft carry-forward vouchers and auto-bookkeeps when the system setting allows it', () => {
    const db = createTestDb()
    openDbs.push(db)

    db.seedSetting('allow_same_maker_auditor', '1')

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-05',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 30000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 30000 }
      ]
    })

    const oldDraftId = insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-31',
      voucherNumber: 2,
      status: 0,
      isCarryForward: true,
      entries: [
        { subjectCode: '6001', debitAmount: 1, creditAmount: 0 },
        { subjectCode: '4103', debitAmount: 0, creditAmount: 1 }
      ]
    })

    const result = executePLCarryForward(db as never, {
      ledgerId: 1,
      period: '2026-03',
      operatorId: 9
    })

    expect(result.removedDraftVoucherIds).toEqual([oldDraftId])
    expect(result.status).toBe(2)
    expect(result.voucherDate).toBe('2026-03-31')

    const carryForwardVouchers = db.vouchers
      .filter(
        (voucher) =>
          voucher.ledger_id === 1 && voucher.period === '2026-03' && voucher.is_carry_forward === 1
      )
      .sort((left, right) => left.id - right.id)
      .map((voucher) => ({
        id: voucher.id,
        status: voucher.status,
        creator_id: voucher.creator_id,
        auditor_id: voucher.auditor_id,
        bookkeeper_id: voucher.bookkeeper_id
      }))

    expect(carryForwardVouchers).toEqual([
      {
        id: result.voucherId,
        status: 2,
        creator_id: 9,
        auditor_id: 9,
        bookkeeper_id: 9
      }
    ])
  })

  it('can execute carry-forward for unposted vouchers when the option is enabled', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-05',
      voucherNumber: 1,
      status: 0,
      entries: [
        { subjectCode: '1122', debitAmount: 24000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 24000 }
      ]
    })

    expect(() =>
      executePLCarryForward(db as never, {
        ledgerId: 1,
        period: '2026-03',
        operatorId: 9
      })
    ).toThrow('当前期间无可结转的损益金额')

    const result = executePLCarryForward(db as never, {
      ledgerId: 1,
      period: '2026-03',
      operatorId: 9,
      includeUnpostedVouchers: true
    })

    expect(result.status).toBe(0)
    expect(result.voucherNumber).toBe(1)
    expect(db.vouchers.find((voucher) => voucher.id === result.voucherId)?.is_carry_forward).toBe(1)
    expect(
      db.voucherEntries
        .filter((entry) => entry.voucher_id === result.voucherId)
        .map((entry) => ({
          subject_code: entry.subject_code,
          debit_amount: entry.debit_amount,
          credit_amount: entry.credit_amount
        }))
    ).toEqual([
      {
        subject_code: '6001',
        debit_amount: 24000,
        credit_amount: 0
      },
      {
        subject_code: '4103',
        debit_amount: 0,
        credit_amount: 24000
      }
    ])
  })

  it('starts carry-forward voucher numbers from 结-0001 instead of continuing 记字号', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-05',
      voucherNumber: 7,
      voucherWord: '记',
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 30_000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 30_000 }
      ]
    })

    const result = executePLCarryForward(db as never, {
      ledgerId: 1,
      period: '2026-03',
      operatorId: 9
    })

    const carryForwardVoucher = db.vouchers.find((voucher) => voucher.id === result.voucherId)
    expect(result.voucherNumber).toBe(1)
    expect(carryForwardVoucher?.voucher_word).toBe('结')
    expect(carryForwardVoucher?.voucher_number).toBe(1)
  })

  it('blocks rerun and period close until carry-forward has been completed with a posted voucher', () => {
    const db = createTestDb()
    openDbs.push(db)

    seedSubject(db, 1, '1122', '应收账款', 'asset', 1)
    seedSubject(db, 1, '6001', '主营业务收入', 'profit_loss', -1)
    seedSubject(db, 1, '4103', '本年利润', 'equity', -1)
    seedRule(db, 1, '6001', '4103')

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-03',
      voucherNumber: 1,
      status: 2,
      entries: [
        { subjectCode: '1122', debitAmount: 18000, creditAmount: 0 },
        { subjectCode: '6001', debitAmount: 0, creditAmount: 18000 }
      ]
    })

    insertVoucher(db, {
      ledgerId: 1,
      period: '2026-03',
      voucherDate: '2026-03-31',
      voucherNumber: 2,
      status: 1,
      isCarryForward: true,
      entries: [
        { subjectCode: '6001', debitAmount: 18000, creditAmount: 0 },
        { subjectCode: '4103', debitAmount: 0, creditAmount: 18000 }
      ]
    })

    const preview = previewPLCarryForward(db as never, { ledgerId: 1, period: '2026-03' })
    expect(preview.canExecute).toBe(false)
    expect(preview.blockedReason).toContain('已审核')

    expect(() =>
      executePLCarryForward(db as never, { ledgerId: 1, period: '2026-03', operatorId: 9 })
    ).toThrow('当前期间已存在已审核或已记账的损益结转凭证')

    expect(() =>
      assertPLCarryForwardCompleted(db as never, { ledgerId: 1, period: '2026-03' })
    ).toThrow('当前期间损益结转凭证尚未记账，不能结账')
  })
})

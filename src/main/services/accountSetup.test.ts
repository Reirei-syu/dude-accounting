import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAuxiliaryItem,
  createSubject,
  deleteAuxiliaryItem,
  listAuxiliaryItems,
  listSubjects,
  updateAuxiliaryItem,
  updateSubject
} from './accountSetup'

type LedgerRow = {
  id: number
  name: string
  standard_type: string
}

type SubjectRow = {
  id: number
  ledger_id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  balance_direction: number
  has_auxiliary: number
  is_cash_flow: number
  level: number
  is_system: number
}

type SubjectAuxiliaryCategoryRow = {
  id: number
  subject_id: number
  category: string
}

type SubjectAuxiliaryCustomItemRow = {
  id: number
  subject_id: number
  auxiliary_item_id: number
}

type AuxiliaryItemRow = {
  id: number
  ledger_id: number
  category: string
  code: string
  name: string
}

type VoucherEntryRow = {
  id: number
  auxiliary_item_id: number | null
}

class FakeDatabase {
  ledgers: LedgerRow[] = []
  subjects: SubjectRow[] = []
  subjectAuxiliaryCategories: SubjectAuxiliaryCategoryRow[] = []
  subjectAuxiliaryCustomItems: SubjectAuxiliaryCustomItemRow[] = []
  auxiliaryItems: AuxiliaryItemRow[] = []
  voucherEntries: VoucherEntryRow[] = []

  private nextSubjectId = 10
  private nextSubjectAuxiliaryCategoryId = 10
  private nextSubjectAuxiliaryCustomItemId = 10
  private nextAuxiliaryItemId = 10

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

    if (normalized === 'SELECT * FROM subjects WHERE id = ?') {
      return {
        get: (subjectId) => this.subjects.find((item) => item.id === Number(subjectId)),
        all: () => [],
        run: () => ({})
      }
    }

    if (normalized === 'SELECT * FROM subjects WHERE ledger_id = ? ORDER BY code') {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.subjects
            .filter((item) => item.ledger_id === Number(ledgerId))
            .slice()
            .sort((left, right) => left.code.localeCompare(right.code)),
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT sac.subject_id, sac.category FROM subject_auxiliary_categories sac INNER JOIN subjects s ON s.id = sac.subject_id WHERE s.ledger_id = ? ORDER BY sac.category'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) => {
          const subjectIds = new Set(
            this.subjects
              .filter((item) => item.ledger_id === Number(ledgerId))
              .map((item) => item.id)
          )
          return this.subjectAuxiliaryCategories
            .filter((item) => subjectIds.has(item.subject_id))
            .slice()
            .sort((left, right) => left.category.localeCompare(right.category))
            .map((item) => ({ subject_id: item.subject_id, category: item.category }))
        },
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT saci.subject_id, saci.auxiliary_item_id FROM subject_auxiliary_custom_items saci INNER JOIN subjects s ON s.id = saci.subject_id WHERE s.ledger_id = ? ORDER BY saci.auxiliary_item_id'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) => {
          const subjectIds = new Set(
            this.subjects
              .filter((item) => item.ledger_id === Number(ledgerId))
              .map((item) => item.id)
          )
          return this.subjectAuxiliaryCustomItems
            .filter((item) => subjectIds.has(item.subject_id))
            .slice()
            .sort((left, right) => left.auxiliary_item_id - right.auxiliary_item_id)
            .map((item) => ({
              subject_id: item.subject_id,
              auxiliary_item_id: item.auxiliary_item_id
            }))
        },
        run: () => ({})
      }
    }

    if (normalized === 'SELECT * FROM subjects WHERE ledger_id = ? AND code = ?') {
      return {
        get: (ledgerId, code) =>
          this.subjects.find(
            (item) => item.ledger_id === Number(ledgerId) && item.code === String(code)
          ),
        all: () => [],
        run: () => ({})
      }
    }

    if (
      normalized ===
      'INSERT INTO subjects (ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (
          ledgerId,
          code,
          name,
          parentCode,
          category,
          balanceDirection,
          hasAuxiliary,
          isCashFlow,
          level
        ) => {
          const row: SubjectRow = {
            id: this.nextSubjectId++,
            ledger_id: Number(ledgerId),
            code: String(code),
            name: String(name),
            parent_code: parentCode === null ? null : String(parentCode),
            category: String(category),
            balance_direction: Number(balanceDirection),
            has_auxiliary: Number(hasAuxiliary),
            is_cash_flow: Number(isCashFlow),
            level: Number(level),
            is_system: 0
          }
          this.subjects.push(row)
          return { lastInsertRowid: row.id }
        }
      }
    }

    if (normalized === 'DELETE FROM subject_auxiliary_categories WHERE subject_id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (subjectId) => {
          this.subjectAuxiliaryCategories = this.subjectAuxiliaryCategories.filter(
            (item) => item.subject_id !== Number(subjectId)
          )
          return {}
        }
      }
    }

    if (normalized === 'DELETE FROM subject_auxiliary_custom_items WHERE subject_id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (subjectId) => {
          this.subjectAuxiliaryCustomItems = this.subjectAuxiliaryCustomItems.filter(
            (item) => item.subject_id !== Number(subjectId)
          )
          return {}
        }
      }
    }

    if (
      normalized === 'INSERT INTO subject_auxiliary_categories (subject_id, category) VALUES (?, ?)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (subjectId, category) => {
          this.subjectAuxiliaryCategories.push({
            id: this.nextSubjectAuxiliaryCategoryId++,
            subject_id: Number(subjectId),
            category: String(category)
          })
          return {}
        }
      }
    }

    if (
      normalized ===
      'INSERT INTO subject_auxiliary_custom_items (subject_id, auxiliary_item_id) VALUES (?, ?)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (subjectId, auxiliaryItemId) => {
          this.subjectAuxiliaryCustomItems.push({
            id: this.nextSubjectAuxiliaryCustomItemId++,
            subject_id: Number(subjectId),
            auxiliary_item_id: Number(auxiliaryItemId)
          })
          return {}
        }
      }
    }

    if (
      normalized ===
      'UPDATE subjects SET name = ?, has_auxiliary = ?, is_cash_flow = ? WHERE id = ?'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (name, hasAuxiliary, isCashFlow, subjectId) => {
          const row = this.subjects.find((item) => item.id === Number(subjectId))
          if (row) {
            row.name = String(name)
            row.has_auxiliary = Number(hasAuxiliary)
            row.is_cash_flow = Number(isCashFlow)
          }
          return {}
        }
      }
    }

    if (
      normalized ===
      'INSERT INTO auxiliary_items (ledger_id, category, code, name) VALUES (?, ?, ?, ?)'
    ) {
      return {
        get: () => undefined,
        all: () => [],
        run: (ledgerId, category, code, name) => {
          const row: AuxiliaryItemRow = {
            id: this.nextAuxiliaryItemId++,
            ledger_id: Number(ledgerId),
            category: String(category),
            code: String(code),
            name: String(name)
          }
          this.auxiliaryItems.push(row)
          return { lastInsertRowid: row.id }
        }
      }
    }

    if (normalized === 'SELECT * FROM auxiliary_items WHERE id = ?') {
      return {
        get: (id) => this.auxiliaryItems.find((item) => item.id === Number(id)),
        all: () => [],
        run: () => ({})
      }
    }

    if (
      normalized === 'SELECT * FROM auxiliary_items WHERE ledger_id = ? ORDER BY category, code'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId) =>
          this.auxiliaryItems
            .filter((item) => item.ledger_id === Number(ledgerId))
            .slice()
            .sort((left, right) => {
              const byCategory = left.category.localeCompare(right.category)
              return byCategory !== 0 ? byCategory : left.code.localeCompare(right.code)
            }),
        run: () => ({})
      }
    }

    if (
      normalized ===
      'SELECT * FROM auxiliary_items WHERE ledger_id = ? AND category = ? ORDER BY code'
    ) {
      return {
        get: () => undefined,
        all: (ledgerId, category) =>
          this.auxiliaryItems
            .filter(
              (item) => item.ledger_id === Number(ledgerId) && item.category === String(category)
            )
            .slice()
            .sort((left, right) => left.code.localeCompare(right.code)),
        run: () => ({})
      }
    }

    if (normalized === 'UPDATE auxiliary_items SET code = ?, name = ? WHERE id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (code, name, id) => {
          const row = this.auxiliaryItems.find((item) => item.id === Number(id))
          if (row) {
            row.code = String(code)
            row.name = String(name)
          }
          return {}
        }
      }
    }

    if (normalized === 'SELECT id FROM voucher_entries WHERE auxiliary_item_id = ? LIMIT 1') {
      return {
        get: (auxiliaryItemId) =>
          this.voucherEntries.find((item) => item.auxiliary_item_id === Number(auxiliaryItemId)),
        all: () => [],
        run: () => ({})
      }
    }

    if (normalized === 'DELETE FROM auxiliary_items WHERE id = ?') {
      return {
        get: () => undefined,
        all: () => [],
        run: (id) => {
          this.auxiliaryItems = this.auxiliaryItems.filter((item) => item.id !== Number(id))
          return {}
        }
      }
    }

    throw new Error(`Unhandled SQL in test fake: ${normalized}`)
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

function createTestDb(): FakeDatabase {
  const db = new FakeDatabase()
  db.ledgers.push({ id: 1, name: '测试账套', standard_type: 'enterprise' })
  db.subjects.push(
    {
      id: 1,
      ledger_id: 1,
      code: '1122',
      name: '应收账款',
      parent_code: null,
      category: 'asset',
      balance_direction: 1,
      has_auxiliary: 0,
      is_cash_flow: 0,
      level: 1,
      is_system: 1
    },
    {
      id: 2,
      ledger_id: 1,
      code: '6602',
      name: '管理费用',
      parent_code: null,
      category: 'profit_loss',
      balance_direction: 1,
      has_auxiliary: 0,
      is_cash_flow: 0,
      level: 1,
      is_system: 1
    },
    {
      id: 3,
      ledger_id: 1,
      code: '112201',
      name: '华东应收',
      parent_code: '1122',
      category: 'asset',
      balance_direction: 1,
      has_auxiliary: 0,
      is_cash_flow: 0,
      level: 2,
      is_system: 0
    }
  )

  return db
}

describe('account setup service', () => {
  let db: FakeDatabase

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
  })

  it('creates a custom subject with inherited accounting attributes and auxiliary categories', () => {
    const createdId = createSubject(db as never, {
      ledgerId: 1,
      parentCode: '1122',
      code: '112202',
      name: '华南应收',
      auxiliaryCategories: ['customer', 'department'],
      isCashFlow: true
    })

    const created = db.subjects.find((item) => item.id === createdId)
    expect(created).toMatchObject({
      code: '112202',
      name: '华南应收',
      parent_code: '1122',
      category: 'asset',
      balance_direction: 1,
      has_auxiliary: 1,
      is_cash_flow: 1,
      level: 2,
      is_system: 0
    })

    const categories = db.subjectAuxiliaryCategories
      .filter((item) => item.subject_id === createdId)
      .map((item) => item.category)
      .sort()

    expect(categories).toEqual(['customer', 'department'])
  })

  it('requires new custom subjects to belong to an existing parent subject', () => {
    expect(() =>
      createSubject(db as never, {
        ledgerId: 1,
        parentCode: null,
        code: '9999',
        name: '顶级自定义科目',
        auxiliaryCategories: [],
        isCashFlow: false
      })
    ).toThrow('新建科目必须选择上级科目')
  })

  it('updates custom subjects and replaces auxiliary category assignments', () => {
    updateSubject(db as never, {
      subjectId: 3,
      name: '华东大区应收',
      auxiliaryCategories: ['customer', 'project'],
      isCashFlow: true
    })

    const updated = db.subjects.find((item) => item.id === 3)
    expect(updated).toMatchObject({
      name: '华东大区应收',
      has_auxiliary: 1,
      is_cash_flow: 1
    })

    const categories = db.subjectAuxiliaryCategories
      .filter((item) => item.subject_id === 3)
      .map((item) => item.category)
      .sort()
    expect(categories).toEqual(['customer', 'project'])
  })

  it('allows system subjects to configure auxiliary categories without renaming the official subject', () => {
    updateSubject(db as never, {
      subjectId: 1,
      auxiliaryCategories: ['customer'],
      isCashFlow: true
    })

    const subjects = listSubjects(db as never, 1)
    const subject = subjects.find((item) => item.id === 1)
    expect(subject).toMatchObject({
      name: '应收账款',
      is_cash_flow: 1,
      auxiliary_categories: ['customer']
    })

    expect(() =>
      updateSubject(db as never, {
        subjectId: 1,
        name: '应收账款-改名',
        auxiliaryCategories: ['customer'],
        isCashFlow: true
      })
    ).toThrow('系统科目不允许修改名称')
  })

  it('creates and updates auxiliary items', () => {
    const createdId = createAuxiliaryItem(db as never, {
      ledgerId: 1,
      category: 'customer',
      code: 'KH001',
      name: '华东客户'
    })

    updateAuxiliaryItem(db as never, {
      id: createdId,
      code: 'KH001A',
      name: '华东重点客户'
    })

    const item = db.auxiliaryItems.find((row) => row.id === createdId)
    expect(item).toEqual({
      id: createdId,
      ledger_id: 1,
      category: 'customer',
      code: 'KH001A',
      name: '华东重点客户'
    })
  })

  it('lists auxiliary items for the current ledger and supports category filtering', () => {
    createAuxiliaryItem(db as never, {
      ledgerId: 1,
      category: 'department',
      code: 'BM002',
      name: '閿€鍞儴'
    })
    createAuxiliaryItem(db as never, {
      ledgerId: 1,
      category: 'customer',
      code: 'KH002',
      name: '鍗庡崡瀹㈡埛'
    })
    createAuxiliaryItem(db as never, {
      ledgerId: 1,
      category: 'department',
      code: 'BM001',
      name: '璐㈠姟閮?'
    })

    const allItems = listAuxiliaryItems(db as never, 1)
    expect(allItems.map((item) => `${item.category}:${item.code}`)).toEqual([
      'customer:KH002',
      'department:BM001',
      'department:BM002'
    ])

    const departmentItems = listAuxiliaryItems(db as never, 1, 'department')
    expect(departmentItems.map((item) => item.code)).toEqual(['BM001', 'BM002'])
  })

  it('blocks deleting auxiliary items already used by voucher entries', () => {
    const itemId = createAuxiliaryItem(db as never, {
      ledgerId: 1,
      category: 'department',
      code: 'BM001',
      name: '财务部'
    })
    db.voucherEntries.push({ id: 1, auxiliary_item_id: itemId })

    expect(() => deleteAuxiliaryItem(db as never, itemId)).toThrow('该辅助账已被凭证使用，无法删除')
  })
})

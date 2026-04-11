import { describe, expect, it } from 'vitest'
import {
  getCarryForwardSourceCategories,
  normalizeSubjectCategoryForLedger,
  type SubjectCategory
} from './subjectCategoryRules'
import { seedPLCarryForwardRulesForLedger, seedSubjectsForLedger } from './seed'

type SubjectInsert = {
  ledgerId: number
  code: string
  name: string
  parentCode: string | null
  category: SubjectCategory
  balanceDirection: number
}

type RuleInsert = {
  ledgerId: number
  fromSubjectCode: string
  toSubjectCode: string
}

class FakeSeedDb {
  readonly subjects: SubjectInsert[] = []
  readonly rules: RuleInsert[] = []

  prepare(sql: string): {
    run: (...params: unknown[]) => unknown
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      'INSERT OR IGNORE INTO subjects ( ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ) {
      return {
        run: (
          ledgerId,
          code,
          name,
          parentCode,
          category,
          balanceDirection
        ) => {
          this.subjects.push({
            ledgerId: Number(ledgerId),
            code: String(code),
            name: String(name),
            parentCode: parentCode === null ? null : String(parentCode),
            category: String(category) as SubjectCategory,
            balanceDirection: Number(balanceDirection)
          })
          return {}
        }
      }
    }

    if (
      normalized ===
      'INSERT OR IGNORE INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code) VALUES (?, ?, ?)'
    ) {
      return {
        run: (ledgerId, fromSubjectCode, toSubjectCode) => {
          this.rules.push({
            ledgerId: Number(ledgerId),
            fromSubjectCode: String(fromSubjectCode),
            toSubjectCode: String(toSubjectCode)
          })
          return {}
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeSeedDb: ${normalized}`)
  }

  transaction<TArgs extends unknown[]>(callback: (...args: TArgs) => void): (...args: TArgs) => void {
    return (...args: TArgs) => callback(...args)
  }
}

describe('subject category rules', () => {
  it('maps legacy npo categories to net-assets, income and expense', () => {
    expect(normalizeSubjectCategoryForLedger('npo', 'equity', -1)).toBe('net_assets')
    expect(normalizeSubjectCategoryForLedger('npo', 'profit_loss', -1)).toBe('income')
    expect(normalizeSubjectCategoryForLedger('npo', 'profit_loss', 1)).toBe('expense')
    expect(normalizeSubjectCategoryForLedger('enterprise', 'equity', -1)).toBe('equity')
    expect(normalizeSubjectCategoryForLedger('enterprise', 'profit_loss', 1)).toBe('profit_loss')
  })

  it('treats npo income and expense as the only carry-forward source categories', () => {
    expect(getCarryForwardSourceCategories('enterprise')).toEqual(['profit_loss'])
    expect(getCarryForwardSourceCategories('npo')).toEqual(['income', 'expense'])
  })

  it('seeds npo ledgers with corrected default categories and carry-forward rules', () => {
    const db = new FakeSeedDb()

    seedSubjectsForLedger(db as never, 1, 'npo')
    seedPLCarryForwardRulesForLedger(db as never, 1, 'npo')

    expect(db.subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: '3101', category: 'net_assets' }),
        expect.objectContaining({ code: '4101', category: 'income' }),
        expect.objectContaining({ code: '410101', category: 'income' }),
        expect.objectContaining({ code: '5101', category: 'expense' }),
        expect.objectContaining({ code: '5301', category: 'expense' })
      ])
    )

    expect(db.rules).toEqual(
      expect.arrayContaining([
        { ledgerId: 1, fromSubjectCode: '410101', toSubjectCode: '3101' },
        { ledgerId: 1, fromSubjectCode: '410102', toSubjectCode: '3102' },
        { ledgerId: 1, fromSubjectCode: '5101', toSubjectCode: '3101' }
      ])
    )
    expect(db.rules).not.toEqual(
      expect.arrayContaining([
        { ledgerId: 1, fromSubjectCode: '4101', toSubjectCode: '3101' },
        { ledgerId: 1, fromSubjectCode: '4201', toSubjectCode: '3101' }
      ])
    )

    const subjectCodesWithChildren = new Set(
      db.subjects
        .filter((subject) => db.subjects.some((candidate) => candidate.parentCode === subject.code))
        .map((subject) => subject.code)
    )
    expect(
      db.rules.every((rule) => !subjectCodesWithChildren.has(rule.fromSubjectCode))
    ).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { applyCashFlowMappings, type CashFlowAutoEntry, type CashFlowAutoRule } from './cashFlowMapping'

function createEntry(
  overrides: Partial<CashFlowAutoEntry> & Pick<CashFlowAutoEntry, 'subjectCode'>
): CashFlowAutoEntry {
  return {
    subjectCode: overrides.subjectCode,
    debitCents: overrides.debitCents ?? 0,
    creditCents: overrides.creditCents ?? 0,
    cashFlowItemId: overrides.cashFlowItemId ?? null,
    isCashFlow: overrides.isCashFlow ?? false
  }
}

describe('applyCashFlowMappings', () => {
  it('auto assigns cash flow item when one exact rule is matched', () => {
    const entries = [
      createEntry({
        subjectCode: '1002',
        creditCents: 10000,
        isCashFlow: true
      }),
      createEntry({
        subjectCode: '2202',
        debitCents: 10000
      })
    ]
    const rules: CashFlowAutoRule[] = [
      {
        subjectCode: '1002',
        counterpartSubjectCode: '2202',
        entryDirection: 'outflow',
        cashFlowItemId: 4
      }
    ]

    const result = applyCashFlowMappings(entries, rules)
    expect(result.errors).toEqual([])
    expect(result.entries[0].cashFlowItemId).toBe(4)
  })

  it('returns manual-handling error when rule is missing', () => {
    const entries = [
      createEntry({
        subjectCode: '1002',
        creditCents: 10000,
        isCashFlow: true
      }),
      createEntry({
        subjectCode: '2202',
        debitCents: 10000
      })
    ]

    const result = applyCashFlowMappings(entries, [])
    expect(result.entries[0].cashFlowItemId).toBeNull()
    expect(result.errors).toContain('第1行未命中现金流量匹配规则，请手工指定')
  })

  it('requires manual handling when multiple counterpart rules map to different items', () => {
    const entries = [
      createEntry({
        subjectCode: '1002',
        creditCents: 10000,
        isCashFlow: true
      }),
      createEntry({
        subjectCode: '2202',
        debitCents: 4000
      }),
      createEntry({
        subjectCode: '2211',
        debitCents: 6000
      })
    ]
    const rules: CashFlowAutoRule[] = [
      {
        subjectCode: '1002',
        counterpartSubjectCode: '2202',
        entryDirection: 'outflow',
        cashFlowItemId: 4
      },
      {
        subjectCode: '1002',
        counterpartSubjectCode: '2211',
        entryDirection: 'outflow',
        cashFlowItemId: 5
      }
    ]

    const result = applyCashFlowMappings(entries, rules)
    expect(result.entries[0].cashFlowItemId).toBeNull()
    expect(result.errors).toContain('第1行命中多个现金流量项目，请手工指定')
  })

  it('does not allocate cash flow item for internal cash transfer', () => {
    const entries = [
      createEntry({
        subjectCode: '1002',
        creditCents: 10000,
        isCashFlow: true
      }),
      createEntry({
        subjectCode: '1001',
        debitCents: 10000,
        isCashFlow: true
      })
    ]

    const result = applyCashFlowMappings(entries, [])
    expect(result.errors).toEqual([])
    expect(result.entries[0].cashFlowItemId).toBeNull()
    expect(result.entries[1].cashFlowItemId).toBeNull()
  })

  it('reports invalid manual assignment on internal cash transfer', () => {
    const entries = [
      createEntry({
        subjectCode: '1002',
        creditCents: 10000,
        isCashFlow: true,
        cashFlowItemId: 1
      }),
      createEntry({
        subjectCode: '1001',
        debitCents: 10000,
        isCashFlow: true
      })
    ]

    const result = applyCashFlowMappings(entries, [])
    expect(result.errors).toContain('第1行为内部现金互转，不应指定现金流量项目')
    expect(result.entries[0].cashFlowItemId).toBeNull()
  })
})


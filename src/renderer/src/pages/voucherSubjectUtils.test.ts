import { describe, expect, it } from 'vitest'

import { buildVoucherSubjectPath, filterLeafVoucherSubjectsByKeyword } from './voucherSubjectUtils'

const subjects = [
  { code: '1001', name: '库存现金' },
  { code: '100101', name: '库存现金-总部' },
  { code: '100102', name: '库存现金-门店' },
  { code: '1122', name: '应收账款' },
  { code: '112201', name: '华东客户' },
  { code: '112202', name: '华南客户' }
]

describe('voucherSubjectUtils', () => {
  it('filters leaf voucher subjects by fuzzy code and name matches', () => {
    const hasChildrenCodes = new Set(['1001', '1122'])

    expect(filterLeafVoucherSubjectsByKeyword(subjects, '100', hasChildrenCodes)).toEqual([
      { code: '100101', name: '库存现金-总部' },
      { code: '100102', name: '库存现金-门店' }
    ])

    expect(filterLeafVoucherSubjectsByKeyword(subjects, '客户', hasChildrenCodes)).toEqual([
      { code: '112201', name: '华东客户' },
      { code: '112202', name: '华南客户' }
    ])
  })

  it('prioritizes exact and prefix code matches ahead of general fuzzy matches', () => {
    const hasChildrenCodes = new Set<string>()

    expect(filterLeafVoucherSubjectsByKeyword(subjects, '1122', hasChildrenCodes)).toEqual([
      { code: '1122', name: '应收账款' },
      { code: '112201', name: '华东客户' },
      { code: '112202', name: '华南客户' }
    ])
  })

  it('builds the full subject path from root to leaf', () => {
    const subjectByCode = new Map(subjects.map((subject) => [subject.code, subject]))
    const logicalParentByCode = new Map<string, string | null>([
      ['1001', null],
      ['100101', '1001'],
      ['100102', '1001'],
      ['1122', null],
      ['112201', '1122'],
      ['112202', '1122']
    ])

    expect(buildVoucherSubjectPath('100102', subjectByCode, logicalParentByCode)).toBe(
      '1001 库存现金 > 100102 库存现金-门店'
    )
    expect(buildVoucherSubjectPath('1122', subjectByCode, logicalParentByCode)).toBe(
      '1122 应收账款'
    )
  })
})

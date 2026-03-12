import { describe, expect, it } from 'vitest'
import {
  mergeSubjectTemplateEntries,
  type MergeableSubjectTemplateEntry
} from './subjectTemplateMerge'

describe('subjectTemplateMerge', () => {
  it('keeps manual entries when imported entries do not overlap', () => {
    expect(
      mergeSubjectTemplateEntries<MergeableSubjectTemplateEntry>(
        [
          {
            code: '1002',
            name: '手动新增A',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 1,
            carryForwardTargetCode: null,
            note: null
          },
          {
            code: '1005',
            name: '手动新增B',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 2,
            carryForwardTargetCode: null,
            note: null
          }
        ] satisfies MergeableSubjectTemplateEntry[],
        [
          {
            code: '2001',
            name: '批量导入C',
            category: 'liability',
            balanceDirection: -1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 1,
            carryForwardTargetCode: null,
            note: null
          }
        ] satisfies MergeableSubjectTemplateEntry[]
      )
    ).toEqual([
      expect.objectContaining({ code: '1002', name: '手动新增A', sortOrder: 1 }),
      expect.objectContaining({ code: '1005', name: '手动新增B', sortOrder: 2 }),
      expect.objectContaining({ code: '2001', name: '批量导入C', sortOrder: 3 })
    ])
  })

  it('lets imported entries override the same code while keeping other manual entries', () => {
    expect(
      mergeSubjectTemplateEntries<MergeableSubjectTemplateEntry>(
        [
          {
            code: '1001',
            name: '原手动名称',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 1,
            carryForwardTargetCode: null,
            note: 'old'
          },
          {
            code: '1003',
            name: '保留手动科目',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 2,
            carryForwardTargetCode: null,
            note: null
          }
        ] satisfies MergeableSubjectTemplateEntry[],
        [
          {
            code: '1001',
            name: '导入覆盖名称',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: true,
            enabled: false,
            sortOrder: 1,
            carryForwardTargetCode: null,
            note: 'new'
          }
        ] satisfies MergeableSubjectTemplateEntry[]
      )
    ).toEqual([
      expect.objectContaining({
        code: '1001',
        name: '导入覆盖名称',
        isCashFlow: true,
        enabled: false,
        note: 'new',
        sortOrder: 1
      }),
      expect.objectContaining({
        code: '1003',
        name: '保留手动科目',
        sortOrder: 2
      })
    ])
  })
})

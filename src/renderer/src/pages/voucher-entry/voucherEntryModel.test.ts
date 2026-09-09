import { describe, expect, it } from 'vitest'
import {
  buildDraftSignature,
  buildEditRequestToken,
  buildSubjectHierarchy,
  createEmptyRow,
  findFirstLeafSubject,
  getPeriodDateRange,
  hasDraftRowContent,
  isDateWithinRange,
  padRows,
  shouldShowPendingCashFlowHint,
  toAmountText,
  toPositiveInt,
  type VoucherSubject
} from './voucherEntryModel'

describe('凭证录入既有模型契约', () => {
  it.each([
    [0, '0.00'],
    [1, '0.01'],
    [1234, '12.34'],
    [-1, '-0.01']
  ])('分金额 %s 精确转换为 %s', (cents, text) => expect(toAmountText(cents)).toBe(text))

  it('空白行补齐四行，不截断已有行或替换原对象', () => {
    const row = createEmptyRow()
    const padded = padRows([row])
    expect(padded).toHaveLength(4)
    expect(padded[0]).toBe(row)
    expect(new Set(padded.map((value) => value.id)).size).toBe(4)
    expect(hasDraftRowContent(row)).toBe(false)
    expect(hasDraftRowContent({ ...row, subjectInput: '待选科目' })).toBe(true)
    const many = Array.from({ length: 5 }, createEmptyRow)
    expect(padRows(many)).toBe(many)
  })

  it('脏草稿签名排除显示名和临时行 ID，保留金额字符串及现金流选择', () => {
    const row = { ...createEmptyRow(), summary: ' 摘要 ', subjectCode: '1001', debit: '1.00' }
    expect(buildDraftSignature('2026-09-01', [row])).toBe(
      buildDraftSignature('2026-09-01', [
        { ...row, id: 'different', summary: '摘要', subjectName: '显示名' }
      ])
    )
    expect(buildDraftSignature('2026-09-01', [row])).not.toBe(
      buildDraftSignature('2026-09-01', [{ ...row, cashFlowItemId: 1 }])
    )
  })

  it('日期范围保持闰年和非法月份处理', () => {
    expect(getPeriodDateRange('2024-02')).toEqual({ min: '2024-02-01', max: '2024-02-29' })
    expect(getPeriodDateRange('2026-02')).toEqual({ min: '2026-02-01', max: '2026-02-28' })
    expect(getPeriodDateRange('2026-13')).toBeNull()
    expect(isDateWithinRange('2026-03-01', getPeriodDateRange('2026-02'))).toBe(false)
    expect(isDateWithinRange('2026-02-01', getPeriodDateRange('2026-02'))).toBe(true)
  })

  it('请求键保留同一凭证的重复编辑意图', () => {
    expect(toPositiveInt('12')).toBe(12)
    expect(toPositiveInt(0)).toBeNull()
    expect(toPositiveInt(1.2)).toBeNull()
    expect(buildEditRequestToken(12)).toBe('12:default')
    expect(buildEditRequestToken(12, 2)).toBe('12:2')
    expect(buildEditRequestToken(null, 2)).toBeNull()
  })

  it('科目层级恢复后仅允许末级候选', () => {
    const subjects: VoucherSubject[] = [
      {
        id: 1,
        code: '1001',
        name: '现金',
        parent_code: null,
        category: 'asset',
        level: 1,
        is_cash_flow: 1
      },
      {
        id: 2,
        code: '100101',
        name: '明细',
        parent_code: '1001',
        category: 'asset',
        level: 2,
        is_cash_flow: 1
      }
    ]
    const hierarchy = buildSubjectHierarchy(subjects)
    expect(hierarchy.hasChildrenCodes.has('1001')).toBe(true)
    expect(findFirstLeafSubject(subjects, hierarchy.hasChildrenCodes)?.code).toBe('100101')
  })

  it('现金类内部划转不提示待分配，对方非现金或无对方才提示', () => {
    const cash = { ...createEmptyRow(), subjectCode: '1001', isCashFlow: true, debit: '1.00' }
    const counterpart = {
      ...createEmptyRow(),
      subjectCode: '1002',
      isCashFlow: true,
      credit: '1.00'
    }
    expect(shouldShowPendingCashFlowHint([cash, counterpart], 0, cash)).toBe(false)
    expect(
      shouldShowPendingCashFlowHint([cash, { ...counterpart, isCashFlow: false }], 0, cash)
    ).toBe(true)
    expect(shouldShowPendingCashFlowHint([cash], 0, cash)).toBe(true)
    expect(shouldShowPendingCashFlowHint([cash], 0, { ...cash, cashFlowItemId: 1 })).toBe(false)
  })
})

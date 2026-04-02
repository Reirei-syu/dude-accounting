import { describe, expect, it } from 'vitest'

import {
  buildTableLayoutResult,
  buildVoucherLayoutResult
} from './printLayout'
import type { PrintTableSegment, PrintVoucherSegment, PrintPreviewSettings } from './print'

const settings: PrintPreviewSettings = {
  orientation: 'portrait',
  scalePercent: 100,
  marginPreset: 'default',
  densityPreset: 'default'
}

describe('printLayout service', () => {
  it('builds explicit page models for table pages', () => {
    const segment: PrintTableSegment = {
      kind: 'table',
      title: '科目余额表',
      ledgerName: '测试账套',
      periodLabel: '2026-03-01 至 2026-03-31',
      unitLabel: '元',
      headerMode: 'book',
      columns: [
        { key: 'subject_code', label: '科目编码', align: 'left' },
        { key: 'subject_name', label: '科目名称', align: 'left' },
        { key: 'amount', label: '金额', align: 'right' }
      ],
      rows: [
        {
          key: '1001',
          cells: [{ value: '1001' }, { value: '库存现金' }, { value: 100, isAmount: true }]
        },
        {
          key: '1002',
          cells: [{ value: '1002' }, { value: '银行存款' }, { value: 200, isAmount: true }]
        },
        {
          key: '1003',
          cells: [{ value: '1003' }, { value: '其他货币资金' }, { value: 300, isAmount: true }]
        }
      ]
    }

    const result = buildTableLayoutResult({
      title: '科目余额表',
      orientation: 'portrait',
      settings,
      segmentDrafts: [
        {
          segment,
          rowKeyGroups: [['1001', '1002'], ['1003']]
        }
      ],
      oversizeRowKeys: []
    })

    expect(result.pageCount).toBe(2)
    expect(result.pages[0]?.pageNumber).toBe(1)
    expect(result.pages[0]?.firstRowKey).toBe('1001')
    expect(result.pages[0]?.lastRowKey).toBe('1002')
    expect(result.pages[1]?.firstRowKey).toBe('1003')
    expect(result.pages[0]?.pageHtml).toContain('print-book-repeat-header')
    expect(result.pages[0]?.pageHtml).toContain('data-row-key="1001"')
    expect(result.pages[1]?.pageHtml).toContain('data-row-key="1003"')
    expect(result.diagnostics.pageRowCounts).toEqual([2, 1])
    expect(result.diagnostics.overflowDetected).toBe(false)
  })

  it('keeps an empty table page when there are no rows', () => {
    const segment: PrintTableSegment = {
      kind: 'table',
      title: '空报表',
      ledgerName: '测试账套',
      unitLabel: '元',
      columns: [{ key: 'label', label: '项目', align: 'left' }],
      rows: []
    }

    const result = buildTableLayoutResult({
      title: '空报表',
      orientation: 'portrait',
      settings,
      segmentDrafts: [
        {
          segment,
          rowKeyGroups: [[]]
        }
      ],
      oversizeRowKeys: []
    })

    expect(result.pageCount).toBe(1)
    expect(result.pages[0]?.firstRowKey).toBeNull()
    expect(result.pages[0]?.lastRowKey).toBeNull()
    expect(result.pages[0]?.pageHtml).toContain('<tbody></tbody>')
  })

  it('builds voucher page models for double layout', () => {
    const segment: PrintVoucherSegment = {
      kind: 'voucher',
      title: '记账凭证',
      ledgerName: '测试账套',
      periodLabel: '2026年3月',
      layout: 'double',
      doubleGapPx: 24,
      vouchers: [
        {
          id: 1,
          voucherWord: '记',
          voucherNumber: 1,
          voucherDate: '2026-03-01',
          creatorName: '张三',
          auditorName: '李四',
          bookkeeperName: '王五',
          totalDebit: 100,
          totalCredit: 100,
          entries: [
            {
              summary: '测试1',
              subjectCode: '1001',
              subjectName: '库存现金',
              debitAmount: 100,
              creditAmount: 0
            }
          ]
        },
        {
          id: 2,
          voucherWord: '记',
          voucherNumber: 2,
          voucherDate: '2026-03-02',
          creatorName: '张三',
          auditorName: '李四',
          bookkeeperName: '王五',
          totalDebit: 200,
          totalCredit: 200,
          entries: [
            {
              summary: '测试2',
              subjectCode: '1002',
              subjectName: '银行存款',
              debitAmount: 200,
              creditAmount: 0
            }
          ]
        },
        {
          id: 3,
          voucherWord: '记',
          voucherNumber: 3,
          voucherDate: '2026-03-03',
          creatorName: '张三',
          auditorName: '李四',
          bookkeeperName: '王五',
          totalDebit: 300,
          totalCredit: 300,
          entries: [
            {
              summary: '测试3',
              subjectCode: '1003',
              subjectName: '其他货币资金',
              debitAmount: 300,
              creditAmount: 0
            }
          ]
        }
      ]
    }

    const result = buildVoucherLayoutResult({
      title: '记账凭证打印',
      orientation: 'portrait',
      settings,
      segments: [segment]
    })

    expect(result.pageCount).toBe(2)
    expect(result.pages[0]?.firstRowKey).toBe('1')
    expect(result.pages[0]?.lastRowKey).toBe('2')
    expect(result.pages[1]?.firstRowKey).toBe('3')
    expect(result.pages[0]?.pageHtml).toContain('voucher-page double')
    expect(result.pages[1]?.pageHtml).toContain('记-0003')
  })
})

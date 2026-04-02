import { describe, expect, it } from 'vitest'

import {
  buildPrintDocumentHtml,
  buildPrintPreviewHtml,
  normalizePrintPreviewSettings,
  resolveBookPrintOrientation,
  type PrintDocument,
  type PrintPreviewSettings
} from './print'

describe('print service', () => {
  it('renders multiple table segments into one print document with page breaks', () => {
    const document: PrintDocument = {
      title: '打印任务',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
          kind: 'table',
          title: '资产负债表',
          ledgerName: '测试账套',
          periodLabel: '2026年3月',
          unitLabel: '元',
          columns: [
            { key: 'label', label: '项目', align: 'left' },
            { key: 'amount', label: '金额', align: 'right' }
          ],
          rows: [
            {
              key: 'cash',
              cells: [{ value: '货币资金' }, { value: 1234.56, isAmount: true }]
            }
          ]
        },
        {
          kind: 'table',
          title: '利润表',
          ledgerName: '测试账套',
          periodLabel: '2026年1-3月',
          unitLabel: '元',
          columns: [
            { key: 'label', label: '项目', align: 'left' },
            { key: 'amount', label: '金额', align: 'right' }
          ],
          rows: [
            {
              key: 'income',
              cells: [{ value: '营业收入' }, { value: 5678.9, isAmount: true }]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)

    expect(html).toContain('资产负债表')
    expect(html).toContain('利润表')
    expect(html).toContain('print-segment page-break')
    expect(html).toContain('<thead>')
  })

  it('renders voucher double layout with remembered gap', () => {
    const document: PrintDocument = {
      title: '记账凭证打印',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
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
              totalDebit: 10000,
              totalCredit: 10000,
              entries: [
                {
                  summary: '收款',
                  subjectCode: '1001',
                  subjectName: '库存现金',
                  debitAmount: 10000,
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
              totalDebit: 10000,
              totalCredit: 10000,
              entries: [
                {
                  summary: '付款',
                  subjectCode: '1002',
                  subjectName: '银行存款',
                  debitAmount: 0,
                  creditAmount: 10000
                }
              ]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)

    expect(html).toContain('voucher-page double')
    expect(html).toContain('row-gap: 24px')
    expect(html).toContain('记-0001')
    expect(html).toContain('记-0002')
    expect(html).toContain('单位名称：测试账套')
    expect(html).toContain('voucher-meta-left')
    expect(html).toContain('voucher-meta-center')
    expect(html).toContain('voucher-meta-right')
    expect(html).toContain('<col style="width: 31.67%" />')
    expect(html).toContain('<col style="width: 35%" />')
    expect(html).toContain('<col style="width: 16.665%" />')
    expect(html).toContain('voucher-amount-cell')
    expect(html).toContain('voucher-amount-text')
    expect(html).toContain('voucher-fit-cell')
    expect(html).toContain('voucher-fit-text')
  })

  it('renders book header layout with subject line and three-column meta', () => {
    const document: PrintDocument = {
      title: 'book print',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
          kind: 'table',
          title: '科目明细账',
          ledgerName: '测试账套',
          periodLabel: '2026-01-01 至 2026-01-31',
          unitLabel: '元',
          subjectLabel: '科目：1002 银行存款',
          headerMode: 'book',
          columns: [
            { key: 'subject_code', label: '科目编码', align: 'left' },
            { key: 'subject_name', label: '科目名称', align: 'left' },
            { key: 'summary', label: '摘要', align: 'left' }
          ],
          rows: [
            {
              key: 'row-1',
              cells: [
                { value: '100201', indentLevel: 3 },
                { value: 'very long subject name for autofit', indentLevel: 3 },
                { value: 'very long summary for autofit' }
              ]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)
    const theadHtml = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? ''

    expect(theadHtml).toContain('print-book-repeat-header')
    expect(theadHtml).toContain('print-book-thead-title-row')
    expect(theadHtml).toContain('print-book-subject')
    expect(theadHtml).toContain('print-book-thead-meta')
    expect(theadHtml).toContain('print-meta-left')
    expect(theadHtml).toContain('print-meta-center')
    expect(theadHtml).toContain('print-meta-right')
    expect(html).toContain('print-segment-book')
    expect(html).toContain('print-fit-cell')
    expect(html).toContain('print-fit-text')
    expect(html).toContain('&#12288;&#12288;')
  })

  it('renders centered title with two-line left meta block for auxiliary detail books', () => {
    const document: PrintDocument = {
      title: 'book print',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
          kind: 'table',
          title: '辅助明细账',
          ledgerName: '测试账套',
          periodLabel: '2026-01-01 至 2026-01-31',
          unitLabel: '元',
          titleMetaLines: ['科目：1002 银行存款', '辅助科目：FA001 固定资产卡片'],
          headerMode: 'book',
          columns: [
            { key: 'voucher_date', label: '日期', align: 'left' },
            { key: 'summary', label: '摘要', align: 'left' }
          ],
          rows: [
            {
              key: 'row-1',
              cells: [{ value: '2026-01-01' }, { value: 'opening balance' }]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)
    const theadHtml = html.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? ''

    expect(theadHtml).toContain('print-book-repeat-header')
    expect(theadHtml).toContain('print-book-header-row')
    expect(theadHtml).toContain('print-book-title-side')
    expect(theadHtml).toContain('print-book-title-side-line')
    expect(theadHtml).toContain('print-book-title-center')
    expect(theadHtml).toContain('辅助科目：FA001 固定资产卡片')
  })

  it('builds fit-text cells and indents book subject columns', () => {
    const document: PrintDocument = {
      title: 'book print',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
          kind: 'table',
          title: 'subject balance',
          ledgerName: 'demo-ledger',
          columns: [
            { key: 'subject_code', label: 'code', align: 'left' },
            { key: 'subject_name', label: 'subject_name', align: 'left' },
            { key: 'amount', label: 'amount', align: 'right' }
          ],
          rows: [
            {
              key: '1002',
              cells: [
                { value: '100201', indentLevel: 3 },
                { value: 'very long subject name for autofit', indentLevel: 3 },
                { value: 1234.56, isAmount: true }
              ]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)

    expect(html).toContain('<colgroup>')
    expect(html).toContain('print-fit-cell')
    expect(html).toContain('print-fit-text')
    expect(html).toContain('&#12288;&#12288;')
  })

  it('pads each voucher to six entry rows for stable paper height', () => {
    const document: PrintDocument = {
      title: '记账凭证打印',
      orientation: 'portrait',
      showPageNumber: false,
      segments: [
        {
          kind: 'voucher',
          title: '记账凭证',
          ledgerName: '测试账套',
          periodLabel: '2026年3月',
          layout: 'single',
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
              totalDebit: 10000,
              totalCredit: 10000,
              entries: [
                {
                  summary: '收款',
                  subjectCode: '1001',
                  subjectName: '库存现金',
                  debitAmount: 10000,
                  creditAmount: 0
                }
              ]
            }
          ]
        }
      ]
    }

    const html = buildPrintDocumentHtml(document)
    const bodyMatches = html.match(/<tbody>([\s\S]*?)<\/tbody>/)
    const bodyHtml = bodyMatches?.[1] ?? ''
    const rowCount = (bodyHtml.match(/<tr>/g) ?? []).length

    expect(rowCount).toBe(6)
    expect(bodyHtml).toContain('收款')
    expect(bodyHtml).toContain('&nbsp;')
  })

  it('chooses landscape orientation for wide books', () => {
    expect(resolveBookPrintOrientation(6)).toBe('portrait')
    expect(resolveBookPrintOrientation(8)).toBe('landscape')
  })

  it('builds preview html with unified settings bar and persisted book defaults', () => {
    const initialSettings: PrintPreviewSettings = {
      orientation: 'landscape',
      scalePercent: 85,
      marginPreset: 'narrow',
      densityPreset: 'ultra-compact'
    }

    const html = buildPrintPreviewHtml(
      'job-1',
      '打印预览',
      '<div>preview</div>',
      initialSettings,
      'book_print_settings_detail_ledger'
    )

    expect(html).toContain('triggerPrint')
    expect(html).toContain('triggerExportPdf')
    expect(html).toContain('preview-orientation-select')
    expect(html).toContain('applyOrientation')
    expect(html).toContain('preview-scale-select')
    expect(html).toContain('preview-margin-select')
    expect(html).toContain('preview-density-select')
    expect(html).toContain('preview-reset-button')
    expect(html).toContain('applyMarginPreset')
    expect(html).toContain('applyDensityPreset')
    expect(html).toContain('resetPreviewSettings')
    expect(html).toContain('persistPreviewSettings')
    expect(html).toContain('paginateBookSegments')
    expect(html).toContain('createBookPageSection')
    expect(html).toContain('data-book-pagination-id')
    expect(html).toContain('恢复默认')
    expect(html).toContain('页边距')
    expect(html).toContain('内容密度')
    expect(html).toContain('打印预览')
    expect(html).toContain('orientation-landscape')
    expect(html).toContain('--voucher-table-gap: 10px')
    expect(html).toContain('book_print_settings_detail_ledger')
    expect(html).toContain('"scalePercent":85')
    expect(html).toContain('"marginPreset":"narrow"')
    expect(html).toContain('"densityPreset":"ultra-compact"')
    expect(html).toContain('<option value="75">75%</option>')
    expect(html).toContain('margin-top: var(--voucher-table-gap)')
    expect(html).toContain('margin-bottom: var(--voucher-table-gap)')
    expect(html).toContain('fitVoucherAmountCells')
    expect(html).toContain('fitVoucherTextCells')
    expect(html).toContain('fitBookCells')
    expect(html).toContain('settleVoucherAmountLayout')
    expect(html).toContain('refreshLayoutStatus')
    expect(html).toContain('applyScale')
    expect(html).toContain("window.addEventListener('beforeprint', () => {")
    expect(html).toContain('await settleVoucherAmountLayout()')
    expect(html).toContain('overflowWarningText')
    expect(html).toContain('hasPrintOverflow')
    expect(html).toContain('ensurePrintableLayout')
    expect(html).toContain('height: 38.4px')
  })

  it('does not persist preview settings for non-book jobs', () => {
    const initialSettings: PrintPreviewSettings = {
      orientation: 'portrait',
      scalePercent: 100,
      marginPreset: 'default',
      densityPreset: 'default'
    }

    const html = buildPrintPreviewHtml('job-2', '报表打印预览', '<div>preview</div>', initialSettings)

    expect(html).toContain('const persistPreferenceKey = null;')
  })

  it('keeps an explicit portrait orientation instead of falling back to landscape', () => {
    expect(
      normalizePrintPreviewSettings(
        {
          orientation: 'portrait',
          scalePercent: 95,
          marginPreset: 'narrow',
          densityPreset: 'compact'
        },
        'landscape'
      )
    ).toEqual({
      orientation: 'portrait',
      scalePercent: 95,
      marginPreset: 'narrow',
      densityPreset: 'compact'
    })
  })
})

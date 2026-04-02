import { describe, expect, it } from 'vitest'

import { buildPagedPrintPreviewHtml } from './printPreviewShell'
import type { PrintPreviewModel } from './print'

describe('printPreviewShell service', () => {
  it('builds a paged preview shell driven by preview model updates', () => {
    const html = buildPagedPrintPreviewHtml('job-1', {
      title: '科目余额表',
      orientation: 'landscape',
      settings: {
        orientation: 'landscape',
        scalePercent: 85,
        marginPreset: 'narrow',
        densityPreset: 'compact'
      },
      pageCount: 2,
      layoutVersion: 3,
      pages: [
        {
          kind: 'table',
          pageNumber: 1,
          firstRowKey: '1001',
          lastRowKey: '1002',
          pageHtml: '<section class="print-segment"><div>page-1</div></section>'
        },
        {
          kind: 'table',
          pageNumber: 2,
          firstRowKey: '1003',
          lastRowKey: '1003',
          pageHtml: '<section class="print-segment"><div>page-2</div></section>'
        }
      ],
      diagnostics: {
        engine: 'page-model',
        overflowDetected: false,
        oversizeRowKeys: [],
        pageRowCounts: [2, 1]
      }
    } satisfies PrintPreviewModel)

    expect(html).toContain('window.api.print.updatePreviewSettings')
    expect(html).toContain('renderPreviewModel')
    expect(html).toContain('preview-page-list')
    expect(html).toContain('第 ')
    expect(html).toContain('"layoutVersion":3')
    expect(html).toContain('window.api.print.print(targetJobId)')
    expect(html).toContain('window.api.print.exportPdf(targetJobId)')
  })
})

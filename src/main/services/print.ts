export type PrintOrientation = 'portrait' | 'landscape'
export type PrintJobType = 'report' | 'book' | 'voucher' | 'batch'

export interface PrintTableColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export interface PrintTableCell {
  value: string | number | null
  isAmount?: boolean
  indentLevel?: number
  fitMode?: 'wrap-shrink'
}

export interface PrintTableRow {
  key: string
  cells: PrintTableCell[]
}

export interface PrintTableSegment {
  kind: 'table'
  title: string
  ledgerName: string
  periodLabel?: string
  unitLabel?: string
  subjectLabel?: string
  titleMetaLines?: string[]
  headerMode?: 'default' | 'book'
  metaLines?: string[]
  columns: PrintTableColumn[]
  rows: PrintTableRow[]
}

export interface PrintVoucherEntryLine {
  summary: string
  subjectCode: string
  subjectName: string
  debitAmount: number
  creditAmount: number
}

export interface PrintVoucherRecord {
  id: number
  voucherWord: string
  voucherNumber: number
  voucherDate: string
  creatorName?: string | null
  auditorName?: string | null
  bookkeeperName?: string | null
  totalDebit: number
  totalCredit: number
  entries: PrintVoucherEntryLine[]
}

export interface PrintVoucherSegment {
  kind: 'voucher'
  title: string
  ledgerName: string
  periodLabel?: string
  layout: 'single' | 'double'
  doubleGapPx: number
  vouchers: PrintVoucherRecord[]
}

export type PrintDocumentSegment = PrintTableSegment | PrintVoucherSegment

export interface PrintDocument {
  title: string
  orientation: PrintOrientation
  showPageNumber: boolean
  segments: PrintDocumentSegment[]
}

const VOUCHER_TABLE_GAP_PX = 10
const VOUCHER_MIN_ENTRY_ROWS = 6
const VOUCHER_ROW_HEIGHT_PX = 38.4
const VOUCHER_SUMMARY_WIDTH = '31.67%'
const VOUCHER_SUBJECT_WIDTH = '35%'
const VOUCHER_DEBIT_WIDTH = '16.665%'
const VOUCHER_CREDIT_WIDTH = '16.665%'
const VOUCHER_AMOUNT_FONT_SIZE_PX = 12
const VOUCHER_AMOUNT_MIN_FONT_SIZE_PX = 8
const VOUCHER_FIT_TEXT_FONT_SIZE_PX = 12
const VOUCHER_FIT_TEXT_MIN_FONT_SIZE_PX = 8
const PRINT_FIT_TEXT_FONT_SIZE_PX = 12
const PRINT_FIT_TEXT_MIN_FONT_SIZE_PX = 8
const FIT_TEXT_COLUMN_KEYS = new Set(['summary', 'subject_name'])
const INDENT_COLUMN_KEYS = new Set(['subject_code', 'subject_name'])

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatAmount(value: number): string {
  return value.toFixed(2)
}

function formatVoucherTextCell(value: string): string {
  const trimmed = value.trim()
  return trimmed === '' ? '&nbsp;' : escapeHtml(trimmed)
}

function formatVoucherAmountCell(value: number): string {
  return value > 0 ? escapeHtml(formatAmount(value)) : '&nbsp;'
}

function wrapVoucherAmountCell(value: string): string {
  return `<span class="voucher-amount-text" data-base-font-size="${VOUCHER_AMOUNT_FONT_SIZE_PX}" data-min-font-size="${VOUCHER_AMOUNT_MIN_FONT_SIZE_PX}">${value}</span>`
}

function wrapVoucherFitText(value: string): string {
  return value === '&nbsp;'
    ? value
    : `<span class="voucher-fit-text" data-base-font-size="${VOUCHER_FIT_TEXT_FONT_SIZE_PX}" data-min-font-size="${VOUCHER_FIT_TEXT_MIN_FONT_SIZE_PX}">${value}</span>`
}

function formatCellValue(cell: PrintTableCell): string {
  if (typeof cell.value === 'number') {
    return cell.isAmount ? formatAmount(cell.value) : String(cell.value)
  }
  return String(cell.value ?? '')
}

function measureTextUnits(value: string): number {
  return Array.from(value).reduce((total, char) => {
    if (/\d/.test(char)) return total + 0.9
    if (/[A-Za-z]/.test(char)) return total + 0.75
    if (char === ' ') return total + 0.45
    return total + 1.6
  }, 0)
}

function buildTableColumnWidths(segment: PrintTableSegment): number[] {
  const rawWeights = segment.columns.map((column, columnIndex) => {
    const headerWeight = measureTextUnits(column.label)
    const cellWeight = segment.rows.reduce((maxWeight, row) => {
      const cell = row.cells[columnIndex]
      if (!cell) return maxWeight
      const cellText = formatCellValue(cell)
      const indentWeight = cell.indentLevel ? Math.max(cell.indentLevel - 1, 0) * 1.6 : 0
      return Math.max(maxWeight, measureTextUnits(cellText) + indentWeight)
    }, 0)
    const minWeight = column.align === 'right' ? 7 : 6
    return Math.max(headerWeight, cellWeight, minWeight)
  })

  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0) || 1
  return rawWeights.map((weight) => Number(((weight / totalWeight) * 100).toFixed(3)))
}

function formatTableCellContent(cell: PrintTableCell, column: PrintTableColumn): string {
  const rawValue = formatCellValue(cell)
  const escapedValue = rawValue === '' ? '&nbsp;' : escapeHtml(rawValue)
  const indentPrefix =
    cell.indentLevel && cell.indentLevel > 1 && INDENT_COLUMN_KEYS.has(column.key)
      ? '&#12288;'.repeat(cell.indentLevel - 1)
      : ''
  const contentHtml = `${indentPrefix}${escapedValue}`
  const shouldFitText = cell.fitMode === 'wrap-shrink' || FIT_TEXT_COLUMN_KEYS.has(column.key)
  if (!shouldFitText || rawValue === '') {
    return contentHtml
  }
  return `<span class="print-fit-text" data-base-font-size="${PRINT_FIT_TEXT_FONT_SIZE_PX}" data-min-font-size="${PRINT_FIT_TEXT_MIN_FONT_SIZE_PX}">${contentHtml}</span>`
}

function buildTableSegmentHtml(segment: PrintTableSegment, pageBreak: boolean): string {
  const isBookHeader = segment.headerMode === 'book'
  const metaLines = [
    `编制单位：${segment.ledgerName}`,
    segment.periodLabel ? `会计期间：${segment.periodLabel}` : '',
    `单位：${segment.unitLabel || '元'}`
  ]
    .concat(isBookHeader ? [] : segment.metaLines ?? [])
    .filter(Boolean)

  const headerHtml = segment.columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join('')
  const colGroupHtml = buildTableColumnWidths(segment)
    .map((width) => `<col style="width: ${width}%;" />`)
    .join('')
  const bodyHtml = segment.rows
    .map((row) => {
      const cells = row.cells
        .map((cell, index) => {
          const column = segment.columns[index]
          const align = column?.align ?? (cell.isAmount ? 'right' : 'left')
          const className =
            column && (cell.fitMode === 'wrap-shrink' || FIT_TEXT_COLUMN_KEYS.has(column.key))
              ? `align-${align} print-fit-cell`
              : `align-${align}`
          return `<td class="${className}">${column ? formatTableCellContent(cell, column) : escapeHtml(formatCellValue(cell))}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  const titleHtml =
    isBookHeader && segment.titleMetaLines && segment.titleMetaLines.length > 0
      ? `
        <div class="print-book-header-row">
          <div class="print-book-title-side">
            ${segment.titleMetaLines
              .map((line) => `<span class="print-book-title-side-line">${escapeHtml(line)}</span>`)
              .join('')}
          </div>
          <h1 class="print-book-title-center">${escapeHtml(segment.title)}</h1>
          <div class="print-book-title-spacer" aria-hidden="true"></div>
        </div>
      `
      : isBookHeader && segment.subjectLabel
      ? `
        <div class="print-book-title-row">
          <span class="print-book-title">${escapeHtml(segment.title)}</span>
          <span class="print-book-subject">${escapeHtml(segment.subjectLabel)}</span>
        </div>
      `
      : `<h1>${escapeHtml(segment.title)}</h1>`
  const metaHtml = isBookHeader
    ? `
        <div class="print-meta print-meta-book">
          <span class="print-meta-left">编制单位：${escapeHtml(segment.ledgerName)}</span>
          <span class="print-meta-center">${escapeHtml(segment.periodLabel ? `会计期间：${segment.periodLabel}` : '')}</span>
          <span class="print-meta-right">单位：${escapeHtml(segment.unitLabel || '元')}</span>
        </div>
      `
    : `
        <div class="print-meta">
          ${metaLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}
        </div>
      `

  return `
    <section class="print-segment ${pageBreak ? 'page-break' : ''}">
      <div class="print-document">
        ${titleHtml}
        ${metaHtml}
        <table class="print-table">
          <colgroup>${colGroupHtml}</colgroup>
          <thead><tr>${headerHtml}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </section>
  `
}

function buildVoucherSheetHtml(voucher: PrintVoucherRecord, ledgerName: string): string {
  const paddedEntries = [...voucher.entries]
  while (paddedEntries.length < VOUCHER_MIN_ENTRY_ROWS) {
    paddedEntries.push({
      summary: '',
      subjectCode: '',
      subjectName: '',
      debitAmount: 0,
      creditAmount: 0
    })
  }

  const entryRows = paddedEntries
    .map(
      (entry) => `
        <tr>
          <td class="voucher-fit-cell">${wrapVoucherFitText(formatVoucherTextCell(entry.summary))}</td>
          <td class="voucher-fit-cell">${wrapVoucherFitText(
            formatVoucherTextCell(
              `${entry.subjectCode}${entry.subjectCode && entry.subjectName ? ' ' : ''}${entry.subjectName}`
            )
          )}</td>
          <td class="align-right voucher-amount-cell">${wrapVoucherAmountCell(
            formatVoucherAmountCell(entry.debitAmount)
          )}</td>
          <td class="align-right voucher-amount-cell">${wrapVoucherAmountCell(
            formatVoucherAmountCell(entry.creditAmount)
          )}</td>
        </tr>
      `
    )
    .join('')

  return `
    <article class="voucher-sheet-inner">
      <header class="voucher-sheet-header">
        <div class="voucher-title">记账凭证</div>
        <div class="voucher-meta voucher-meta-triple">
          <span class="voucher-meta-left">单位名称：${escapeHtml(ledgerName)}</span>
          <span class="voucher-meta-center">日期：${escapeHtml(voucher.voucherDate)}</span>
          <span class="voucher-meta-right">编号：${escapeHtml(
            `${voucher.voucherWord}-${String(voucher.voucherNumber).padStart(4, '0')}`
          )}</span>
        </div>
      </header>
      <table class="voucher-table">
        <colgroup>
          <col style="width: ${VOUCHER_SUMMARY_WIDTH}" />
          <col style="width: ${VOUCHER_SUBJECT_WIDTH}" />
          <col style="width: ${VOUCHER_DEBIT_WIDTH}" />
          <col style="width: ${VOUCHER_CREDIT_WIDTH}" />
        </colgroup>
        <thead>
          <tr>
            <th>摘要</th>
            <th>会计科目</th>
            <th>借方金额</th>
            <th>贷方金额</th>
          </tr>
        </thead>
        <tbody>${entryRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">合计</td>
            <td class="align-right voucher-amount-cell">${wrapVoucherAmountCell(
              escapeHtml(formatAmount(voucher.totalDebit))
            )}</td>
            <td class="align-right voucher-amount-cell">${wrapVoucherAmountCell(
              escapeHtml(formatAmount(voucher.totalCredit))
            )}</td>
          </tr>
        </tfoot>
      </table>
      <footer class="voucher-sheet-footer">
        <span>制单：${escapeHtml(voucher.creatorName ?? '')}</span>
        <span>审核：${escapeHtml(voucher.auditorName ?? '')}</span>
        <span>记账：${escapeHtml(voucher.bookkeeperName ?? '')}</span>
      </footer>
    </article>
  `
}

function buildVoucherSegmentHtml(segment: PrintVoucherSegment, pageBreak: boolean): string {
  if (segment.layout === 'double') {
    const pages: Array<Array<PrintVoucherRecord | null>> = []
    for (let index = 0; index < segment.vouchers.length; index += 2) {
      pages.push([segment.vouchers[index] ?? null, segment.vouchers[index + 1] ?? null])
    }

    return pages
      .map(
        (page, pageIndex) => `
          <section class="print-segment ${pageBreak || pageIndex < pages.length - 1 ? 'page-break' : ''}">
            <div class="print-document voucher-page double" style="row-gap: ${segment.doubleGapPx}px">
              ${page
                .map((voucher) =>
                  voucher
                    ? buildVoucherSheetHtml(voucher, segment.ledgerName)
                    : '<article class="voucher-sheet-inner voucher-sheet-empty"></article>'
                )
                .join('')}
            </div>
          </section>
        `
      )
      .join('')
  }

  return segment.vouchers
    .map(
      (voucher, index) => `
        <section class="print-segment ${pageBreak || index < segment.vouchers.length - 1 ? 'page-break' : ''}">
          <div class="print-document voucher-page single">
            ${buildVoucherSheetHtml(voucher, segment.ledgerName)}
          </div>
        </section>
      `
    )
    .join('')
}

export function resolveBookPrintOrientation(columnCount: number): PrintOrientation {
  return columnCount >= 8 ? 'landscape' : 'portrait'
}

export function buildPrintDocumentHtml(document: PrintDocument): string {
  return document.segments
    .map((segment, index) =>
      segment.kind === 'table'
        ? buildTableSegmentHtml(segment, index < document.segments.length - 1)
        : buildVoucherSegmentHtml(segment, index < document.segments.length - 1)
    )
    .join('')
}

export function buildPrintPreviewHtml(
  jobId: string,
  title: string,
  contentHtml: string,
  orientation: PrintOrientation = 'portrait'
): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page {
        size: A4 ${orientation};
        margin: 0;
      }
      :root {
        color-scheme: light;
        --voucher-table-gap: ${VOUCHER_TABLE_GAP_PX}px;
        --preview-scale: 1;
        --preview-padding-y: 16mm;
        --preview-padding-x: 14mm;
        --preview-cell-padding-y: 6px;
        --preview-cell-padding-x: 8px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Microsoft YaHei", "SimSun", sans-serif;
        background: #e5e7eb;
        color: #111827;
      }
      .preview-toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 12px 16px;
        border-bottom: 1px solid #cbd5e1;
        background: rgba(255,255,255,0.94);
        backdrop-filter: blur(12px);
      }
      .preview-toolbar h1 {
        margin: 0 auto 0 0;
        font-size: 14px;
        font-weight: 700;
      }
      .preview-toolbar button {
        min-height: 36px;
        padding: 0 14px;
        border: 1px solid #94a3b8;
        border-radius: 8px;
        background: #ffffff;
        cursor: pointer;
      }
      .preview-toolbar button[aria-pressed="true"] {
        background: #e2e8f0;
        border-color: #64748b;
      }
      .preview-toolbar select {
        min-height: 36px;
        padding: 0 10px;
        border: 1px solid #94a3b8;
        border-radius: 8px;
        background: #ffffff;
      }
      .preview-control {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: #475569;
      }
      .preview-control--orientation {
        min-width: 140px;
      }
      .preview-status {
        font-size: 12px;
        color: #475569;
      }
      .preview-canvas {
        padding: 18px;
        zoom: var(--preview-scale);
        transform-origin: top center;
      }
      .preview-canvas.orientation-portrait .print-segment {
        width: 210mm;
        min-height: 297mm;
      }
      .preview-canvas.orientation-landscape .print-segment {
        width: 297mm;
        min-height: 210mm;
      }
      .print-segment {
        margin: 0 auto 16px;
        padding: var(--preview-padding-y) var(--preview-padding-x);
        background: #ffffff;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
      }
      .print-segment.page-break {
        break-after: page;
        page-break-after: always;
      }
      .print-document h1,
      .voucher-title {
        margin: 0 0 10px;
        text-align: center;
        font-size: 20px;
        font-weight: 700;
      }
      .print-book-title-row {
        display: flex;
        align-items: baseline;
        justify-content: flex-start;
        gap: 16px;
        margin: 0 0 10px;
        text-align: left;
      }
      .print-book-title,
      .print-book-subject {
        font-size: 20px;
        font-weight: 700;
      }
      .print-book-header-row {
        display: grid;
        grid-template-columns: minmax(220px, 36%) 1fr minmax(220px, 36%);
        align-items: start;
        gap: 12px;
        margin: 0 0 10px;
      }
      .print-book-title-side {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 2px;
        font-size: 12px;
        line-height: 1.4;
        text-align: left;
      }
      .print-book-title-center {
        margin: 0;
        text-align: center;
      }
      .print-book-title-spacer {
        min-height: 1px;
      }
      .print-meta,
      .voucher-meta,
      .voucher-sheet-footer {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        font-size: 11px;
      }
      .print-meta {
        margin-bottom: 10px;
      }
      .print-meta span,
      .voucher-meta span,
      .voucher-sheet-footer span {
        white-space: nowrap;
      }
      .print-meta span:first-child,
      .print-meta span:nth-child(2) {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .print-meta-book .print-meta-left {
        text-align: left;
      }
      .print-meta-book .print-meta-center {
        text-align: center;
        flex: 1;
      }
      .print-meta-book .print-meta-right {
        text-align: right;
      }
      .voucher-meta {
        margin-bottom: var(--voucher-table-gap);
      }
      .voucher-sheet-footer {
        margin-top: var(--voucher-table-gap);
      }
      .print-table,
      .voucher-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      .print-table thead,
      .voucher-table thead {
        display: table-header-group;
      }
      .print-table th,
      .print-table td,
      .voucher-table th,
      .voucher-table td {
        border: 1px solid #111827;
        padding: var(--preview-cell-padding-y) var(--preview-cell-padding-x);
        vertical-align: middle;
      }
      .print-fit-cell {
        height: 32px;
        overflow: hidden;
      }
      .print-fit-text {
        display: block;
        width: 100%;
        line-height: 1.2;
        white-space: normal;
        word-break: break-all;
        overflow-wrap: anywhere;
        font-size: ${PRINT_FIT_TEXT_FONT_SIZE_PX}px;
      }
      .voucher-amount-cell {
        white-space: nowrap;
        overflow: hidden;
      }
      .voucher-fit-cell {
        height: ${VOUCHER_ROW_HEIGHT_PX}px;
        overflow: hidden;
      }
      .voucher-fit-text {
        display: block;
        width: 100%;
        line-height: 1.2;
        white-space: normal;
        word-break: break-all;
        overflow-wrap: anywhere;
        font-size: ${VOUCHER_FIT_TEXT_FONT_SIZE_PX}px;
      }
      .voucher-amount-text {
        display: inline-block;
        width: 100%;
        white-space: nowrap;
        text-align: right;
        line-height: 1.2;
        font-size: ${VOUCHER_AMOUNT_FONT_SIZE_PX}px;
        font-variant-numeric: tabular-nums;
      }
      .align-left { text-align: left; }
      .align-center { text-align: center; }
      .align-right { text-align: right; }
      .voucher-page.double {
        display: flex;
        flex-direction: column;
      }
      .voucher-page.single .voucher-sheet-inner,
      .voucher-page.double .voucher-sheet-inner {
        border: 1px solid #111827;
        padding: 8px 10px;
      }
      .voucher-sheet-empty {
        min-height: 120mm;
        background: transparent;
      }
      .voucher-sheet-header {
        margin-bottom: 0;
      }
      .voucher-meta-triple {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        align-items: center;
      }
      .voucher-meta-left {
        text-align: left;
      }
      .voucher-meta-center {
        text-align: center;
      }
      .voucher-meta-right {
        text-align: right;
      }
      @media print {
        body {
          background: #ffffff;
        }
        .preview-toolbar {
          display: none !important;
        }
        .preview-canvas {
          padding: 0;
        }
        .print-segment {
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="preview-toolbar">
      <h1>${escapeHtml(title)}</h1>
      <span id="preview-status" class="preview-status"></span>
      <label class="preview-control preview-control--orientation" for="preview-orientation-select">
        纸张方向
        <select id="preview-orientation-select" onchange="applyOrientation(this.value)">
          <option value="portrait"${orientation === 'portrait' ? ' selected' : ''}>竖向</option>
          <option value="landscape"${orientation === 'landscape' ? ' selected' : ''}>横向</option>
        </select>
      </label>
      <label class="preview-control" for="preview-scale-select">
        缩放
        <select id="preview-scale-select" onchange="applyScale(this.value)">
          <option value="100">100%</option>
          <option value="95">95%</option>
          <option value="90">90%</option>
          <option value="85">85%</option>
          <option value="80">80%</option>
        </select>
      </label>
      <button
        type="button"
        id="preview-compact-toggle"
        aria-pressed="false"
        onclick="toggleCompactMode()"
      >
        紧凑模式：关
      </button>
      <button type="button" onclick="triggerPrint('${jobId}')">打印</button>
      <button type="button" onclick="triggerExportPdf('${jobId}')">导出 PDF</button>
      <button type="button" onclick="window.close()">关闭</button>
    </div>
    <main class="preview-canvas orientation-${orientation}">${contentHtml}</main>
    <script>
      const statusNode = document.getElementById('preview-status');
      const compactToggleButton = document.getElementById('preview-compact-toggle');
      const orientationSelect = document.getElementById('preview-orientation-select');
      const rootStyle = document.documentElement.style;
      const overflowWarningText = '提示：当前打印内容已超出纸张范围，请调整缩放、紧凑模式或内容后重试。';
      function isBlankAmountText(value) {
        return value.replace(/[\\s\\u00A0]/g, '') === '';
      }
      function getPreviewOrientation() {
        const canvas = document.querySelector('.preview-canvas');
        return canvas instanceof HTMLElement && canvas.classList.contains('orientation-landscape')
          ? 'landscape'
          : 'portrait';
      }
      function applyOrientation(value) {
        const canvas = document.querySelector('.preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          return;
        }
        const nextOrientation = value === 'landscape' ? 'landscape' : 'portrait';
        canvas.classList.toggle('orientation-landscape', nextOrientation === 'landscape');
        canvas.classList.toggle('orientation-portrait', nextOrientation === 'portrait');
        if (orientationSelect instanceof HTMLSelectElement && orientationSelect.value !== nextOrientation) {
          orientationSelect.value = nextOrientation;
        }
        void refreshLayoutStatus();
      }
      function hasPrintOverflow() {
        const orientation = getPreviewOrientation();
        const heightRatio = orientation === 'landscape' ? 210 / 297 : 297 / 210;
        const segments = document.querySelectorAll('.print-segment');
        for (const segment of segments) {
          if (!(segment instanceof HTMLElement)) continue;
          const rect = segment.getBoundingClientRect();
          const heightLimit = rect.width * heightRatio;
          if (rect.height > heightLimit + 1 || segment.scrollWidth > segment.clientWidth + 1) {
            return true;
          }
        }
        return false;
      }
      function fitTextNodes(selector) {
        const textNodes = document.querySelectorAll(selector);
        textNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const container = node.parentElement;
          if (!(container instanceof HTMLElement)) return;
          const baseFontSize = Number(node.dataset.baseFontSize || '${PRINT_FIT_TEXT_FONT_SIZE_PX}');
          const minFontSize = Number(node.dataset.minFontSize || '${PRINT_FIT_TEXT_MIN_FONT_SIZE_PX}');
          node.style.fontSize = baseFontSize + 'px';
          if (isBlankAmountText(node.textContent || '')) {
            return;
          }
          let fontSize = baseFontSize;
          while (
            fontSize > minFontSize &&
            (node.scrollWidth > container.clientWidth + 1 || node.scrollHeight > container.clientHeight + 1)
          ) {
            fontSize -= 0.5;
            node.style.fontSize = fontSize + 'px';
          }
        });
      }
      function fitVoucherAmountCells() {
        fitTextNodes('.voucher-amount-text');
      }
      function fitVoucherTextCells() {
        fitTextNodes('.voucher-fit-text');
      }
      function fitBookCells() {
        fitTextNodes('.print-fit-text');
      }
      async function settleVoucherAmountLayout() {
        fitVoucherAmountCells();
        fitVoucherTextCells();
        fitBookCells();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      async function ensurePrintableLayout() {
        await settleVoucherAmountLayout();
        if (hasPrintOverflow()) {
          if (statusNode) {
            statusNode.textContent = overflowWarningText;
          }
          return false;
        }
        return true;
      }
      async function refreshLayoutStatus() {
        await settleVoucherAmountLayout();
        if (!statusNode) {
          return;
        }
        statusNode.textContent = hasPrintOverflow() ? overflowWarningText : '';
      }
      function applyScale(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
          return;
        }
        rootStyle.setProperty('--preview-scale', String(numeric / 100));
        void refreshLayoutStatus();
      }
      function setCompactMode(enabled) {
        rootStyle.setProperty('--preview-padding-y', enabled ? '10mm' : '16mm');
        rootStyle.setProperty('--preview-padding-x', enabled ? '8mm' : '14mm');
        rootStyle.setProperty('--preview-cell-padding-y', enabled ? '4px' : '6px');
        rootStyle.setProperty('--preview-cell-padding-x', enabled ? '6px' : '8px');
        if (compactToggleButton instanceof HTMLButtonElement) {
          compactToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
          compactToggleButton.textContent = enabled ? '紧凑模式：开' : '紧凑模式：关';
        }
        void refreshLayoutStatus();
      }
      function toggleCompactMode() {
        const enabled = compactToggleButton instanceof HTMLButtonElement
          ? compactToggleButton.getAttribute('aria-pressed') === 'true'
          : false;
        setCompactMode(!enabled);
      }
      async function run(action, successText, failureText) {
        if (!statusNode) return;
        statusNode.textContent = '处理中...';
        try {
          const result = await action();
          if (result && result.success === false) {
            statusNode.textContent = result.error || failureText;
            return;
          }
          statusNode.textContent = successText;
        } catch (error) {
          statusNode.textContent = error instanceof Error ? error.message : failureText;
        }
      }
      window.triggerPrint = (targetJobId) =>
        run(async () => {
          const printable = await ensurePrintableLayout();
          if (!printable) {
            return { success: false, error: overflowWarningText };
          }
          return window.api.print.print({ jobId: targetJobId, orientation: getPreviewOrientation() });
        }, '已提交系统打印。', '打印失败。');
      window.triggerExportPdf = (targetJobId) =>
        run(async () => {
          const printable = await ensurePrintableLayout();
          if (!printable) {
            return { success: false, error: overflowWarningText };
          }
          return window.api.print.exportPdf({ jobId: targetJobId, orientation: getPreviewOrientation() });
        }, '打印版 PDF 已导出。', '导出 PDF 失败。');
      window.addEventListener('load', () => {
        fitVoucherAmountCells();
        fitVoucherTextCells();
        fitBookCells();
        applyOrientation('${orientation}');
        applyScale('100');
        requestAnimationFrame(() => {
          void refreshLayoutStatus();
        });
      });
      window.addEventListener('resize', () => {
        void refreshLayoutStatus();
      });
      window.addEventListener('beforeprint', () => {
        void refreshLayoutStatus();
      });
    </script>
  </body>
</html>`
}

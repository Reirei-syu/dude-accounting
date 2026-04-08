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
  rowType?: 'data' | 'subtotal' | 'total'
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

export interface PrintPageModel {
  kind: PrintDocumentSegment['kind']
  pageNumber: number
  firstRowKey: string | null
  lastRowKey: string | null
  pageHtml: string
}

export interface PrintLayoutDiagnostics {
  engine: 'page-model'
  overflowDetected: boolean
  oversizeRowKeys: string[]
  pageRowCounts: number[]
}

export interface PrintLayoutResult {
  title: string
  orientation: PrintOrientation
  settings: PrintPreviewSettings
  pageCount: number
  pages: PrintPageModel[]
  diagnostics: PrintLayoutDiagnostics
}

export interface PrintPreviewModel extends PrintLayoutResult {
  layoutVersion: number
}

export type PrintPreviewMarginPreset = 'default' | 'narrow' | 'extra-narrow'
export type PrintPreviewDensityPreset = 'default' | 'compact' | 'ultra-compact'

export interface PrintPreviewSettings {
  orientation: PrintOrientation
  scalePercent: number
  marginPreset: PrintPreviewMarginPreset
  densityPreset: PrintPreviewDensityPreset
}

const PRINT_PREVIEW_SCALE_OPTIONS = new Set([75, 80, 85, 90, 95, 100])

export function normalizePrintPreviewSettings(
  settings: Partial<PrintPreviewSettings> | undefined,
  fallbackOrientation: PrintOrientation = 'portrait'
): PrintPreviewSettings {
  const scaleCandidate = Number(settings?.scalePercent)
  const orientationCandidate = settings?.orientation
  return {
    orientation:
      orientationCandidate === 'landscape' || orientationCandidate === 'portrait'
        ? orientationCandidate
        : fallbackOrientation,
    scalePercent: PRINT_PREVIEW_SCALE_OPTIONS.has(scaleCandidate) ? scaleCandidate : 100,
    marginPreset:
      settings?.marginPreset === 'narrow' || settings?.marginPreset === 'extra-narrow'
        ? settings.marginPreset
        : 'default',
    densityPreset:
      settings?.densityPreset === 'compact' || settings?.densityPreset === 'ultra-compact'
        ? settings.densityPreset
        : 'default'
  }
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
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function resolvePrintRowHighlightKind(row: PrintTableRow): 'subtotal' | 'total' | null {
  if (row.rowType === 'subtotal' || row.rowType === 'total') {
    return row.rowType
  }

  const firstCellValue = row.cells[0]?.value
  if (typeof firstCellValue !== 'string') {
    return null
  }

  if (firstCellValue.includes('总计')) {
    return 'total'
  }
  if (firstCellValue.includes('合计')) {
    return 'subtotal'
  }
  return null
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

export function buildBookRepeatedHeaderHtml(segment: PrintTableSegment): string {
  const titleHtml =
    segment.titleMetaLines && segment.titleMetaLines.length > 0
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
      : segment.subjectLabel
        ? `
          <div class="print-book-thead-title-row">
            <span class="print-book-title">${escapeHtml(segment.title)}</span>
            <span class="print-book-subject">${escapeHtml(segment.subjectLabel)}</span>
          </div>
        `
        : `
          <div class="print-book-thead-title-row print-book-thead-title-row--centered">
            <span class="print-book-title">${escapeHtml(segment.title)}</span>
          </div>
        `

  return `
    <tr class="print-book-repeat-header">
      <th class="print-book-repeat-header-cell" colspan="${Math.max(segment.columns.length, 1)}">
        ${titleHtml}
        <div class="print-meta print-meta-book print-book-thead-meta">
          <span class="print-meta-left">编制单位：${escapeHtml(segment.ledgerName)}</span>
          <span class="print-meta-center">${escapeHtml(segment.periodLabel ? `会计期间：${segment.periodLabel}` : '')}</span>
          <span class="print-meta-right">单位：${escapeHtml(segment.unitLabel || '元')}</span>
        </div>
      </th>
    </tr>
  `
}

export function buildTableSegmentHtml(segment: PrintTableSegment, pageBreak: boolean): string {
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
      const rowHighlightKind = resolvePrintRowHighlightKind(row)
      const rowClassName =
        rowHighlightKind === 'total'
          ? 'print-row-total'
          : rowHighlightKind === 'subtotal'
            ? 'print-row-subtotal'
            : ''
      return `<tr data-row-key="${escapeHtml(row.key)}" class="${rowClassName}">${cells}</tr>`
    })
    .join('')
  const titleHtml = isBookHeader ? '' : `<h1>${escapeHtml(segment.title)}</h1>`
  const metaHtml = isBookHeader
    ? ''
    : `
        <div class="print-meta">
          ${metaLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}
        </div>
      `
  const theadHtml = isBookHeader
    ? `${buildBookRepeatedHeaderHtml(segment)}<tr class="print-book-thead-column-row">${headerHtml}</tr>`
    : `<tr>${headerHtml}</tr>`
  const sectionClassName = ['print-segment', isBookHeader ? 'print-segment-book' : '', pageBreak ? 'page-break' : '']
    .filter(Boolean)
    .join(' ')

  return `
    <section class="${sectionClassName}">
      <div class="print-document">
        ${titleHtml}
        ${metaHtml}
        <table class="print-table">
          <colgroup>${colGroupHtml}</colgroup>
          <thead>${theadHtml}</thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </section>
  `
}

export function buildVoucherSheetHtml(voucher: PrintVoucherRecord, ledgerName: string): string {
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

export function buildVoucherSegmentHtml(segment: PrintVoucherSegment, pageBreak: boolean): string {
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
  initialSettings: PrintPreviewSettings,
  persistPreferenceKey: string | null = null
): string {
  const defaultSettings = normalizePrintPreviewSettings(initialSettings, initialSettings.orientation)
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page {
        size: A4 ${defaultSettings.orientation};
        margin: 0;
      }
      :root {
        color-scheme: light;
        --voucher-table-gap: ${VOUCHER_TABLE_GAP_PX}px;
        --preview-scale: ${defaultSettings.scalePercent / 100};
        --preview-padding-y: 16mm;
        --preview-padding-x: 14mm;
        --preview-cell-padding-y: 6px;
        --preview-cell-padding-x: 8px;
        --preview-fit-cell-height: 32px;
        --preview-voucher-row-height: ${VOUCHER_ROW_HEIGHT_PX}px;
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
      .preview-control--margin,
      .preview-control--density {
        min-width: 132px;
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
      .print-segment-book {
        break-inside: avoid-page;
        page-break-inside: avoid;
      }
      .print-document h1,
      .voucher-title {
        margin: 0 0 10px;
        text-align: center;
        font-size: 20px;
        font-weight: 700;
      }
      .print-book-thead-title-row {
        display: flex;
        align-items: baseline;
        justify-content: flex-start;
        gap: 16px;
        margin: 0 0 10px;
        text-align: left;
      }
      .print-book-thead-title-row--centered {
        justify-content: center;
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
      .print-book-repeat-header-cell {
        padding: 10px 12px !important;
        background: #ffffff;
      }
      .print-book-repeat-header-cell .print-meta {
        margin-bottom: 0;
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
      .print-row-subtotal td {
        background: #ecfdf5;
      }
      .print-row-total td {
        background: #eff6ff;
      }
      .print-fit-cell {
        height: var(--preview-fit-cell-height);
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
        height: var(--preview-voucher-row-height);
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
        .print-segment-book {
          break-inside: avoid-page;
          page-break-inside: avoid;
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
          <option value="portrait"${defaultSettings.orientation === 'portrait' ? ' selected' : ''}>竖向</option>
          <option value="landscape"${defaultSettings.orientation === 'landscape' ? ' selected' : ''}>横向</option>
        </select>
      </label>
      <label class="preview-control" for="preview-scale-select">
        缩放
        <select id="preview-scale-select" onchange="applyScale(this.value)">
          <option value="100"${defaultSettings.scalePercent === 100 ? ' selected' : ''}>100%</option>
          <option value="95"${defaultSettings.scalePercent === 95 ? ' selected' : ''}>95%</option>
          <option value="90"${defaultSettings.scalePercent === 90 ? ' selected' : ''}>90%</option>
          <option value="85"${defaultSettings.scalePercent === 85 ? ' selected' : ''}>85%</option>
          <option value="80"${defaultSettings.scalePercent === 80 ? ' selected' : ''}>80%</option>
          <option value="75"${defaultSettings.scalePercent === 75 ? ' selected' : ''}>75%</option>
        </select>
      </label>
      <label class="preview-control preview-control--margin" for="preview-margin-select">
        页边距
        <select id="preview-margin-select" onchange="applyMarginPreset(this.value)">
          <option value="default"${defaultSettings.marginPreset === 'default' ? ' selected' : ''}>标准</option>
          <option value="narrow"${defaultSettings.marginPreset === 'narrow' ? ' selected' : ''}>窄</option>
          <option value="extra-narrow"${defaultSettings.marginPreset === 'extra-narrow' ? ' selected' : ''}>极窄</option>
        </select>
      </label>
      <label class="preview-control preview-control--density" for="preview-density-select">
        内容密度
        <select id="preview-density-select" onchange="applyDensityPreset(this.value)">
          <option value="default"${defaultSettings.densityPreset === 'default' ? ' selected' : ''}>标准</option>
          <option value="compact"${defaultSettings.densityPreset === 'compact' ? ' selected' : ''}>紧凑</option>
          <option value="ultra-compact"${defaultSettings.densityPreset === 'ultra-compact' ? ' selected' : ''}>超紧凑</option>
        </select>
      </label>
      <button type="button" id="preview-reset-button" onclick="resetPreviewSettings()">恢复默认</button>
      <button type="button" onclick="triggerPrint('${jobId}')">打印</button>
      <button type="button" onclick="triggerExportPdf('${jobId}')">导出 PDF</button>
      <button type="button" onclick="window.close()">关闭</button>
    </div>
    <main class="preview-canvas orientation-${defaultSettings.orientation}">${contentHtml}</main>
    <script>
      const statusNode = document.getElementById('preview-status');
      const orientationSelect = document.getElementById('preview-orientation-select');
      const scaleSelect = document.getElementById('preview-scale-select');
      const marginSelect = document.getElementById('preview-margin-select');
      const densitySelect = document.getElementById('preview-density-select');
      const rootStyle = document.documentElement.style;
      const defaultPreviewSettings = ${JSON.stringify(defaultSettings)};
      const persistPreferenceKey = ${JSON.stringify(persistPreferenceKey)};
      const overflowWarningText = '提示：当前打印内容已超出纸张范围，请调整缩放、页边距或内容密度后重试。';
      const marginPresetMap = {
        default: { paddingY: '16mm', paddingX: '14mm' },
        narrow: { paddingY: '10mm', paddingX: '8mm' },
        'extra-narrow': { paddingY: '6mm', paddingX: '4mm' }
      };
      const densityPresetMap = {
        default: {
          cellPaddingY: '6px',
          cellPaddingX: '8px',
          fitCellHeight: '32px',
          voucherRowHeight: '${VOUCHER_ROW_HEIGHT_PX}px',
          voucherGap: '${VOUCHER_TABLE_GAP_PX}px'
        },
        compact: {
          cellPaddingY: '4px',
          cellPaddingX: '6px',
          fitCellHeight: '28px',
          voucherRowHeight: '34px',
          voucherGap: '8px'
        },
        'ultra-compact': {
          cellPaddingY: '2px',
          cellPaddingX: '4px',
          fitCellHeight: '24px',
          voucherRowHeight: '30px',
          voucherGap: '6px'
        }
      };
      let activePreviewSettings = { ...defaultPreviewSettings };
      let allowPersist = false;
      let bookPaginationSequence = 0;
      const bookPaginationState = new Map();
      function isBlankAmountText(value) {
        return value.replace(/[\\s\\u00A0]/g, '') === '';
      }
      function normalizePreviewSettings(candidate, fallbackOrientation) {
        const scalePercent = Number(candidate?.scalePercent);
        return {
          orientation: candidate?.orientation === 'landscape' ? 'landscape' : fallbackOrientation,
          scalePercent: [75, 80, 85, 90, 95, 100].includes(scalePercent) ? scalePercent : 100,
          marginPreset: ['default', 'narrow', 'extra-narrow'].includes(candidate?.marginPreset)
            ? candidate.marginPreset
            : 'default',
          densityPreset: ['default', 'compact', 'ultra-compact'].includes(candidate?.densityPreset)
            ? candidate.densityPreset
            : 'default'
        };
      }
      async function persistPreviewSettings() {
        if (!allowPersist || !persistPreferenceKey) {
          return;
        }
        try {
          await window.api.settings.setUserPreferences({
            [persistPreferenceKey]: JSON.stringify(activePreviewSettings)
          });
        } catch (error) {
          console.warn('persist preview settings failed', error);
        }
      }
      function isBookSegment(segment) {
        return segment instanceof HTMLElement && segment.classList.contains('print-segment-book');
      }
      function getBookSegmentId(section) {
        if (!(section instanceof HTMLElement)) {
          return null;
        }
        if (section.dataset.bookPaginationId) {
          return section.dataset.bookPaginationId;
        }
        bookPaginationSequence += 1;
        section.dataset.bookPaginationId = 'book-segment-' + String(bookPaginationSequence);
        return section.dataset.bookPaginationId;
      }
      function ensureBookPaginationState(section) {
        const segmentId = getBookSegmentId(section);
        if (!segmentId) {
          return null;
        }
        if (bookPaginationState.has(segmentId)) {
          return bookPaginationState.get(segmentId);
        }
        const documentNode = section.querySelector('.print-document');
        const table = section.querySelector('.print-table');
        const thead = table?.querySelector('thead');
        const colgroup = table?.querySelector('colgroup');
        const tbody = table?.querySelector('tbody');
        if (!(documentNode instanceof HTMLElement) || !(table instanceof HTMLTableElement) || !(thead instanceof HTMLTableSectionElement) || !(tbody instanceof HTMLTableSectionElement)) {
          return null;
        }
        const state = {
          id: segmentId,
          baseSectionClassName: Array.from(section.classList)
            .filter((className) => className !== 'page-break')
            .join(' '),
          documentClassName: documentNode.className,
          tableClassName: table.className,
          colgroupHtml: colgroup?.outerHTML ?? '',
          theadHtml: thead.innerHTML,
          rowHtmlList: Array.from(tbody.rows).map((row) => row.outerHTML)
        };
        bookPaginationState.set(segmentId, state);
        return state;
      }
      async function loadPersistedPreviewSettings() {
        if (!persistPreferenceKey) {
          return { ...defaultPreviewSettings };
        }
        try {
          const preferences = await window.api.settings.getUserPreferences();
          const rawValue = preferences?.[persistPreferenceKey];
          if (!rawValue) {
            return { ...defaultPreviewSettings };
          }
          return normalizePreviewSettings(JSON.parse(rawValue), defaultPreviewSettings.orientation);
        } catch (error) {
          console.warn('load persisted preview settings failed', error);
          return { ...defaultPreviewSettings };
        }
      }
      function getPreviewOrientation() {
        const canvas = document.querySelector('.preview-canvas');
        return canvas instanceof HTMLElement && canvas.classList.contains('orientation-landscape')
          ? 'landscape'
          : 'portrait';
      }
      function applyOrientation(value, options = { persist: true, refresh: true }) {
        const canvas = document.querySelector('.preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          return;
        }
        const nextOrientation = value === 'landscape' ? 'landscape' : 'portrait';
        activePreviewSettings.orientation = nextOrientation;
        canvas.classList.toggle('orientation-landscape', nextOrientation === 'landscape');
        canvas.classList.toggle('orientation-portrait', nextOrientation === 'portrait');
        if (orientationSelect instanceof HTMLSelectElement && orientationSelect.value !== nextOrientation) {
          orientationSelect.value = nextOrientation;
        }
        if (options.persist) {
          void persistPreviewSettings();
        }
        if (options.refresh) {
          void refreshLayoutStatus();
        }
      }
      function hasPrintOverflow() {
        const orientation = getPreviewOrientation();
        const heightRatio = orientation === 'landscape' ? 210 / 297 : 297 / 210;
        const segments = document.querySelectorAll('.print-segment');
        for (const segment of segments) {
          if (!(segment instanceof HTMLElement)) continue;
          const rect = segment.getBoundingClientRect();
          const heightLimit = rect.width * heightRatio;
          const exceedsHeight = !isBookSegment(segment) && rect.height > heightLimit + 1;
          if (exceedsHeight || segment.scrollWidth > segment.clientWidth + 1) {
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
      async function settleVoucherAmountLayoutWithoutPagination() {
        fitVoucherAmountCells();
        fitVoucherTextCells();
        fitBookCells();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      function createBookPageSection(state, rowHtmlList, withPageBreak) {
        const section = document.createElement('section');
        section.className = [state.baseSectionClassName, withPageBreak ? 'page-break' : '']
          .filter(Boolean)
          .join(' ');
        section.dataset.bookPaginationId = state.id;
        section.innerHTML =
          '<div class="' +
          state.documentClassName +
          '"><table class="' +
          state.tableClassName +
          '">' +
          state.colgroupHtml +
          '<thead>' +
          state.theadHtml +
          '</thead><tbody>' +
          rowHtmlList.join('') +
          '</tbody></table></div>';
        return section;
      }
      async function paginateBookSegment(section) {
        if (!isBookSegment(section)) {
          return;
        }
        const state = ensureBookPaginationState(section);
        if (!state) {
          return;
        }
        const parent = section.parentElement;
        if (!(parent instanceof HTMLElement)) {
          return;
        }
        const existingSections = Array.from(
          parent.querySelectorAll('section[data-book-pagination-id="' + state.id + '"]')
        );
        const anchorSection =
          existingSections.find((item) => item === section) ?? existingSections[0] ?? section;
        const orientation = getPreviewOrientation();
        const heightRatio = orientation === 'landscape' ? 210 / 297 : 297 / 210;
        const measureHost = document.createElement('div');
        measureHost.style.position = 'absolute';
        measureHost.style.visibility = 'hidden';
        measureHost.style.pointerEvents = 'none';
        measureHost.style.left = '-99999px';
        measureHost.style.top = '0';
        document.body.appendChild(measureHost);
        const measureSection = createBookPageSection(state, [], false);
        measureHost.appendChild(measureSection);
        const measureTbody = measureSection.querySelector('tbody');
        if (!(measureTbody instanceof HTMLTableSectionElement)) {
          measureHost.remove();
          return;
        }
        const pageWidth = measureSection.getBoundingClientRect().width;
        const pageHeightLimit = pageWidth * heightRatio;
        const pages = [];
        let currentPageRows = [];
        for (const rowHtml of state.rowHtmlList) {
          const buffer = document.createElement('tbody');
          buffer.innerHTML = rowHtml;
          const rowNode = buffer.firstElementChild;
          if (!(rowNode instanceof HTMLTableRowElement)) {
            continue;
          }
          measureTbody.appendChild(rowNode);
          await settleVoucherAmountLayoutWithoutPagination();
          const currentHeight = measureSection.getBoundingClientRect().height;
          if (currentHeight > pageHeightLimit + 1) {
            measureTbody.removeChild(rowNode);
            if (currentPageRows.length === 0) {
              currentPageRows.push(rowHtml);
              pages.push(currentPageRows);
              currentPageRows = [];
            } else {
              pages.push(currentPageRows);
              currentPageRows = [rowHtml];
              measureTbody.innerHTML = '';
              for (const nextRowHtml of currentPageRows) {
                const nextBuffer = document.createElement('tbody');
                nextBuffer.innerHTML = nextRowHtml;
                const nextRowNode = nextBuffer.firstElementChild;
                if (nextRowNode instanceof HTMLTableRowElement) {
                  measureTbody.appendChild(nextRowNode);
                }
              }
            }
          } else {
            currentPageRows.push(rowHtml);
          }
        }
        if (currentPageRows.length > 0) {
          pages.push(currentPageRows);
        }
        measureHost.remove();
        const fragment = document.createDocumentFragment();
        pages.forEach((rowHtmlList, index) => {
          fragment.appendChild(
            createBookPageSection(state, rowHtmlList, index < pages.length - 1)
          );
        });
        existingSections.forEach((item) => {
          if (item !== anchorSection) {
            item.remove();
          }
        });
        anchorSection.replaceWith(fragment);
      }
      async function paginateBookSegments() {
        const sections = Array.from(document.querySelectorAll('.preview-canvas .print-segment-book'));
        for (const section of sections) {
          await paginateBookSegment(section);
        }
      }
      async function settleVoucherAmountLayout() {
        await settleVoucherAmountLayoutWithoutPagination();
        await paginateBookSegments();
        await settleVoucherAmountLayoutWithoutPagination();
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
      function applyScale(value, options = { persist: true, refresh: true }) {
        const numeric = Number(value);
        if (![75, 80, 85, 90, 95, 100].includes(numeric)) {
          return;
        }
        activePreviewSettings.scalePercent = numeric;
        rootStyle.setProperty('--preview-scale', String(numeric / 100));
        if (scaleSelect instanceof HTMLSelectElement && scaleSelect.value !== String(numeric)) {
          scaleSelect.value = String(numeric);
        }
        if (options.persist) {
          void persistPreviewSettings();
        }
        if (options.refresh) {
          void refreshLayoutStatus();
        }
      }
      function applyMarginPreset(value, options = { persist: true, refresh: true }) {
        const nextPreset = ['narrow', 'extra-narrow'].includes(value) ? value : 'default';
        const preset = marginPresetMap[nextPreset];
        activePreviewSettings.marginPreset = nextPreset;
        rootStyle.setProperty('--preview-padding-y', preset.paddingY);
        rootStyle.setProperty('--preview-padding-x', preset.paddingX);
        if (marginSelect instanceof HTMLSelectElement && marginSelect.value !== nextPreset) {
          marginSelect.value = nextPreset;
        }
        if (options.persist) {
          void persistPreviewSettings();
        }
        if (options.refresh) {
          void refreshLayoutStatus();
        }
      }
      function applyDensityPreset(value, options = { persist: true, refresh: true }) {
        const nextPreset = ['compact', 'ultra-compact'].includes(value) ? value : 'default';
        const preset = densityPresetMap[nextPreset];
        activePreviewSettings.densityPreset = nextPreset;
        rootStyle.setProperty('--preview-cell-padding-y', preset.cellPaddingY);
        rootStyle.setProperty('--preview-cell-padding-x', preset.cellPaddingX);
        rootStyle.setProperty('--preview-fit-cell-height', preset.fitCellHeight);
        rootStyle.setProperty('--preview-voucher-row-height', preset.voucherRowHeight);
        rootStyle.setProperty('--voucher-table-gap', preset.voucherGap);
        if (densitySelect instanceof HTMLSelectElement && densitySelect.value !== nextPreset) {
          densitySelect.value = nextPreset;
        }
        if (options.persist) {
          void persistPreviewSettings();
        }
        if (options.refresh) {
          void refreshLayoutStatus();
        }
      }
      function applyPreviewSettings(settings, options = { persist: true, refresh: true }) {
        const normalized = normalizePreviewSettings(settings, defaultPreviewSettings.orientation);
        applyOrientation(normalized.orientation, { persist: false, refresh: false });
        applyScale(String(normalized.scalePercent), { persist: false, refresh: false });
        applyMarginPreset(normalized.marginPreset, { persist: false, refresh: false });
        applyDensityPreset(normalized.densityPreset, { persist: false, refresh: false });
        activePreviewSettings = normalized;
        if (options.persist) {
          void persistPreviewSettings();
        }
        if (options.refresh) {
          void refreshLayoutStatus();
        }
      }
      function resetPreviewSettings() {
        applyPreviewSettings(defaultPreviewSettings, { persist: true, refresh: true });
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
        void (async () => {
          applyPreviewSettings(defaultPreviewSettings, { persist: false, refresh: false });
          const storedSettings = await loadPersistedPreviewSettings();
          applyPreviewSettings(storedSettings, { persist: false, refresh: false });
          allowPersist = true;
          requestAnimationFrame(() => {
            void refreshLayoutStatus();
          });
        })();
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

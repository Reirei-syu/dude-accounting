import {
  buildTableSegmentHtml,
  normalizePrintPreviewSettings,
  type PrintPreviewSettings,
  type PrintTableSegment
} from './print'

function resolveMarginPresetValues(settings: PrintPreviewSettings): {
  paddingY: string
  paddingX: string
} {
  switch (settings.marginPreset) {
    case 'narrow':
      return { paddingY: '10mm', paddingX: '8mm' }
    case 'extra-narrow':
      return { paddingY: '6mm', paddingX: '4mm' }
    default:
      return { paddingY: '16mm', paddingX: '14mm' }
  }
}

function resolveDensityPresetValues(settings: PrintPreviewSettings): {
  cellPaddingY: string
  cellPaddingX: string
  fitCellHeight: string
  voucherRowHeight: string
} {
  switch (settings.densityPreset) {
    case 'compact':
      return {
        cellPaddingY: '4px',
        cellPaddingX: '6px',
        fitCellHeight: '28px',
        voucherRowHeight: '34px'
      }
    case 'ultra-compact':
      return {
        cellPaddingY: '2px',
        cellPaddingX: '4px',
        fitCellHeight: '24px',
        voucherRowHeight: '30px'
      }
    default:
      return {
        cellPaddingY: '6px',
        cellPaddingX: '8px',
        fitCellHeight: '32px',
        voucherRowHeight: '38.4px'
      }
  }
}

export function buildTableMeasurementHtml(
  segment: PrintTableSegment,
  initialSettings: PrintPreviewSettings
): string {
  const settings = normalizePrintPreviewSettings(initialSettings, initialSettings.orientation)
  const marginValues = resolveMarginPresetValues(settings)
  const densityValues = resolveDensityPresetValues(settings)
  const contentHtml = buildTableSegmentHtml(segment, false)

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>print-measure</title>
    <style>
      @page {
        size: A4 ${settings.orientation};
        margin: 0;
      }
      :root {
        color-scheme: light;
        --preview-scale: ${settings.scalePercent / 100};
        --preview-padding-y: ${marginValues.paddingY};
        --preview-padding-x: ${marginValues.paddingX};
        --preview-cell-padding-y: ${densityValues.cellPaddingY};
        --preview-cell-padding-x: ${densityValues.cellPaddingX};
        --preview-fit-cell-height: ${densityValues.fitCellHeight};
        --preview-voucher-row-height: ${densityValues.voucherRowHeight};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Microsoft YaHei", "SimSun", sans-serif;
        background: #ffffff;
        color: #111827;
      }
      .preview-canvas {
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
        margin: 0;
        padding: var(--preview-padding-y) var(--preview-padding-x);
        background: #ffffff;
      }
      .print-segment-book {
        break-inside: avoid-page;
        page-break-inside: avoid;
      }
      .print-document h1 {
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
      .print-meta {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        font-size: 11px;
        margin-bottom: 10px;
      }
      .print-book-repeat-header-cell {
        padding: 10px 12px !important;
        background: #ffffff;
      }
      .print-book-repeat-header-cell .print-meta {
        margin-bottom: 0;
      }
      .print-meta span {
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
      }
      .print-meta-book .print-meta-right {
        text-align: right;
      }
      .print-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        font-size: 12px;
      }
      .print-table thead {
        display: table-header-group;
      }
      .print-table th,
      .print-table td {
        border: 1px solid #111827;
        padding: var(--preview-cell-padding-y) var(--preview-cell-padding-x);
        vertical-align: middle;
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
        font-size: 12px;
      }
      .align-left { text-align: left; }
      .align-center { text-align: center; }
      .align-right { text-align: right; }
    </style>
  </head>
  <body>
    <main class="preview-canvas orientation-${settings.orientation}">
      ${contentHtml}
    </main>
  </body>
</html>`
}

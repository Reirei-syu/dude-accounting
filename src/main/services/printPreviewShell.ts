import {
  normalizePrintPreviewSettings,
  type PrintPreviewModel
} from './print'

const VOUCHER_TABLE_GAP_PX = 10
const VOUCHER_ROW_HEIGHT_PX = 38.4

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildPagedPrintPreviewHtml(
  jobId: string,
  initialModel: PrintPreviewModel
): string {
  const defaultSettings = normalizePrintPreviewSettings(
    initialModel.settings,
    initialModel.settings.orientation
  )
  const serializedModel = JSON.stringify(initialModel).replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(initialModel.title)}</title>
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
      }
      .preview-page-list {
        zoom: var(--preview-scale);
        transform-origin: top center;
      }
      .preview-page-card {
        margin: 0 auto 18px;
      }
      .preview-page-label {
        width: fit-content;
        margin: 0 auto 8px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
        color: #475569;
        font-size: 12px;
        font-weight: 600;
      }
      .preview-page-list.orientation-portrait .print-segment {
        width: 210mm;
        min-height: 297mm;
      }
      .preview-page-list.orientation-landscape .print-segment {
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
        font-size: 12px;
      }
      .voucher-amount-text {
        display: inline-block;
        width: 100%;
        white-space: nowrap;
        text-align: right;
        line-height: 1.2;
        font-size: 12px;
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
      .voucher-meta-left { text-align: left; }
      .voucher-meta-center { text-align: center; }
      .voucher-meta-right { text-align: right; }
      @media print {
        body { background: #ffffff; }
        .preview-toolbar,
        .preview-page-label {
          display: none !important;
        }
        .preview-canvas { padding: 0; }
        .preview-page-card { margin: 0; }
        .print-segment {
          margin: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="preview-toolbar">
      <h1>${escapeHtml(initialModel.title)}</h1>
      <span id="preview-status" class="preview-status"></span>
      <label class="preview-control preview-control--orientation" for="preview-orientation-select">
        纸张方向
        <select id="preview-orientation-select" onchange="handleSettingChange({ orientation: this.value })">
          <option value="portrait"${defaultSettings.orientation === 'portrait' ? ' selected' : ''}>竖向</option>
          <option value="landscape"${defaultSettings.orientation === 'landscape' ? ' selected' : ''}>横向</option>
        </select>
      </label>
      <label class="preview-control" for="preview-scale-select">
        缩放
        <select id="preview-scale-select" onchange="handleSettingChange({ scalePercent: Number(this.value) })">
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
        <select id="preview-margin-select" onchange="handleSettingChange({ marginPreset: this.value })">
          <option value="default"${defaultSettings.marginPreset === 'default' ? ' selected' : ''}>标准</option>
          <option value="narrow"${defaultSettings.marginPreset === 'narrow' ? ' selected' : ''}>窄</option>
          <option value="extra-narrow"${defaultSettings.marginPreset === 'extra-narrow' ? ' selected' : ''}>极窄</option>
        </select>
      </label>
      <label class="preview-control preview-control--density" for="preview-density-select">
        内容密度
        <select id="preview-density-select" onchange="handleSettingChange({ densityPreset: this.value })">
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
    <main class="preview-canvas">
      <div id="preview-page-list" class="preview-page-list"></div>
    </main>
    <script>
      window.__PRINT_PREVIEW_MODEL__ = null;
      const statusNode = document.getElementById('preview-status');
      const pageListNode = document.getElementById('preview-page-list');
      const orientationSelect = document.getElementById('preview-orientation-select');
      const scaleSelect = document.getElementById('preview-scale-select');
      const marginSelect = document.getElementById('preview-margin-select');
      const densitySelect = document.getElementById('preview-density-select');
      const rootStyle = document.documentElement.style;
      const initialPreviewModel = ${serializedModel};
      const defaultPreviewSettings = ${JSON.stringify(defaultSettings)};
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
      let activePreviewSettings = { ...initialPreviewModel.settings };
      let isUpdating = false;

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

      function applyPreviewVariables(settings) {
        const normalized = normalizePreviewSettings(settings, defaultPreviewSettings.orientation);
        const marginPreset = marginPresetMap[normalized.marginPreset] || marginPresetMap.default;
        const densityPreset = densityPresetMap[normalized.densityPreset] || densityPresetMap.default;
        rootStyle.setProperty('--preview-scale', String(normalized.scalePercent / 100));
        rootStyle.setProperty('--preview-padding-y', marginPreset.paddingY);
        rootStyle.setProperty('--preview-padding-x', marginPreset.paddingX);
        rootStyle.setProperty('--preview-cell-padding-y', densityPreset.cellPaddingY);
        rootStyle.setProperty('--preview-cell-padding-x', densityPreset.cellPaddingX);
        rootStyle.setProperty('--preview-fit-cell-height', densityPreset.fitCellHeight);
        rootStyle.setProperty('--preview-voucher-row-height', densityPreset.voucherRowHeight);
        rootStyle.setProperty('--voucher-table-gap', densityPreset.voucherGap);
      }

      function syncControls(settings) {
        if (orientationSelect instanceof HTMLSelectElement) orientationSelect.value = settings.orientation;
        if (scaleSelect instanceof HTMLSelectElement) scaleSelect.value = String(settings.scalePercent);
        if (marginSelect instanceof HTMLSelectElement) marginSelect.value = settings.marginPreset;
        if (densitySelect instanceof HTMLSelectElement) densitySelect.value = settings.densityPreset;
      }

      function fitTextNodes(selector) {
        const textNodes = document.querySelectorAll(selector);
        textNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          const container = node.parentElement;
          if (!(container instanceof HTMLElement)) return;
          const baseFontSize = Number(node.dataset.baseFontSize || '12');
          const minFontSize = Number(node.dataset.minFontSize || '8');
          node.style.fontSize = baseFontSize + 'px';
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

      async function settleLayout() {
        fitTextNodes('.voucher-amount-text');
        fitTextNodes('.voucher-fit-text');
        fitTextNodes('.print-fit-text');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }

      function getStatusText(model) {
        if (model?.diagnostics?.overflowDetected && Array.isArray(model?.diagnostics?.oversizeRowKeys)) {
          return '提示：仍有 ' + model.diagnostics.oversizeRowKeys.length + ' 行内容超过单页高度，打印结果可能被截断。';
        }
        return '共 ' + String(model.pageCount || 0) + ' 页';
      }

      function renderPreviewModel(model) {
        window.__PRINT_PREVIEW_MODEL__ = model;
        activePreviewSettings = { ...model.settings };
        applyPreviewVariables(activePreviewSettings);
        syncControls(activePreviewSettings);
        if (pageListNode instanceof HTMLElement) {
          pageListNode.classList.toggle('orientation-landscape', activePreviewSettings.orientation === 'landscape');
          pageListNode.classList.toggle('orientation-portrait', activePreviewSettings.orientation !== 'landscape');
          pageListNode.innerHTML = (model.pages || [])
            .map((page) =>
              '<section class="preview-page-card" data-page-number="' +
              String(page.pageNumber) +
              '">' +
              '<div class="preview-page-label">第 ' +
              String(page.pageNumber) +
              ' / ' +
              String(model.pageCount) +
              ' 页</div>' +
              page.pageHtml +
              '</section>'
            )
            .join('');
        }
        if (statusNode instanceof HTMLElement) {
          statusNode.textContent = getStatusText(model);
        }
        void settleLayout();
      }

      async function refreshPreviewModel(nextSettings) {
        if (isUpdating) return;
        isUpdating = true;
        if (statusNode instanceof HTMLElement) {
          statusNode.textContent = '正在重排分页...';
        }
        try {
          const result = await window.api.print.updatePreviewSettings({
            jobId: '${jobId}',
            settings: nextSettings
          });
          if (!result?.success || !result.model) {
            if (statusNode instanceof HTMLElement) {
              statusNode.textContent = result?.error || '更新打印预览失败';
            }
            return;
          }
          renderPreviewModel(result.model);
        } catch (error) {
          if (statusNode instanceof HTMLElement) {
            statusNode.textContent = error instanceof Error ? error.message : '更新打印预览失败';
          }
        } finally {
          isUpdating = false;
        }
      }

      window.handleSettingChange = (partialSettings) => {
        const nextSettings = normalizePreviewSettings(
          { ...activePreviewSettings, ...partialSettings },
          defaultPreviewSettings.orientation
        );
        void refreshPreviewModel(nextSettings);
      };
      window.resetPreviewSettings = () => {
        void refreshPreviewModel(defaultPreviewSettings);
      };

      async function run(action, successText, failureText) {
        if (!(statusNode instanceof HTMLElement)) return;
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
        run(() => window.api.print.print(targetJobId), '已提交系统打印。', '打印失败。');
      window.triggerExportPdf = (targetJobId) =>
        run(() => window.api.print.exportPdf(targetJobId), '打印版 PDF 已导出。', '导出 PDF 失败。');

      window.addEventListener('load', () => {
        renderPreviewModel(initialPreviewModel);
      });
      window.addEventListener('resize', () => {
        void settleLayout();
      });
      window.addEventListener('beforeprint', () => {
        void settleLayout();
      });
    </script>
  </body>
</html>`
}

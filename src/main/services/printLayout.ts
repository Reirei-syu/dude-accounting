import {
  buildTableSegmentHtml,
  buildVoucherSegmentHtml,
  type PrintLayoutDiagnostics,
  type PrintLayoutResult,
  type PrintOrientation,
  type PrintPageModel,
  type PrintPreviewSettings,
  type PrintTableCell,
  type PrintTableRow,
  type PrintTableSegment,
  type PrintVoucherRecord,
  type PrintVoucherSegment
} from './print'

interface PrintPageDraft {
  kind: PrintPageModel['kind']
  firstRowKey: string | null
  lastRowKey: string | null
  rowCount: number
  render: (pageBreak: boolean) => string
}

function measureTextUnits(value: string): number {
  return Array.from(value).reduce((total, char) => {
    if (/\d/.test(char)) return total + 0.9
    if (/[A-Za-z]/.test(char)) return total + 0.75
    if (char === ' ') return total + 0.45
    return total + 1.6
  }, 0)
}

function formatCellValue(cell: PrintTableCell): string {
  if (typeof cell.value === 'number') {
    return cell.isAmount ? cell.value.toFixed(2) : String(cell.value)
  }
  return String(cell.value ?? '')
}

function buildColumnWidthPercents(segment: PrintTableSegment): number[] {
  const rawWeights = segment.columns.map((column, columnIndex) => {
    const headerWeight = measureTextUnits(column.label)
    const cellWeight = segment.rows.reduce((maxWeight, row) => {
      const cell = row.cells[columnIndex]
      if (!cell) return maxWeight
      return Math.max(maxWeight, measureTextUnits(formatCellValue(cell)))
    }, 0)
    const minWeight = column.align === 'right' ? 7 : 6
    return Math.max(headerWeight, cellWeight, minWeight)
  })

  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0) || 1
  return rawWeights.map((weight) => (weight / totalWeight) * 100)
}

function estimateTableRowHeight(
  row: PrintTableRow,
  settings: PrintPreviewSettings,
  columnWidths: number[]
): number {
  const scaleFactor = settings.scalePercent / 100
  const baseRowHeight =
    settings.densityPreset === 'ultra-compact'
      ? 22
      : settings.densityPreset == 'compact'
        ? 28
        : 34

  const pageCharBudget =
    settings.orientation === 'landscape'
      ? settings.marginPreset === 'extra-narrow'
        ? 175
        : settings.marginPreset === 'narrow'
          ? 160
          : 148
      : settings.marginPreset === 'extra-narrow'
        ? 132
        : settings.marginPreset === 'narrow'
          ? 120
          : 108

  const wrappedLines = row.cells.reduce((maxLines, cell, index) => {
    const text = formatCellValue(cell)
    if (!text) return maxLines
    const capacity = Math.max(6, (columnWidths[index] ?? 10) / 100 * pageCharBudget)
    return Math.max(maxLines, Math.ceil(measureTextUnits(text) / capacity))
  }, 1)

  return baseRowHeight * Math.max(1, wrappedLines) * scaleFactor
}

export function estimateTableRowGroups(
  segment: PrintTableSegment,
  settings: PrintPreviewSettings
): {
  rowKeyGroups: string[][]
  oversizeRowKeys: string[]
} {
  const columnWidths = buildColumnWidthPercents(segment)
  const pageHeight =
    settings.orientation === 'landscape'
      ? settings.marginPreset === 'extra-narrow'
        ? 690
        : settings.marginPreset === 'narrow'
          ? 640
          : 590
      : settings.marginPreset === 'extra-narrow'
        ? 1040
        : settings.marginPreset === 'narrow'
          ? 980
          : 920
  const headerHeight =
    segment.headerMode === 'book'
      ? settings.orientation === 'landscape'
        ? 150
        : 170
      : settings.orientation === 'landscape'
        ? 108
        : 124
  const columnHeaderHeight =
    settings.densityPreset === 'ultra-compact'
      ? 28
      : settings.densityPreset === 'compact'
        ? 32
        : 38

  const availableBodyHeight = Math.max(160, pageHeight - headerHeight - columnHeaderHeight)
  const rowKeyGroups: string[][] = []
  const oversizeRowKeys: string[] = []
  let currentGroup: string[] = []
  let currentHeight = 0

  for (const row of segment.rows) {
    const rowHeight = estimateTableRowHeight(row, settings, columnWidths)
    if (currentGroup.length > 0 && currentHeight + rowHeight > availableBodyHeight) {
      rowKeyGroups.push(currentGroup)
      currentGroup = []
      currentHeight = 0
    }
    if (rowHeight > availableBodyHeight) {
      oversizeRowKeys.push(row.key)
    }
    currentGroup.push(row.key)
    currentHeight += rowHeight
  }

  if (currentGroup.length > 0 || rowKeyGroups.length === 0) {
    rowKeyGroups.push(currentGroup)
  }

  return {
    rowKeyGroups,
    oversizeRowKeys
  }
}

function finalizePrintLayoutResult(
  title: string,
  orientation: PrintOrientation,
  settings: PrintPreviewSettings,
  drafts: PrintPageDraft[],
  diagnostics: Omit<PrintLayoutDiagnostics, 'engine'>
): PrintLayoutResult {
  const pages = drafts.map((draft, index) => ({
    kind: draft.kind,
    pageNumber: index + 1,
    firstRowKey: draft.firstRowKey,
    lastRowKey: draft.lastRowKey,
    pageHtml: draft.render(index < drafts.length - 1)
  }))

  return {
    title,
    orientation,
    settings,
    pageCount: pages.length,
    pages,
    diagnostics: {
      engine: 'page-model',
      ...diagnostics
    }
  }
}

export function buildTablePageDrafts(
  segment: PrintTableSegment,
  rowKeyGroups: string[][]
): PrintPageDraft[] {
  const rowMap = new Map<string, PrintTableRow>(segment.rows.map((row) => [row.key, row]))
  const groups = rowKeyGroups.length > 0 ? rowKeyGroups : [[]]

  return groups
    .map((rowKeys) => {
      const rows = rowKeys
        .map((rowKey) => rowMap.get(rowKey))
        .filter((row): row is PrintTableRow => Boolean(row))

      return {
        kind: 'table' as const,
        firstRowKey: rowKeys[0] ?? null,
        lastRowKey: rowKeys.length > 0 ? rowKeys[rowKeys.length - 1] ?? null : null,
        rowCount: rows.length,
        render: (pageBreak: boolean) =>
          buildTableSegmentHtml(
            {
              ...segment,
              rows
            },
            pageBreak
          )
      }
    })
}

export function buildVoucherPageDrafts(segment: PrintVoucherSegment): PrintPageDraft[] {
  if (segment.layout === 'double') {
    const pageVoucherGroups: PrintVoucherRecord[][] = []
    for (let index = 0; index < segment.vouchers.length; index += 2) {
      pageVoucherGroups.push(segment.vouchers.slice(index, index + 2))
    }

    return pageVoucherGroups.map((vouchers) => ({
      kind: 'voucher' as const,
      firstRowKey: vouchers[0] ? String(vouchers[0].id) : null,
      lastRowKey: vouchers[vouchers.length - 1] ? String(vouchers[vouchers.length - 1].id) : null,
      rowCount: vouchers.length,
      render: (pageBreak: boolean) =>
        buildVoucherSegmentHtml(
          {
            ...segment,
            vouchers
          },
          pageBreak
        )
    }))
  }

  return segment.vouchers.map((voucher) => ({
    kind: 'voucher' as const,
    firstRowKey: String(voucher.id),
    lastRowKey: String(voucher.id),
    rowCount: 1,
    render: (pageBreak: boolean) =>
      buildVoucherSegmentHtml(
        {
          ...segment,
          vouchers: [voucher]
        },
        pageBreak
      )
  }))
}

export function buildTableLayoutResult(params: {
  title: string
  orientation: PrintOrientation
  settings: PrintPreviewSettings
  segmentDrafts: Array<{
    segment: PrintTableSegment
    rowKeyGroups: string[][]
  }>
  oversizeRowKeys: string[]
}): PrintLayoutResult {
  const drafts = params.segmentDrafts.flatMap(({ segment, rowKeyGroups }) =>
    buildTablePageDrafts(segment, rowKeyGroups)
  )

  return finalizePrintLayoutResult(params.title, params.orientation, params.settings, drafts, {
    overflowDetected: params.oversizeRowKeys.length > 0,
    oversizeRowKeys: [...params.oversizeRowKeys],
    pageRowCounts: drafts.map((draft) => draft.rowCount)
  })
}

export function buildVoucherLayoutResult(params: {
  title: string
  orientation: PrintOrientation
  settings: PrintPreviewSettings
  segments: PrintVoucherSegment[]
}): PrintLayoutResult {
  const drafts = params.segments.flatMap((segment) => buildVoucherPageDrafts(segment))
  return finalizePrintLayoutResult(params.title, params.orientation, params.settings, drafts, {
    overflowDetected: false,
    oversizeRowKeys: [],
    pageRowCounts: drafts.map((draft) => draft.rowCount)
  })
}

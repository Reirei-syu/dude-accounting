import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { ensureDirectory, sanitizePathSegment } from './fileIntegrity'

export type BookExportFormat = 'xlsx' | 'pdf'

export interface BookExportColumn {
  key: string
  label: string
  align?: 'left' | 'center' | 'right'
}

export interface BookExportCell {
  value: string | number | null
  isAmount?: boolean
}

export interface BookExportRow {
  key: string
  rowType?: 'data' | 'subtotal' | 'total'
  cells: BookExportCell[]
}

export interface BookExportPayload {
  ledgerId: number
  bookType: string
  title: string
  subtitle?: string
  ledgerName?: string
  subjectLabel?: string
  periodLabel?: string
  columns: BookExportColumn[]
  rows: BookExportRow[]
}

function sanitizeFileName(value: string): string {
  return sanitizePathSegment(value, '账簿导出').slice(0, 120)
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function resolveRowHighlightKind(
  row: BookExportRow
): 'subtotal' | 'total' | null {
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

function formatCellValue(cell: BookExportCell): string {
  if (typeof cell.value === 'number') {
    return cell.isAmount ? formatAmount(cell.value) : String(cell.value)
  }
  return String(cell.value ?? '')
}

function getColumnAlignment(
  column: BookExportColumn | undefined,
  cell: BookExportCell | undefined
): 'left' | 'center' | 'right' {
  if (column?.align) {
    return column.align
  }
  if (cell?.isAmount) {
    return 'right'
  }
  return 'left'
}

function resolveCjkFontPath(): string | null {
  const windowsDir = process.env.WINDIR ?? 'C:\\Windows'
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(windowsDir, 'Fonts', 'simhei.ttf'),
          path.join(windowsDir, 'Fonts', 'msyh.ttf'),
          path.join(windowsDir, 'Fonts', 'arialuni.ttf'),
          path.join(windowsDir, 'Fonts', 'simsun.ttc'),
          path.join(windowsDir, 'Fonts', 'msyh.ttc')
        ]
      : process.platform === 'darwin'
        ? [
            '/System/Library/Fonts/Hiragino Sans GB.ttc',
            '/System/Library/Fonts/STHeiti Light.ttc',
            '/System/Library/Fonts/PingFang.ttc'
          ]
        : [
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
          ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function tryApplyFont(document: PDFKit.PDFDocument, fontPath: string | null): boolean {
  if (!fontPath) {
    return false
  }

  try {
    document.font(fontPath)
    return true
  } catch {
    return false
  }
}

function measureDisplayWidth(text: string): number {
  let width = 0
  for (const character of text) {
    width += character.charCodeAt(0) > 255 ? 2 : 1
  }
  return width
}

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized ? normalized : undefined
}

function getDisplayTitle(payload: BookExportPayload): string {
  return normalizeText(payload.title) ?? '账簿导出'
}

function sanitizeWorksheetName(value: string, fallback = '账簿导出'): string {
  const normalized = value
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^'+|'+$/g, '')

  const candidate = (normalized || fallback).slice(0, 31).trim()
  return candidate || fallback
}

function getColumnLabel(column: BookExportColumn, index: number): string {
  return normalizeText(column.label) ?? `列${index + 1}`
}

function buildDefaultMetaSubtitle(payload: BookExportPayload): string {
  const subtitle = normalizeText(payload.subtitle)
  if (subtitle) {
    return subtitle
  }

  const metaSubtitle = [normalizeText(payload.subjectLabel), normalizeText(payload.periodLabel)]
    .filter((value): value is string => Boolean(value))
    .join('-')

  return metaSubtitle || getDisplayTitle(payload)
}

function buildExcelColumnWidths(payload: BookExportPayload): number[] {
  return payload.columns.map((column, index) => {
    const headerWidth = measureDisplayWidth(getColumnLabel(column, index))
    const cellWidth = payload.rows.reduce((maxWidth, row) => {
      const cell = row.cells[index]
      const text = formatCellValue(cell ?? { value: '' })
      return Math.max(maxWidth, measureDisplayWidth(text))
    }, 0)

    return Math.min(60, Math.max(10, headerWidth, cellWidth) + 2)
  })
}

function buildPdfLayout(
  document: PDFKit.PDFDocument,
  payload: BookExportPayload,
  pageWidth: number,
  hasCjkFont: boolean,
  cjkFontPath: string | null
): {
  columnWidths: number[]
  bodyFontSize: number
  headerFontSize: number
  rowHeight: number
} {
  const baseBodyFontSize = 10
  const baseHeaderFontSize = 10.5
  const padding = 16

  const measureText = (text: string, fontSize: number): number => {
    if (hasCjkFont) {
      tryApplyFont(document, cjkFontPath)
    }
    document.fontSize(fontSize)
    return document.widthOfString(text)
  }

  const naturalWidths = payload.columns.map((column, index) => {
    const headerWidth = measureText(getColumnLabel(column, index), baseHeaderFontSize) + padding
    const cellWidth = payload.rows.reduce((maxWidth, row) => {
      const cellText = formatCellValue(row.cells[index] ?? { value: '' })
      return Math.max(maxWidth, measureText(cellText, baseBodyFontSize) + padding)
    }, 0)
    return Math.max(headerWidth, cellWidth, column.align === 'right' ? 56 : 44)
  })

  const naturalTotalWidth = naturalWidths.reduce((sum, width) => sum + width, 0)
  const widthScale = naturalTotalWidth > 0 ? pageWidth / naturalTotalWidth : 1
  const fontScale = naturalTotalWidth > pageWidth ? widthScale : 1

  return {
    columnWidths: naturalWidths.map((width) => width * widthScale),
    bodyFontSize: Math.max(7, baseBodyFontSize * fontScale),
    headerFontSize: Math.max(7.5, baseHeaderFontSize * fontScale),
    rowHeight: Math.max(18, Math.ceil(24 * fontScale))
  }
}

function writeExcelMetaRows(
  worksheet: ExcelJS.Worksheet,
  columnCount: number,
  payload: BookExportPayload
): void {
  const displayTitle = getDisplayTitle(payload)
  const displayLedgerName = normalizeText(payload.ledgerName) ?? ' '
  const subjectLabel = normalizeText(payload.subjectLabel)
  const periodLabel = normalizeText(payload.periodLabel)

  worksheet.mergeCells(1, 1, 1, columnCount)
  worksheet.getCell(1, 1).value = displayTitle
  worksheet.getCell(1, 1).font = { name: '宋体', size: 16, bold: true }
  worksheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  worksheet.mergeCells(2, 1, 2, columnCount)
  worksheet.getCell(2, 1).value = displayLedgerName
  worksheet.getCell(2, 1).font = { name: '宋体', size: 10 }
  worksheet.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  if (subjectLabel && periodLabel) {
    const splitColumn = Math.max(1, Math.floor(columnCount / 2))
    worksheet.mergeCells(3, 1, 3, splitColumn)
    worksheet.getCell(3, 1).value = subjectLabel
    worksheet.getCell(3, 1).font = { name: '宋体', size: 10 }
    worksheet.getCell(3, 1).alignment = { horizontal: 'left', vertical: 'middle' }

    if (splitColumn < columnCount) {
      worksheet.mergeCells(3, splitColumn + 1, 3, columnCount)
      worksheet.getCell(3, splitColumn + 1).value = periodLabel
      worksheet.getCell(3, splitColumn + 1).font = { name: '宋体', size: 10 }
      worksheet.getCell(3, splitColumn + 1).alignment = {
        horizontal: 'right',
        vertical: 'middle'
      }
    }
    return
  }

  worksheet.mergeCells(3, 1, 3, columnCount)
  worksheet.getCell(3, 1).value = subjectLabel ?? periodLabel ?? ' '
  worksheet.getCell(3, 1).font = { name: '宋体', size: 10 }
  worksheet.getCell(3, 1).alignment = {
    horizontal: subjectLabel ? 'left' : 'right',
    vertical: 'middle'
  }
}

export function buildDefaultBookExportFileName(
  payload: BookExportPayload,
  format: BookExportFormat
): string {
  const displayTitle = getDisplayTitle(payload)
  const subtitle = buildDefaultMetaSubtitle(payload)
  const baseName = subtitle && subtitle !== displayTitle ? `${displayTitle}-${subtitle}` : displayTitle
  return `${sanitizeFileName(baseName)}.${format}`
}

export async function writeBookExportExcel(
  filePath: string,
  payload: BookExportPayload
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const sheetName = sanitizeWorksheetName(getDisplayTitle(payload))
  const worksheet = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 5 }]
  })

  const columnCount = Math.max(payload.columns.length, 1)
  writeExcelMetaRows(worksheet, columnCount, payload)

  const headerRowIndex = 5
  const headerRow = worksheet.getRow(headerRowIndex)
  payload.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = getColumnLabel(column, index)
    cell.font = { name: '宋体', size: 11, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
  })

  payload.rows.forEach((row, rowIndex) => {
    const excelRow = worksheet.getRow(headerRowIndex + 1 + rowIndex)

    row.cells.forEach((cell, cellIndex) => {
      const targetCell = excelRow.getCell(cellIndex + 1)
      if (typeof cell.value === 'number' && cell.isAmount) {
        targetCell.value = cell.value
        targetCell.numFmt = '#,##0.00'
      } else {
        targetCell.value = cell.value === null ? '' : cell.value
      }

      targetCell.font = { name: '宋体', size: 10 }
      targetCell.alignment = {
        horizontal: getColumnAlignment(payload.columns[cellIndex], cell),
        vertical: 'middle'
      }
      targetCell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })

    const highlightKind = resolveRowHighlightKind(row)
    if (highlightKind) {
      const fillColor = highlightKind === 'total' ? 'FFEFF6FF' : 'FFECFDF5'
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor }
        }
      })
    }
  })

  worksheet.columns = payload.columns.map((column, index) => ({
    key: column.key || `col_${index + 1}`,
    width: buildExcelColumnWidths(payload)[index]
  }))

  ensureDirectory(path.dirname(filePath))
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

export async function writeBookExportPdf(
  filePath: string,
  payload: BookExportPayload
): Promise<string> {
  ensureDirectory(path.dirname(filePath))

  await new Promise<void>((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      layout: payload.columns.length > 8 ? 'landscape' : 'portrait',
      margin: 36,
      bufferPages: true
    })
    const stream = fs.createWriteStream(filePath)
    const cjkFontPath = resolveCjkFontPath()

    document.pipe(stream)
    const hasCjkFont = tryApplyFont(document, cjkFontPath)

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right
    const layout = buildPdfLayout(document, payload, pageWidth, hasCjkFont, cjkFontPath)

    const drawMetadata = (): number => {
      if (hasCjkFont) {
        tryApplyFont(document, cjkFontPath)
      }

      document.fontSize(18).text(getDisplayTitle(payload), { align: 'center' })
      document.moveDown(0.25)

      if (hasCjkFont) {
        tryApplyFont(document, cjkFontPath)
      }
      document.fontSize(10).text(normalizeText(payload.ledgerName) ?? '', { align: 'center' })
      document.moveDown(0.25)

      const metaTop = document.y
      const subjectLabel = normalizeText(payload.subjectLabel)
      const periodLabel = normalizeText(payload.periodLabel)

      if (subjectLabel && periodLabel) {
        document.text(subjectLabel, document.page.margins.left, metaTop, {
          width: pageWidth / 2,
          align: 'left'
        })
        document.text(periodLabel, document.page.margins.left + pageWidth / 2, metaTop, {
          width: pageWidth / 2,
          align: 'right'
        })
        return metaTop + 18
      }

      if (subjectLabel) {
        document.text(subjectLabel, document.page.margins.left, metaTop, {
          width: pageWidth,
          align: 'left'
        })
        return metaTop + 18
      }

      document.text(periodLabel ?? '', document.page.margins.left, metaTop, {
        width: pageWidth,
        align: 'right'
      })
      return metaTop + 18
    }

    const drawRow = (
      row: BookExportRow | { cells: BookExportCell[] },
      top: number,
      options?: { bold?: boolean; fillColor?: string; header?: boolean }
    ): number => {
      if (options?.fillColor) {
        document.save()
        document
          .fillColor(options.fillColor)
          .rect(document.page.margins.left, top, pageWidth, layout.rowHeight)
          .fill()
        document.restore()
      }

      let left = document.page.margins.left
      row.cells.forEach((cell, index) => {
        const width = layout.columnWidths[index] ?? 0
        document.rect(left, top, width, layout.rowHeight).stroke('#111827')
        if (hasCjkFont) {
          tryApplyFont(document, cjkFontPath)
        }
        document
          .fontSize(options?.bold ? layout.headerFontSize : layout.bodyFontSize)
          .text(formatCellValue(cell), left + 6, top + 5, {
            width: Math.max(1, width - 12),
            align: options?.header ? 'center' : getColumnAlignment(payload.columns[index], cell),
            height: Math.max(1, layout.rowHeight - 10)
          })
        left += width
      })

      return top + layout.rowHeight
    }

    let top = drawMetadata() + 6
    top = drawRow(
      {
        cells: payload.columns.map((column, index) => ({ value: getColumnLabel(column, index) }))
      },
      top,
      { bold: true, header: true, fillColor: '#f3f4f6' }
    )

    for (const row of payload.rows) {
      if (top > document.page.height - 72) {
        document.addPage()
        top = drawMetadata() + 6
        top = drawRow(
          {
            cells: payload.columns.map((column, index) => ({ value: getColumnLabel(column, index) }))
          },
          top,
          { bold: true, header: true, fillColor: '#f3f4f6' }
        )
      }

      const highlightKind = 'rowType' in row ? resolveRowHighlightKind(row as BookExportRow) : null
      top = drawRow(row, top, {
        fillColor:
          highlightKind === 'total'
            ? '#eff6ff'
            : highlightKind === 'subtotal'
              ? '#ecfdf5'
              : undefined
      })
    }

    document.end()
    stream.on('finish', () => resolve())
    stream.on('error', reject)
    document.on('error', reject)
  })

  return filePath
}

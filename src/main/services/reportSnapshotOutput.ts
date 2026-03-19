import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { buildTimestampToken, ensureDirectory } from './fileIntegrity'
import type { ReportExportFormat, ReportSnapshotDetail, ReportSnapshotScope } from './reporting'

function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('会计期间格式应为 YYYY-MM')
  }
}

function formatChineseMonth(period: string): string {
  assertPeriod(period)
  const [year, month] = period.split('-')
  return `${year}年${Number(month)}月`
}

function formatChineseDate(date: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!matched) {
    return date
  }
  const [, year, month, day] = matched
  return `${year}年${Number(month)}月${Number(day)}日`
}

function formatExportPeriodLabel(scope: ReportSnapshotScope): string {
  if (scope.mode === 'month') {
    return formatChineseDate(scope.asOfDate ?? scope.endDate)
  }

  if (scope.startPeriod === scope.endPeriod) {
    return formatChineseMonth(scope.startPeriod)
  }

  const [startYear, startMonth] = scope.startPeriod.split('-')
  const [endYear, endMonth] = scope.endPeriod.split('-')
  if (startYear === endYear) {
    return `${startYear}年${Number(startMonth)}-${Number(endMonth)}月`
  }

  return `${startYear}年${Number(startMonth)}月-${endYear}年${Number(endMonth)}月`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_')
}

function formatAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2)
}

function getExportTableHeaders(detail: ReportSnapshotDetail): string[] {
  if (detail.content.tables && detail.content.tables.length > 0) {
    return detail.content.tables[0].columns.map((column) => column.label)
  }
  if (detail.content.tableColumns && detail.content.tableColumns.length > 0) {
    return ['项目', ...detail.content.tableColumns.map((column) => column.label)]
  }
  return ['项目', '金额']
}

function getExportTableRows(
  detail: ReportSnapshotDetail
): Array<{ section: string; values: string[] }> {
  if (detail.content.tables && detail.content.tables.length > 0) {
    return detail.content.tables.flatMap((table) =>
      table.rows.map((row) => ({
        section: table.key,
        values: row.cells.map((cell) =>
          typeof cell.value === 'number' && cell.isAmount
            ? formatAmount(cell.value)
            : String(cell.value ?? '')
        )
      }))
    )
  }

  return detail.content.sections.flatMap((section) =>
    section.rows.map((row) => {
      const label = `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
      const values =
        detail.content.tableColumns && detail.content.tableColumns.length > 0
          ? [
              label,
              ...detail.content.tableColumns.map((column) =>
                formatAmount(row.cells?.[column.key] ?? 0)
              )
            ]
          : [label, formatAmount(row.amountCents)]

      return { section: section.title, values }
    })
  )
}

export function buildReportSnapshotHtml(detail: ReportSnapshotDetail): string {
  const title = escapeHtml(detail.content.title)
  const ledgerName = escapeHtml(detail.ledger_name)
  const period = escapeHtml(formatExportPeriodLabel(detail.content.scope))
  const pageSize = detail.report_type === 'equity_statement' ? 'A4 landscape' : 'A4 portrait'
  const bodyFontSize = detail.report_type === 'equity_statement' ? 10 : 12
  const titleFontSize = detail.report_type === 'equity_statement' ? 18 : 20
  const cellPadding = detail.report_type === 'equity_statement' ? '4px 6px' : '6px 8px'

  const sectionHtml =
    detail.content.tables && detail.content.tables.length > 0
      ? detail.content.tables
          .map((table) => {
            const headerCells = table.columns
              .map((column) => `<th>${escapeHtml(column.label)}</th>`)
              .join('')
            const bodyRows = table.rows
              .map((row) => {
                const cells = row.cells
                  .map((cell, index) => {
                    const value =
                      typeof cell.value === 'number' && cell.isAmount
                        ? formatAmount(cell.value)
                        : String(cell.value ?? '')
                    return `<td${index === 0 ? '' : ' class="num"'}>${escapeHtml(value)}</td>`
                  })
                  .join('')
                return `<tr>${cells}</tr>`
              })
              .join('')

            return `
              <section class="report-section">
                <table>
                  <thead>
                    <tr>${headerCells}</tr>
                  </thead>
                  <tbody>
                    ${bodyRows}
                  </tbody>
                </table>
              </section>
            `
          })
          .join('')
      : detail.content.sections
          .map((section) => {
            const columns = detail.content.tableColumns
            const multiColumn = (columns?.length ?? 0) > 0

            const headerCells = multiColumn
              ? `<th>项目</th>${columns?.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}`
              : '<th>项目</th><th>金额</th>'

            const bodyRows = section.rows
              .map((row) => {
                const label = `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
                const valueCells = multiColumn
                  ? (columns
                      ?.map(
                        (column) =>
                          `<td class="num">${formatAmount(row.cells?.[column.key] ?? 0)}</td>`
                      )
                      .join('') ?? '')
                  : `<td class="num">${formatAmount(row.amountCents)}</td>`

                return `<tr><td>${escapeHtml(label)}</td>${valueCells}</tr>`
              })
              .join('')

            return `
              <section class="report-section">
                <h2>${escapeHtml(section.title)}</h2>
                <table>
                  <thead>
                    <tr>${headerCells}</tr>
                  </thead>
                  <tbody>
                    ${bodyRows}
                  </tbody>
                </table>
              </section>
            `
          })
          .join('')

  const totalsHtml = detail.content.totals
    .map(
      (total) =>
        `<tr><td>${escapeHtml(total.label)}</td><td class="num">${formatAmount(total.amountCents)}</td></tr>`
    )
    .join('')
  const totalsSectionHtml =
    detail.report_type === 'balance_sheet' ||
    (detail.content.tables && detail.content.tables.length > 0)
      ? ''
      : `
      <section class="report-section totals">
        <h2>汇总</h2>
        <table>
          <thead>
            <tr><th>项目</th><th class="num">金额</th></tr>
          </thead>
          <tbody>${totalsHtml}</tbody>
        </table>
      </section>`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: ${pageSize}; margin: 16mm 14mm; }
      body {
        margin: 0;
        color: #111827;
        background: #ffffff;
        font-family: "SimSun", "Songti SC", serif;
        font-size: ${bodyFontSize}px;
        line-height: 1.45;
      }
      .page {
        width: 100%;
      }
      h1 {
        margin: 0 0 8px;
        text-align: center;
        font-size: ${titleFontSize}px;
        font-weight: 700;
        letter-spacing: 0.08em;
      }
      .meta {
        margin-bottom: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .meta-label {
        color: #374151;
      }
      .report-section {
        margin-top: 12px;
      }
      .report-section h2 {
        margin: 0 0 6px;
        font-size: 13px;
        font-weight: 700;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border: 1px solid #111827;
        padding: ${cellPadding};
        vertical-align: middle;
        word-break: break-word;
      }
      th {
        text-align: center;
        font-weight: 700;
        vertical-align: middle;
        white-space: pre-line;
      }
      th.num { text-align: center; }
      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .totals {
        margin-top: 14px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <h1>${title}</h1>
      <div class="meta">
        <span class="meta-label">编制单位：${ledgerName}</span>
        <span class="meta-label">会计期间：${period}</span>
        <span class="meta-label">单位：元</span>
      </div>
      ${sectionHtml}
      ${totalsSectionHtml}
    </div>
  </body>
</html>`
}

export function buildDefaultReportExportFileName(
  detail: ReportSnapshotDetail,
  format: ReportExportFormat
): string {
  return `${sanitizeFileName(detail.report_name)}.${format}`
}

export function writeReportSnapshotHtml(
  outputDir: string,
  detail: ReportSnapshotDetail,
  now: Date = new Date()
): string {
  ensureDirectory(outputDir)
  const fileName = `${sanitizeFileName(detail.report_name)}-${buildTimestampToken(now)}.html`
  const filePath = path.join(outputDir, fileName)
  fs.writeFileSync(filePath, buildReportSnapshotHtml(detail), 'utf8')
  return filePath
}

export async function writeReportSnapshotExcel(
  filePath: string,
  detail: ReportSnapshotDetail
): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(detail.content.title, {
    views: [{ state: 'frozen', ySplit: 4 }]
  })

  const headers = getExportTableHeaders(detail)
  const rows = getExportTableRows(detail)
  const hasOfficialTables = (detail.content.tables?.length ?? 0) > 0
  const exportPeriod = formatExportPeriodLabel(detail.content.scope)

  worksheet.mergeCells(1, 1, 1, headers.length)
  worksheet.getCell(1, 1).value = detail.content.title
  worksheet.getCell(1, 1).font = { name: '宋体', size: 16, bold: true }
  worksheet.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  worksheet.getCell(2, 1).value = `编制单位：${detail.ledger_name}`
  worksheet.getCell(2, headers.length).value = '单位：元'
  worksheet.mergeCells(3, 1, 3, headers.length)
  worksheet.getCell(3, 1).value = `会计期间：${exportPeriod}`
  worksheet.getCell(3, 1).alignment = { horizontal: 'center', vertical: 'middle' }

  const headerRowIndex = 4
  const headerRow = worksheet.getRow(headerRowIndex)
  headerRow.height = headers.some((header) => header.includes('\n')) ? 40 : 24
  headers.forEach((header, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = header
    cell.font = { name: '宋体', size: 11, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
  })

  let rowIndex = headerRowIndex + 1
  let currentSection = ''
  for (const row of rows) {
    if (!hasOfficialTables && row.section !== currentSection) {
      currentSection = row.section
      worksheet.mergeCells(rowIndex, 1, rowIndex, headers.length)
      const sectionCell = worksheet.getCell(rowIndex, 1)
      sectionCell.value = currentSection
      sectionCell.font = { name: '宋体', size: 11, bold: true }
      sectionCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3F4F6' }
      }
      sectionCell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
      rowIndex += 1
    }

    row.values.forEach((value, index) => {
      const cell = worksheet.getCell(rowIndex, index + 1)
      cell.value = value
      cell.font = { name: '宋体', size: 10 }
      cell.alignment = { horizontal: index === 0 ? 'left' : 'right', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      }
    })
    rowIndex += 1
  }

  if (!hasOfficialTables) {
    rowIndex += 1
    worksheet.mergeCells(rowIndex, 1, rowIndex, headers.length)
    worksheet.getCell(rowIndex, 1).value = '汇总'
    worksheet.getCell(rowIndex, 1).font = { name: '宋体', size: 11, bold: true }

    rowIndex += 1
    detail.content.totals.forEach((total) => {
      worksheet.getCell(rowIndex, 1).value = total.label
      worksheet.getCell(rowIndex, headers.length).value = formatAmount(total.amountCents)
      for (let column = 1; column <= headers.length; column += 1) {
        const cell = worksheet.getCell(rowIndex, column)
        cell.font = { name: '宋体', size: 10 }
        cell.alignment = { horizontal: column === 1 ? 'left' : 'right', vertical: 'middle' }
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      }
      rowIndex += 1
    })
  }

  worksheet.columns = headers.map((_, index) => ({
    key: `col_${index + 1}`,
    width: index === 0 ? 42 : 18
  }))

  ensureDirectory(path.dirname(filePath))
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

export async function writeReportSnapshotPdf(
  filePath: string,
  detail: ReportSnapshotDetail
): Promise<string> {
  ensureDirectory(path.dirname(filePath))

  await new Promise<void>((resolve, reject) => {
    const document = new PDFDocument({
      size: 'A4',
      margin: 40,
      bufferPages: true
    })
    const stream = fs.createWriteStream(filePath)

    document.pipe(stream)

    const pageWidth = document.page.width - document.page.margins.left - document.page.margins.right
    const headers = getExportTableHeaders(detail)
    const rows = getExportTableRows(detail)
    const hasOfficialTables = (detail.content.tables?.length ?? 0) > 0
    const columnWidth = headers.length > 0 ? pageWidth / headers.length : pageWidth
    const exportPeriod = formatExportPeriodLabel(detail.content.scope)

    const drawRow = (
      values: string[],
      top: number,
      options?: { bold?: boolean; fillColor?: string; header?: boolean }
    ): number => {
      const rowHeight = 24
      if (options?.fillColor) {
        document.save()
        document
          .fillColor(options.fillColor)
          .rect(document.page.margins.left, top, pageWidth, rowHeight)
          .fill()
        document.restore()
      }

      values.forEach((value, index) => {
        const left = document.page.margins.left + index * columnWidth
        document.rect(left, top, columnWidth, rowHeight).stroke('#111827')
        document.fontSize(options?.bold ? 10.5 : 10)
        document.text(value, left + 6, top + 6, {
          width: columnWidth - 12,
          align: options?.header ? 'center' : index === 0 ? 'left' : 'right'
        })
      })

      return top + rowHeight
    }

    document.fontSize(18).text(detail.content.title, { align: 'center' })
    document.moveDown(0.5)
    document.fontSize(10).text(`编制单位：${detail.ledger_name}`, { continued: true })
    document.text(`单位：元`, { align: 'right' })
    document.text(`会计期间：${exportPeriod}`, { align: 'center' })
    document.moveDown(0.5)

    let top = document.y
    top = drawRow(headers, top, { bold: true, header: true })

    let currentSection = ''
    for (const row of rows) {
      if (top > document.page.height - 80) {
        document.addPage()
        top = document.page.margins.top
        top = drawRow(headers, top, { bold: true })
      }

      if (!hasOfficialTables && row.section !== currentSection) {
        currentSection = row.section
        top = drawRow([currentSection, ...Array(headers.length - 1).fill('')], top, {
          bold: true,
          fillColor: '#f3f4f6'
        })
      }

      top = drawRow(row.values, top)
    }

    if (!hasOfficialTables) {
      if (top > document.page.height - 120) {
        document.addPage()
        top = document.page.margins.top
      }

      document.moveDown()
      document.fontSize(12).text('汇总', document.page.margins.left, top + 8)
      top += 28
      top = drawRow(['项目', '金额'], top, { bold: true })
      detail.content.totals.forEach((total) => {
        top = drawRow([total.label, formatAmount(total.amountCents)], top)
      })
    }

    document.end()
    stream.on('finish', () => resolve())
    stream.on('error', reject)
    document.on('error', reject)
  })

  return filePath
}

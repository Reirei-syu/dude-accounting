import path from 'node:path'
import type Database from 'better-sqlite3'
import {
  buildDefaultBookExportFileName,
  writeBookExportExcel,
  writeBookExportPdf,
  type BookExportColumn,
  type BookExportFormat,
  type BookExportPayload,
  type BookExportRow
} from './bookExport'
import { getPathPreference, rememberPathPreference } from './pathPreference'

export interface BookQueryExportPayload extends BookExportPayload {
  format: BookExportFormat
  filePath?: string
}

export const BOOK_QUERY_EXPORT_LAST_DIR_KEY = 'book_query_export_last_dir'

export function getDefaultBookQueryExportRootDir(documentsPath: string): string {
  return path.join(documentsPath, 'Dude Accounting', '账簿导出')
}

export function getPreferredBookQueryExportDir(
  db: Database.Database,
  documentsPath: string
): string {
  return (
    getPathPreference(db, BOOK_QUERY_EXPORT_LAST_DIR_KEY) ??
    getDefaultBookQueryExportRootDir(documentsPath)
  )
}

export function rememberBookQueryExportDir(db: Database.Database, targetPath: string): void {
  rememberPathPreference(db, BOOK_QUERY_EXPORT_LAST_DIR_KEY, targetPath)
}

export function normalizeBookQueryExportPayload(
  payload: BookQueryExportPayload
): BookQueryExportPayload {
  const sanitizedRows: BookExportRow[] = Array.isArray(payload.rows)
    ? payload.rows.map((row, rowIndex) => ({
        key: row.key || `row-${rowIndex + 1}`,
        cells: Array.isArray(row.cells)
          ? row.cells.map((cell) => ({
              value: cell.value ?? '',
              isAmount: cell.isAmount === true
            }))
          : []
      }))
    : []

  return {
    ...payload,
    title: payload.title.trim(),
    subtitle: payload.subtitle?.trim() ?? '',
    ledgerName: payload.ledgerName?.trim() ?? '',
    columns: payload.columns.map((column, index) => ({
      key: column.key || `col_${index + 1}`,
      label: column.label,
      align: column.align
    })) as BookExportColumn[],
    rows: sanitizedRows
  }
}

export function buildBookQueryExportDefaultPath(
  preferredDir: string,
  payload: BookQueryExportPayload
): string {
  return path.join(preferredDir, buildDefaultBookExportFileName(payload, payload.format))
}

export function getBookQueryExportFilters(
  format: BookExportFormat
): Array<{ name: string; extensions: string[] }> {
  return [
    format === 'xlsx'
      ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
      : { name: 'PDF 文档', extensions: ['pdf'] }
  ]
}

export async function exportBookQueryToFile(
  payload: BookQueryExportPayload,
  filePath: string
): Promise<string> {
  return payload.format === 'xlsx'
    ? writeBookExportExcel(filePath, payload)
    : writeBookExportPdf(filePath, payload)
}

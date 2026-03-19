import path from 'node:path'
import type Database from 'better-sqlite3'
import { getPathPreference, rememberPathPreference } from './pathPreference'
import {
  buildDefaultReportExportFileName,
  buildReportSnapshotHtml,
  writeReportSnapshotExcel,
  type ReportExportFormat,
  type ReportSnapshotDetail
} from './reporting'

export const REPORT_EXPORT_LAST_DIR_KEY = 'report_export_last_dir'

export function getDefaultReportExportRootDir(documentsPath: string): string {
  return path.join(documentsPath, 'Dude Accounting', '报表导出')
}

export function getPreferredReportExportDir(db: Database.Database, documentsPath: string): string {
  return (
    getPathPreference(db, REPORT_EXPORT_LAST_DIR_KEY) ??
    getDefaultReportExportRootDir(documentsPath)
  )
}

export function rememberReportExportDir(db: Database.Database, targetPath: string): void {
  rememberPathPreference(db, REPORT_EXPORT_LAST_DIR_KEY, targetPath)
}

export function buildReportExportDefaultPath(
  preferredDir: string,
  detail: ReportSnapshotDetail,
  format: ReportExportFormat
): string {
  return path.join(preferredDir, buildDefaultReportExportFileName(detail, format))
}

export function getReportExportFilters(
  format: ReportExportFormat
): Array<{ name: string; extensions: string[] }> {
  return [
    format === 'xlsx'
      ? { name: 'Excel 工作簿', extensions: ['xlsx'] }
      : { name: 'PDF 文档', extensions: ['pdf'] }
  ]
}

export async function exportReportSnapshotToFile(
  detail: ReportSnapshotDetail,
  format: ReportExportFormat,
  filePath: string,
  exportPdf: (targetPath: string, html: string) => Promise<string>
): Promise<string> {
  return format === 'xlsx'
    ? writeReportSnapshotExcel(filePath, detail)
    : exportPdf(filePath, buildReportSnapshotHtml(detail))
}

export async function exportReportSnapshotsBatch(
  details: ReportSnapshotDetail[],
  format: ReportExportFormat,
  directoryPath: string,
  exportSingle: (detail: ReportSnapshotDetail, filePath: string) => Promise<string>
): Promise<string[]> {
  const filePaths: string[] = []

  for (const detail of details) {
    const filePath = path.join(directoryPath, buildDefaultReportExportFileName(detail, format))
    filePaths.push(await exportSingle(detail, filePath))
  }

  return filePaths
}

import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getDatabase } from '../database/init'
import { sanitizePathSegment } from '../services/fileIntegrity'
import { getReportSnapshotDetail, type ReportSnapshotDetail } from '../services/reporting'
import {
  resolveBookPrintOrientation,
  normalizePrintPreviewSettings,
  type PrintLayoutResult,
  type PrintDocument,
  type PrintJobType,
  type PrintTableSegment,
  type PrintTableColumn,
  type PrintTableRow,
  type PrintPreviewSettings,
  type PrintVoucherSegment,
  type PrintVoucherRecord
} from '../services/print'
import {
  buildTableLayoutResult,
  buildVoucherLayoutResult,
  estimateTableRowGroups
} from '../services/printLayout'
import { buildTableMeasurementHtml } from '../services/printMeasurement'
import { buildPagedPrintPreviewHtml } from '../services/printPreviewShell'
import { requestEmbeddedCliKeepAlive } from '../runtime/embeddedCliState'
import { appendCliE2eEvent } from '../runtime/cliE2eEvents'
import { requireCommandActor, requireCommandLedgerAccess } from '../commands/authz'
import { CommandError } from '../commands/types'
import type { CommandActor } from '../commands/types'
import { requireAuth, requireLedgerAccess } from './session'

export type PrintJobStatus = 'preparing' | 'ready' | 'failed'
export type PrintCommandPayload =
  | string
  | {
      jobId: string
      outputPath?: string
      silent?: boolean
      deviceName?: string
    }

export type PrintPreparePayload =
  | {
      type: 'report'
      ledgerId?: number
      snapshotId: number
    }
  | {
      type: 'batch'
      batchType: 'report'
      ledgerId?: number
      snapshotIds: number[]
    }
  | {
      type: 'book'
      ledgerId: number
      bookType: string
      title: string
      subtitle?: string
      ledgerName?: string
      subjectLabel?: string
      titleMetaLines?: string[]
      periodLabel?: string
      columns: PrintTableColumn[]
      rows: PrintTableRow[]
    }
  | {
      type: 'voucher'
      ledgerId?: number
      voucherIds: number[]
      layout: 'single' | 'double'
      doubleGapPx: number
    }

interface PrintJobRecord {
  id: string
  type: PrintJobType
  bookType: string | null
  preferenceKey: string | null
  title: string
  ledgerId: number | null
  createdBy: number
  createdAt: number
  lastAccessAt: number
  status: PrintJobStatus
  orientation: 'portrait' | 'landscape'
  settings: PrintPreviewSettings
  sourceDocument: PrintDocument | null
  layoutResult: PrintLayoutResult | null
  layoutVersion: number
  error: string | null
  previewWebContentsId: number | null
}

const printJobs = new Map<string, PrintJobRecord>()
const PRINT_JOB_TTL_MS = 1000 * 60 * 60 * 12

function buildPrintFailureResponse(
  error: string,
  errorCode: string,
  errorDetails: Record<string, unknown> | null = null
): {
  success: false
  error: string
  errorCode: string
  errorDetails: Record<string, unknown> | null
} {
  return {
    success: false,
    error,
    errorCode,
    errorDetails
  }
}

function resolveAccessiblePrintJob(
  event: IpcMainInvokeEvent,
  jobId: string
): {
  job: PrintJobRecord | null
  failure?: {
    success: false
    error: string
    errorCode: string
    errorDetails: Record<string, unknown> | null
  }
} {
  try {
    return {
      job: getAccessiblePrintJob(event, jobId)
    }
  } catch (error) {
    if (error instanceof CommandError) {
      return {
        job: null,
        failure: buildPrintFailureResponse(error.message, error.code, error.details)
      }
    }

    return {
      job: null,
      failure: buildPrintFailureResponse(
        error instanceof Error ? error.message : '打印任务访问失败',
        'INTERNAL_ERROR'
      )
    }
  }
}

function getPrintJobDirectory(): string {
  return path.join(app.getPath('userData'), 'print-jobs')
}

function getPrintJobFilePath(jobId: string): string {
  return path.join(getPrintJobDirectory(), `${jobId}.json`)
}

function savePrintJob(job: PrintJobRecord): void {
  printJobs.set(job.id, job)
  fs.mkdirSync(getPrintJobDirectory(), { recursive: true })
  fs.writeFileSync(
    getPrintJobFilePath(job.id),
    JSON.stringify({
      ...job,
      previewWebContentsId: null
    }),
    'utf8'
  )
}

function loadPrintJob(jobId: string): PrintJobRecord | null {
  const cached = printJobs.get(jobId)
  if (cached) {
    return cached
  }

  const filePath = getPrintJobFilePath(jobId)
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Omit<
      PrintJobRecord,
      'previewWebContentsId'
    > & { previewWebContentsId?: number | null }
    const job: PrintJobRecord = {
      ...parsed,
      previewWebContentsId: null
    }
    printJobs.set(jobId, job)
    return job
  } catch {
    return null
  }
}

function deletePrintJob(jobId: string): void {
  printJobs.delete(jobId)
  const filePath = getPrintJobFilePath(jobId)
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true })
  }
}

export function resolvePrintCommandPayload(payload: PrintCommandPayload): {
  jobId: string
  outputPath?: string
  silent?: boolean
  deviceName?: string
} {
  if (typeof payload === 'string') {
    return { jobId: payload }
  }
  return {
    jobId: payload.jobId,
    outputPath: payload.outputPath,
    silent: payload.silent,
    deviceName: payload.deviceName
  }
}

function pruneExpiredPrintJobs(now: number = Date.now()): void {
  const jobDirectory = getPrintJobDirectory()

  for (const [jobId, job] of printJobs) {
    if (now - job.lastAccessAt > PRINT_JOB_TTL_MS) {
      const previewWindow =
        job.previewWebContentsId === null
          ? null
          : (BrowserWindow.getAllWindows().find(
              (window) => window.webContents.id === job.previewWebContentsId
            ) ?? null)
      previewWindow?.close()
      deletePrintJob(jobId)
    }
  }

  if (!fs.existsSync(jobDirectory)) {
    return
  }

  for (const entry of fs.readdirSync(jobDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const filePath = path.join(jobDirectory, entry.name)
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { lastAccessAt?: number }
      if (typeof parsed.lastAccessAt === 'number' && now - parsed.lastAccessAt > PRINT_JOB_TTL_MS) {
        fs.rmSync(filePath, { force: true })
      }
    } catch {
      fs.rmSync(filePath, { force: true })
    }
  }
}

function sanitizeFileName(value: string): string {
  return sanitizePathSegment(value, '打印预览')
}

export function buildDefaultPreviewSettings(
  orientation: 'portrait' | 'landscape'
): PrintPreviewSettings {
  return {
    orientation,
    scalePercent: 100,
    marginPreset: 'default',
    densityPreset: 'default'
  }
}

function getPreviewPreferenceKey(bookType: string | null): string | null {
  return bookType ? `book_print_settings_${bookType}` : null
}

export function loadPersistedPreviewSettings(
  db: ReturnType<typeof getDatabase>,
  userId: number,
  preferenceKey: string | null,
  fallbackOrientation: 'portrait' | 'landscape'
): PrintPreviewSettings {
  if (!preferenceKey) {
    return buildDefaultPreviewSettings(fallbackOrientation)
  }

  const row = db
    .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(userId, preferenceKey) as { value?: string } | undefined

  if (!row?.value) {
    return buildDefaultPreviewSettings(fallbackOrientation)
  }

  try {
    return normalizePrintPreviewSettings(JSON.parse(row.value), fallbackOrientation)
  } catch {
    return buildDefaultPreviewSettings(fallbackOrientation)
  }
}

export function persistPreviewSettings(
  db: ReturnType<typeof getDatabase>,
  userId: number,
  preferenceKey: string | null,
  settings: PrintPreviewSettings
): void {
  if (!preferenceKey) {
    return
  }

  db.prepare(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, preferenceKey, JSON.stringify(settings))
}

type TableRowGroupMeasurement = {
  rowKeyGroups: string[][]
  oversizeRowKeys: string[]
}

export function resolveMeasuredTableRowGroups(
  segment: PrintTableSegment,
  fallback: TableRowGroupMeasurement,
  measured: TableRowGroupMeasurement | null
): TableRowGroupMeasurement {
  if (!measured) {
    return fallback
  }

  const expectedRowKeys = segment.rows.map((row) => row.key)
  const measuredGroups = Array.isArray(measured.rowKeyGroups) ? measured.rowKeyGroups : []

  if (expectedRowKeys.length === 0) {
    return measuredGroups.length === 1 && measuredGroups[0]?.length === 0 ? measured : fallback
  }

  if (
    measuredGroups.length === 0 ||
    measuredGroups.some((group) => !Array.isArray(group) || group.length === 0)
  ) {
    return fallback
  }

  const flattenedKeys = measuredGroups.flat()
  if (flattenedKeys.length !== expectedRowKeys.length) {
    return fallback
  }

  for (let index = 0; index < expectedRowKeys.length; index += 1) {
    if (flattenedKeys[index] !== expectedRowKeys[index]) {
      return fallback
    }
  }

  return {
    rowKeyGroups: measuredGroups,
    oversizeRowKeys: Array.isArray(measured.oversizeRowKeys) ? measured.oversizeRowKeys : []
  }
}

function buildPreviewModel(
  job: PrintJobRecord
): (PrintLayoutResult & { layoutVersion: number }) | null {
  if (!job.layoutResult) {
    return null
  }

  return {
    ...job.layoutResult,
    layoutVersion: job.layoutVersion
  }
}

function getPrintExportDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '打印导出')
}

async function createPreviewWindowForJob(input: {
  jobId: string
  previewModel: PrintLayoutResult & { layoutVersion: number }
  show: boolean
  trackPreviewWindow: boolean
}): Promise<BrowserWindow> {
  const previewWindow = new BrowserWindow({
    width: 1120,
    height: 860,
    show: input.show,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (!input.show) {
    previewWindow.setBounds({ x: -10000, y: -10000, width: 1120, height: 860 })
    previewWindow.setSkipTaskbar(true)
  }

  if (input.trackPreviewWindow) {
    previewWindow.on('closed', () => {
      const currentJob = loadPrintJob(input.jobId)
      if (currentJob) {
        currentJob.previewWebContentsId = null
        savePrintJob(currentJob)
      }
    })
  }

  const previewHtml = buildPagedPrintPreviewHtml(input.jobId, input.previewModel)
  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`)
  appendCliE2eEvent('print.preview.window-opened', {
    jobId: input.jobId,
    webContentsId: previewWindow.webContents.id,
    shown: input.show,
    tracked: input.trackPreviewWindow
  })

  if (input.trackPreviewWindow) {
    const currentJob = loadPrintJob(input.jobId)
    if (currentJob) {
      currentJob.previewWebContentsId = previewWindow.webContents.id
      savePrintJob(currentJob)
    }
  }

  return previewWindow
}

export async function measureTableRowGroups(
  segment: PrintTableSegment,
  settings: PrintPreviewSettings
): Promise<{
  rowKeyGroups: string[][]
  oversizeRowKeys: string[]
}> {
  const measurementWindow = new BrowserWindow({
    width: 1440,
    height: 1200,
    x: -10000,
    y: -10000,
    show: true,
    focusable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false
    }
  })

  try {
    const measurementHtml = buildTableMeasurementHtml(segment, settings)
    await measurementWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(measurementHtml)}`
    )

    const result = (await measurementWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const settle = () =>
          new Promise((done) => setTimeout(done, 0));
        const fitTextNodes = (selector) => {
          const nodes = document.querySelectorAll(selector);
          nodes.forEach((node) => {
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
        };
        const fitAllText = async () => {
          fitTextNodes('.print-fit-text');
          await settle();
        };
        const collect = async () => {
          try {
            await fitAllText();
            const canvas = document.querySelector('.preview-canvas');
            const section = document.querySelector('.print-segment');
            const documentNode = section?.querySelector('.print-document');
            const table = section?.querySelector('.print-table');
            const thead = table?.querySelector('thead');
            const colgroup = table?.querySelector('colgroup');
            const tbody = table?.querySelector('tbody');
            if (
              !(canvas instanceof HTMLElement) ||
              !(section instanceof HTMLElement) ||
              !(documentNode instanceof HTMLElement) ||
              !(table instanceof HTMLTableElement) ||
              !(thead instanceof HTMLTableSectionElement) ||
              !(tbody instanceof HTMLTableSectionElement)
            ) {
              resolve({ rowKeyGroups: [[]], oversizeRowKeys: [] });
              return;
            }

            const orientation = canvas.classList.contains('orientation-landscape') ? 'landscape' : 'portrait';
            const pageHeightRatio = orientation === 'landscape' ? 210 / 297 : 297 / 210;
            const sourceRows = Array.from(tbody.rows).map((row) => ({
              key: row.dataset.rowKey || '',
              html: row.outerHTML
            }));

            const createSection = (rowHtmlList) => {
              const clone = document.createElement('section');
              clone.className = section.className.replace(/\\s*page-break\\s*/g, ' ').trim();
              clone.innerHTML =
                '<div class="' +
                documentNode.className +
                '"><table class="' +
                table.className +
                '">' +
                (colgroup?.outerHTML || '') +
                '<thead>' +
                thead.innerHTML +
                '</thead><tbody>' +
                rowHtmlList.join('') +
                '</tbody></table></div>';
              return clone;
            };

            const host = document.createElement('div');
            host.className = canvas.className;
            host.style.position = 'absolute';
            host.style.visibility = 'hidden';
            host.style.pointerEvents = 'none';
            host.style.left = '-99999px';
            host.style.top = '0';
            document.body.appendChild(host);
            const measureSection = createSection([]);
            host.appendChild(measureSection);
            const measureTbody = measureSection.querySelector('tbody');
            if (!(measureTbody instanceof HTMLTableSectionElement)) {
              host.remove();
              resolve({ rowKeyGroups: [[]], oversizeRowKeys: [] });
              return;
            }

            await fitAllText();
            const pageWidth = measureSection.getBoundingClientRect().width;
            const pageHeightLimit = pageWidth * pageHeightRatio;
            const pages = [];
            const oversizeRowKeys = [];
            let currentPage = [];

            for (const sourceRow of sourceRows) {
              const buffer = document.createElement('tbody');
              buffer.innerHTML = sourceRow.html;
              const rowNode = buffer.firstElementChild;
              if (!(rowNode instanceof HTMLTableRowElement)) {
                continue;
              }
              measureTbody.appendChild(rowNode);
              await fitAllText();
              const currentHeight = measureSection.getBoundingClientRect().height;
              if (currentHeight > pageHeightLimit + 1) {
                measureTbody.removeChild(rowNode);
                if (currentPage.length === 0) {
                  currentPage.push(sourceRow.key);
                  oversizeRowKeys.push(sourceRow.key);
                  pages.push(currentPage);
                  currentPage = [];
                  measureTbody.innerHTML = '';
                } else {
                  pages.push(currentPage);
                  currentPage = [sourceRow.key];
                  measureTbody.innerHTML = '';
                  const nextBuffer = document.createElement('tbody');
                  nextBuffer.innerHTML = sourceRow.html;
                  const nextNode = nextBuffer.firstElementChild;
                  if (nextNode instanceof HTMLTableRowElement) {
                    measureTbody.appendChild(nextNode);
                    await fitAllText();
                    if (measureSection.getBoundingClientRect().height > pageHeightLimit + 1) {
                      oversizeRowKeys.push(sourceRow.key);
                      pages.push(currentPage);
                      currentPage = [];
                      measureTbody.innerHTML = '';
                    }
                  }
                }
              } else {
                currentPage.push(sourceRow.key);
              }
            }

            if (currentPage.length > 0) {
              pages.push(currentPage);
            }

            host.remove();
            resolve({
              rowKeyGroups: pages.length > 0 ? pages : [[]],
              oversizeRowKeys
            });
          } catch (error) {
            console.error('collectPrintLayout failed', error);
            resolve({ rowKeyGroups: [[]], oversizeRowKeys: [] });
          }
        };

        if (document.readyState === 'complete') {
          void collect();
        } else {
          window.addEventListener('load', () => {
            void collect();
          }, { once: true });
        }
      })
    `)) as {
      rowKeyGroups: string[][]
      oversizeRowKeys: string[]
    }

    return {
      rowKeyGroups:
        Array.isArray(result?.rowKeyGroups) && result.rowKeyGroups.length > 0
          ? result.rowKeyGroups
          : [[]],
      oversizeRowKeys: Array.isArray(result?.oversizeRowKeys) ? result.oversizeRowKeys : []
    }
  } finally {
    measurementWindow.destroy()
  }
}

async function layoutPrintDocument(
  document: PrintDocument,
  settings: PrintPreviewSettings
): Promise<PrintLayoutResult> {
  const tableSegments = document.segments.filter(
    (segment): segment is PrintTableSegment => segment.kind === 'table'
  )
  const voucherSegments = document.segments.filter(
    (segment): segment is PrintVoucherSegment => segment.kind === 'voucher'
  )

  if (tableSegments.length > 0 && voucherSegments.length > 0) {
    throw new Error('暂不支持混合表格与凭证的打印任务')
  }

  if (tableSegments.length > 0) {
    const measuredGroups = await Promise.all(
      tableSegments.map(async (segment) => {
        const fallback = estimateTableRowGroups(segment, settings)
        try {
          const measured = await Promise.race([
            measureTableRowGroups(segment, settings),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200))
          ])
          const resolved = resolveMeasuredTableRowGroups(segment, fallback, measured)
          return {
            segment,
            ...resolved
          }
        } catch {
          return {
            segment,
            ...fallback
          }
        }
      })
    )

    return buildTableLayoutResult({
      title: document.title,
      orientation: settings.orientation,
      settings,
      segmentDrafts: measuredGroups.map(({ segment, rowKeyGroups }) => ({
        segment,
        rowKeyGroups
      })),
      oversizeRowKeys: measuredGroups.flatMap((group) => group.oversizeRowKeys)
    })
  }

  return buildVoucherLayoutResult({
    title: document.title,
    orientation: settings.orientation,
    settings,
    segments: voucherSegments
  })
}

function getReportSegment(detail: ReportSnapshotDetail): PrintTableSegment {
  const headers =
    detail.content.tables?.[0]?.columns?.map((column) => ({
      key: column.key,
      label: column.label,
      align: (column.key === 'label' ? 'left' : 'right') as 'left' | 'right'
    })) ??
    (detail.content.tableColumns && detail.content.tableColumns.length > 0
      ? [
          { key: 'label', label: '项目', align: 'left' as const },
          ...detail.content.tableColumns.map((column) => ({
            key: column.key,
            label: column.label,
            align: 'right' as const
          }))
        ]
      : [
          { key: 'label', label: '项目', align: 'left' as const },
          { key: 'amount', label: '金额', align: 'right' as const }
        ])

  const rows =
    detail.content.tables?.flatMap((table) =>
      table.rows.map((row) => ({
        key: `${table.key}-${row.key}`,
        cells: row.cells.map((cell, index) => ({
          value: cell.value,
          isAmount: cell.isAmount ?? (typeof cell.value === 'number' && index > 0)
        }))
      }))
    ) ??
    detail.content.sections.flatMap((section) =>
      section.rows.map((row) => ({
        key: `${section.key}-${row.key}`,
        cells:
          detail.content.tableColumns && detail.content.tableColumns.length > 0
            ? [
                {
                  value: `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
                },
                ...detail.content.tableColumns.map((column) => ({
                  value: (row.cells?.[column.key] ?? 0) / 100,
                  isAmount: true
                }))
              ]
            : [
                {
                  value: `${row.lineNo ? `${row.lineNo} ` : ''}${row.code ? `${row.code} ` : ''}${row.label}`
                },
                { value: row.amountCents / 100, isAmount: true }
              ]
      }))
    )

  return {
    kind: 'table' as const,
    title: detail.content.title,
    ledgerName: detail.ledger_name,
    periodLabel: detail.period,
    unitLabel: '元',
    columns: headers,
    rows
  }
}

function getVoucherWordPriority(voucherWord: string): number {
  if (voucherWord === '记') return 0
  if (voucherWord === '结') return 1
  return 9
}

function sortVoucherRecords(records: PrintVoucherRecord[]): PrintVoucherRecord[] {
  return [...records].sort((left, right) => {
    if (left.voucherDate !== right.voucherDate) {
      return left.voucherDate.localeCompare(right.voucherDate)
    }
    const wordPriorityDelta =
      getVoucherWordPriority(left.voucherWord) - getVoucherWordPriority(right.voucherWord)
    if (wordPriorityDelta !== 0) {
      return wordPriorityDelta
    }
    return left.voucherNumber - right.voucherNumber
  })
}

function buildVoucherRecords(
  db: ReturnType<typeof getDatabase>,
  voucherIds: number[]
): {
  ledgerId: number
  ledgerName: string
  records: PrintVoucherRecord[]
} {
  const placeholders = voucherIds.map(() => '?').join(', ')
  const voucherRows = db
    .prepare(
      `SELECT
         v.id,
         v.ledger_id,
         v.period,
         v.voucher_date,
         v.voucher_number,
         v.voucher_word,
         l.name AS ledger_name,
         COALESCE(uc.real_name, uc.username, '') AS creator_name,
         COALESCE(ua.real_name, ua.username, '') AS auditor_name,
         COALESCE(ub.real_name, ub.username, '') AS bookkeeper_name
       FROM vouchers v
       INNER JOIN ledgers l ON l.id = v.ledger_id
       LEFT JOIN users uc ON uc.id = v.creator_id
       LEFT JOIN users ua ON ua.id = v.auditor_id
       LEFT JOIN users ub ON ub.id = v.bookkeeper_id
       WHERE v.id IN (${placeholders})
       ORDER BY v.voucher_date ASC, v.voucher_number ASC`
    )
    .all(...voucherIds) as Array<{
    id: number
    ledger_id: number
    period: string
    voucher_date: string
    voucher_number: number
    voucher_word: string
    ledger_name: string
    creator_name: string
    auditor_name: string
    bookkeeper_name: string
  }>

  if (voucherRows.length !== voucherIds.length) {
    throw new Error('存在无效凭证，无法生成打印任务')
  }

  const ledgerId = voucherRows[0].ledger_id
  if (voucherRows.some((row) => row.ledger_id !== ledgerId)) {
    throw new Error('凭证批量打印仅支持同一账套')
  }

  const entryRows = db
    .prepare(
      `SELECT
         ve.voucher_id,
         ve.row_order,
         ve.summary,
         ve.subject_code,
         COALESCE(s.name, '') AS subject_name,
         ve.debit_amount,
         ve.credit_amount
       FROM voucher_entries ve
       LEFT JOIN vouchers v ON v.id = ve.voucher_id
       LEFT JOIN subjects s ON s.ledger_id = v.ledger_id AND s.code = ve.subject_code
       WHERE ve.voucher_id IN (${placeholders})
       ORDER BY ve.voucher_id ASC, ve.row_order ASC, ve.id ASC`
    )
    .all(...voucherIds) as Array<{
    voucher_id: number
    row_order: number
    summary: string
    subject_code: string
    subject_name: string
    debit_amount: number
    credit_amount: number
  }>

  const entriesByVoucherId = new Map<number, typeof entryRows>()
  for (const entry of entryRows) {
    const existing = entriesByVoucherId.get(entry.voucher_id) ?? []
    existing.push(entry)
    entriesByVoucherId.set(entry.voucher_id, existing)
  }

  const records = sortVoucherRecords(
    voucherRows.map((row) => {
      const entries = entriesByVoucherId.get(row.id) ?? []
      const totalDebit = entries.reduce((sum, entry) => sum + entry.debit_amount, 0) / 100
      const totalCredit = entries.reduce((sum, entry) => sum + entry.credit_amount, 0) / 100
      return {
        id: row.id,
        voucherWord: row.voucher_word,
        voucherNumber: row.voucher_number,
        voucherDate: row.voucher_date,
        creatorName: row.creator_name,
        auditorName: row.auditor_name,
        bookkeeperName: row.bookkeeper_name,
        totalDebit,
        totalCredit,
        entries: entries.map((entry) => ({
          summary: entry.summary,
          subjectCode: entry.subject_code,
          subjectName: entry.subject_name,
          debitAmount: entry.debit_amount / 100,
          creditAmount: entry.credit_amount / 100
        }))
      }
    })
  )

  return {
    ledgerId,
    ledgerName: voucherRows[0].ledger_name,
    records
  }
}

function createPrintDocument(
  db: ReturnType<typeof getDatabase>,
  payload: PrintPreparePayload
): {
  title: string
  type: PrintJobType
  ledgerId: number | null
  orientation: 'portrait' | 'landscape'
  document: PrintDocument
} {
  if (payload.type === 'report') {
    const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
    const document: PrintDocument = {
      title: detail.report_name,
      orientation: detail.report_type === 'equity_statement' ? 'landscape' : 'portrait',
      showPageNumber: false,
      segments: [getReportSegment(detail)]
    }
    return {
      title: detail.report_name,
      type: 'report',
      ledgerId: detail.ledger_id,
      orientation: document.orientation,
      document
    }
  }

  if (payload.type === 'batch' && payload.batchType === 'report') {
    const details = payload.snapshotIds.map((snapshotId) =>
      getReportSnapshotDetail(db, snapshotId, payload.ledgerId)
    )
    const reportType = details[0]?.report_type
    if (!reportType || details.some((detail) => detail.report_type !== reportType)) {
      throw new Error('批量打印仅支持同一报表类型')
    }
    const document: PrintDocument = {
      title: `${details[0].content.title} 批量打印`,
      orientation: reportType === 'equity_statement' ? 'landscape' : 'portrait',
      showPageNumber: false,
      segments: details.map((detail) => getReportSegment(detail))
    }
    return {
      title: document.title,
      type: 'batch',
      ledgerId: details[0].ledger_id,
      orientation: document.orientation,
      document
    }
  }

  if (payload.type === 'book') {
    const document: PrintDocument = {
      title: payload.title,
      orientation: resolveBookPrintOrientation(payload.columns.length),
      showPageNumber: false,
      segments: [
        {
          kind: 'table',
          title: payload.title,
          ledgerName: payload.ledgerName ?? '',
          periodLabel: payload.periodLabel,
          unitLabel: '元',
          subjectLabel: payload.subjectLabel,
          titleMetaLines: payload.titleMetaLines,
          headerMode: 'book',
          metaLines: [payload.subtitle ?? '', payload.subjectLabel ?? ''].filter(Boolean),
          columns: payload.columns,
          rows: payload.rows
        }
      ]
    }
    return {
      title: payload.title,
      type: 'book',
      ledgerId: payload.ledgerId,
      orientation: document.orientation,
      document
    }
  }

  const voucherPayload = payload as Extract<PrintPreparePayload, { type: 'voucher' }>
  const voucherData = buildVoucherRecords(db, voucherPayload.voucherIds)
  const document: PrintDocument = {
    title: '记账凭证打印',
    orientation: 'portrait',
    showPageNumber: false,
    segments: [
      {
        kind: 'voucher',
        title: '记账凭证',
        ledgerName: voucherData.ledgerName,
        periodLabel: '',
        layout: voucherPayload.layout,
        doubleGapPx: voucherPayload.doubleGapPx,
        vouchers: voucherData.records
      }
    ]
  }

  return {
    title: document.title,
    type: voucherPayload.voucherIds.length > 1 ? 'batch' : 'voucher',
    ledgerId: voucherData.ledgerId,
    orientation: document.orientation,
    document
  }
}

function getPreviewWindow(jobId: string): BrowserWindow | null {
  pruneExpiredPrintJobs()
  const job = loadPrintJob(jobId)
  if (!job?.previewWebContentsId) {
    return null
  }
  job.lastAccessAt = Date.now()
  savePrintJob(job)
  return (
    BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === job.previewWebContentsId
    ) ?? null
  )
}

function getAccessiblePrintJob(event: IpcMainInvokeEvent, jobId: string): PrintJobRecord | null {
  pruneExpiredPrintJobs()
  const job = loadPrintJob(jobId)
  if (!job) {
    return null
  }
  job.lastAccessAt = Date.now()
  savePrintJob(job)

  if (job.previewWebContentsId === event.sender.id) {
    return job
  }

  const user = requireAuth(event)
  if (job.createdBy !== user.id && !user.isAdmin) {
    throw new CommandError('FORBIDDEN', '无权访问该打印任务', { jobId }, 4)
  }

  return job
}

async function openPreviewWindow(jobId: string): Promise<void> {
  const existing = getPreviewWindow(jobId)
  if (existing) {
    existing.focus()
    return
  }

  const job = loadPrintJob(jobId)
  if (!job) {
    throw new Error('打印任务不存在')
  }
  const previewModel = buildPreviewModel(job)
  if (!previewModel) {
    throw new Error(job.error ?? '打印任务尚未完成')
  }

  await createPreviewWindowForJob({
    jobId,
    previewModel,
    show: true,
    trackPreviewWindow: true
  })
}

function getAccessiblePrintJobForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  jobId: string
): PrintJobRecord | null {
  pruneExpiredPrintJobs()
  const currentActor = requireCommandActor(actor)
  const job = loadPrintJob(jobId)
  if (!job) {
    return null
  }

  if (job.ledgerId !== null) {
    requireCommandLedgerAccess(db, actor, job.ledgerId)
  }
  if (job.createdBy !== currentActor.id && !currentActor.isAdmin) {
    throw new CommandError('FORBIDDEN', '无权访问该打印任务', { jobId }, 4)
  }

  job.lastAccessAt = Date.now()
  savePrintJob(job)
  return job
}

function assertPrintPrepareAccess(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  payload: PrintPreparePayload
): void {
  requireCommandActor(actor)

  if (payload.type === 'report') {
    const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
    requireCommandLedgerAccess(db, actor, detail.ledger_id)
    return
  }

  if (payload.type === 'batch' && payload.batchType === 'report') {
    for (const snapshotId of payload.snapshotIds) {
      const detail = getReportSnapshotDetail(db, snapshotId, payload.ledgerId)
      requireCommandLedgerAccess(db, actor, detail.ledger_id)
    }
    return
  }

  if (payload.type === 'book') {
    requireCommandLedgerAccess(db, actor, payload.ledgerId)
    return
  }

  if (payload.type !== 'voucher') {
    throw new Error('不支持的打印任务类型')
  }

  const placeholders = payload.voucherIds.map(() => '?').join(', ')
  const vouchers = db
    .prepare(`SELECT DISTINCT ledger_id FROM vouchers WHERE id IN (${placeholders})`)
    .all(...payload.voucherIds) as Array<{ ledger_id: number }>
  if (vouchers.length === 0) {
    throw new Error('凭证不存在')
  }
  for (const voucher of vouchers) {
    requireCommandLedgerAccess(db, actor, voucher.ledger_id)
  }
}

export async function preparePrintJobForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  payload: PrintPreparePayload
): Promise<{ jobId: string }> {
  const currentActor = requireCommandActor(actor)
  pruneExpiredPrintJobs()
  assertPrintPrepareAccess(db, actor, payload)

  const jobId = randomUUID()
  const initialBookType = payload.type === 'book' ? payload.bookType : null
  const preferenceKey = getPreviewPreferenceKey(initialBookType)
  savePrintJob({
    id: jobId,
    type: payload.type === 'batch' ? 'batch' : payload.type,
    bookType: initialBookType,
    preferenceKey,
    title: '打印任务',
    ledgerId:
      payload.type === 'book'
        ? payload.ledgerId
        : payload.type === 'voucher'
          ? (payload.ledgerId ?? null)
          : (payload.ledgerId ?? null),
    createdBy: currentActor.id,
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    status: 'preparing',
    orientation: 'portrait',
    settings: buildDefaultPreviewSettings('portrait'),
    sourceDocument: null,
    layoutResult: null,
    layoutVersion: 0,
    error: null,
    previewWebContentsId: null
  })

  const finalizeJob = async (): Promise<void> => {
    const job = loadPrintJob(jobId)
    if (!job) return
    try {
      const prepared = createPrintDocument(db, payload)
      const settings = loadPersistedPreviewSettings(
        db,
        currentActor.id,
        preferenceKey,
        prepared.orientation
      )
      const layoutResult = await layoutPrintDocument(prepared.document, settings)
      job.type = prepared.type
      job.title = prepared.title
      job.ledgerId = prepared.ledgerId
      job.orientation = settings.orientation
      job.settings = settings
      job.sourceDocument = prepared.document
      job.layoutResult = layoutResult
      job.layoutVersion = 1
      job.status = 'ready'
      job.error = null
      savePrintJob(job)
    } catch (error) {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : '生成打印任务失败'
      job.layoutResult = null
      savePrintJob(job)
    }
  }

  if (currentActor.source === 'cli') {
    await finalizeJob()
  } else {
    void Promise.resolve().then(finalizeJob)
  }

  return { jobId }
}

export function getPrintJobStatusForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  jobId: string
): {
  status: PrintJobStatus
  title: string
  error: string | null
  pageCount: number
  layoutVersion: number
  layoutError: string | null
} | null {
  const job = getAccessiblePrintJobForActor(db, actor, jobId)
  if (!job) {
    return null
  }

  return {
    status: job.status,
    title: job.title,
    error: job.error,
    pageCount: job.layoutResult?.pageCount ?? 0,
    layoutVersion: job.layoutVersion,
    layoutError: job.error
  }
}

export function getPrintPreviewModelForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  jobId: string
): (PrintLayoutResult & { layoutVersion: number }) | null {
  const job = getAccessiblePrintJobForActor(db, actor, jobId)
  if (!job) {
    return null
  }

  return buildPreviewModel(job)
}

export async function updatePrintPreviewSettingsForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  payload: { jobId: string; settings: Partial<PrintPreviewSettings> }
): Promise<(PrintLayoutResult & { layoutVersion: number }) | null> {
  const job = getAccessiblePrintJobForActor(db, actor, payload.jobId)
  if (!job || !job.sourceDocument) {
    return null
  }

  const nextSettings = normalizePrintPreviewSettings(payload.settings, job.settings.orientation)
  const layoutResult = await layoutPrintDocument(job.sourceDocument, nextSettings)
  job.settings = nextSettings
  job.orientation = nextSettings.orientation
  job.layoutResult = layoutResult
  job.layoutVersion += 1
  job.error = null
  if (job.preferenceKey) {
    persistPreviewSettings(db, job.createdBy, job.preferenceKey, nextSettings)
  }
  savePrintJob(job)
  return buildPreviewModel(job)
}

export async function openPrintPreviewForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  jobId: string,
  options?: { keepAlive?: boolean }
): Promise<boolean> {
  const job = getAccessiblePrintJobForActor(db, actor, jobId)
  if (!job || job.status !== 'ready' || !job.layoutResult) {
    return false
  }

  if (options?.keepAlive) {
    requestEmbeddedCliKeepAlive()
  }
  await openPreviewWindow(jobId)
  return true
}

export async function printPreparedJobForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  payload: PrintCommandPayload
): Promise<{ success: boolean; error?: string } | null> {
  const command = resolvePrintCommandPayload(payload)
  const job = getAccessiblePrintJobForActor(db, actor, command.jobId)
  if (!job) {
    return null
  }

  return printJobToSystem(command.jobId, {
    silent: command.silent,
    deviceName: command.deviceName
  })
}

export async function exportPreparedJobPdfForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  payload: PrintCommandPayload,
  defaultOutputPath?: string
): Promise<{ filePath: string } | null> {
  const command = resolvePrintCommandPayload(payload)
  const job = getAccessiblePrintJobForActor(db, actor, command.jobId)
  if (!job) {
    return null
  }

  const outputPath = command.outputPath ?? defaultOutputPath
  if (!outputPath) {
    throw new Error('缺少 PDF 输出路径')
  }

  const filePath = await exportPrintJobPdfToPath(command.jobId, outputPath)
  return { filePath }
}

export function disposePrintJobForActor(
  db: ReturnType<typeof getDatabase>,
  actor: CommandActor | null,
  jobId: string
): boolean {
  const job = getAccessiblePrintJobForActor(db, actor, jobId)
  if (!job) {
    return false
  }

  const previewWindow = getPreviewWindow(jobId)
  previewWindow?.close()
  deletePrintJob(jobId)
  return true
}

async function acquirePrintWindow(
  jobId: string,
  options: { show: boolean; trackPreviewWindow: boolean }
): Promise<{
  job: PrintJobRecord
  window: BrowserWindow
  temporary: boolean
}> {
  const job = loadPrintJob(jobId)
  if (!job) {
    throw new Error('打印任务不存在')
  }

  const previewModel = buildPreviewModel(job)
  if (!previewModel) {
    throw new Error(job.error ?? '打印任务尚未完成')
  }

  const existingPreviewWindow = getPreviewWindow(jobId)
  if (existingPreviewWindow) {
    return {
      job,
      window: existingPreviewWindow,
      temporary: false
    }
  }

  const temporaryWindow = await createPreviewWindowForJob({
    jobId,
    previewModel,
    show: options.show,
    trackPreviewWindow: options.trackPreviewWindow
  })

  return {
    job,
    window: temporaryWindow,
    temporary: true
  }
}

async function exportPrintJobPdfToPath(jobId: string, outputPath: string): Promise<string> {
  const acquired = await acquirePrintWindow(jobId, {
    show: false,
    trackPreviewWindow: false
  })

  try {
    const pdfBuffer = await acquired.window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: acquired.job.orientation === 'landscape',
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    })

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true })
    await fsPromises.writeFile(outputPath, pdfBuffer)
    return outputPath
  } finally {
    if (acquired.temporary) {
      acquired.window.close()
    }
  }
}

async function printJobToSystem(
  jobId: string,
  options?: {
    silent?: boolean
    deviceName?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const acquired = await acquirePrintWindow(jobId, {
    show: !options?.silent,
    trackPreviewWindow: false
  })

  try {
    return await new Promise<{ success: boolean; error?: string }>((resolve) => {
      acquired.window.webContents.print(
        {
          printBackground: true,
          landscape: acquired.job.orientation === 'landscape',
          silent: options?.silent === true,
          deviceName: options?.deviceName
        },
        (success, failureReason) => {
          resolve(success ? { success: true } : { success: false, error: failureReason })
        }
      )
    })
  } finally {
    if (acquired.temporary) {
      acquired.window.close()
    }
  }
}

export function registerPrintHandlers(): void {
  const db = getDatabase()
  ipcMain.handle('print:prepare', (event, payload: PrintPreparePayload) => {
    const user = requireAuth(event)
    pruneExpiredPrintJobs()

    if (payload.type === 'report') {
      const detail = getReportSnapshotDetail(db, payload.snapshotId, payload.ledgerId)
      requireLedgerAccess(event, db, detail.ledger_id)
    } else if (payload.type === 'batch' && payload.batchType === 'report') {
      for (const snapshotId of payload.snapshotIds) {
        const detail = getReportSnapshotDetail(db, snapshotId, payload.ledgerId)
        requireLedgerAccess(event, db, detail.ledger_id)
      }
    } else if (payload.type === 'book') {
      requireLedgerAccess(event, db, payload.ledgerId)
    } else if (payload.type === 'voucher') {
      const placeholders = payload.voucherIds.map(() => '?').join(', ')
      const vouchers = db
        .prepare(`SELECT DISTINCT ledger_id FROM vouchers WHERE id IN (${placeholders})`)
        .all(...payload.voucherIds) as Array<{ ledger_id: number }>
      if (vouchers.length === 0) {
        throw new Error('凭证不存在')
      }
      for (const voucher of vouchers) {
        requireLedgerAccess(event, db, voucher.ledger_id)
      }
    }

    const jobId = randomUUID()
    const initialBookType = payload.type === 'book' ? payload.bookType : null
    const preferenceKey = getPreviewPreferenceKey(initialBookType)
    savePrintJob({
      id: jobId,
      type: payload.type === 'batch' ? 'batch' : payload.type,
      bookType: initialBookType,
      preferenceKey,
      title: '打印任务',
      ledgerId:
        payload.type === 'book'
          ? payload.ledgerId
          : payload.type === 'voucher'
            ? (payload.ledgerId ?? null)
            : (payload.ledgerId ?? null),
      createdBy: user.id,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      status: 'preparing',
      orientation: 'portrait',
      settings: buildDefaultPreviewSettings('portrait'),
      sourceDocument: null,
      layoutResult: null,
      layoutVersion: 0,
      error: null,
      previewWebContentsId: null
    })

    void Promise.resolve().then(async () => {
      const job = loadPrintJob(jobId)
      if (!job) return
      try {
        const prepared = createPrintDocument(db, payload)
        const settings = loadPersistedPreviewSettings(
          db,
          user.id,
          preferenceKey,
          prepared.orientation
        )
        const layoutResult = await layoutPrintDocument(prepared.document, settings)
        job.type = prepared.type
        job.title = prepared.title
        job.ledgerId = prepared.ledgerId
        job.orientation = settings.orientation
        job.settings = settings
        job.sourceDocument = prepared.document
        job.layoutResult = layoutResult
        job.layoutVersion = 1
        job.status = 'ready'
        job.error = null
        savePrintJob(job)
      } catch (error) {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : '生成打印任务失败'
        job.layoutResult = null
        savePrintJob(job)
      }
    })

    return { success: true, jobId }
  })

  ipcMain.handle('print:getJobStatus', (event, jobId: string) => {
    const { job, failure } = resolveAccessiblePrintJob(event, jobId)
    if (failure) {
      return failure
    }
    if (!job) {
      return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
    }
    return {
      success: true,
      status: job.status,
      title: job.title,
      error: job.error,
      pageCount: job.layoutResult?.pageCount ?? 0,
      layoutVersion: job.layoutVersion,
      layoutError: job.error
    }
  })

  ipcMain.handle('print:getPreviewModel', (event, jobId: string) => {
    const { job, failure } = resolveAccessiblePrintJob(event, jobId)
    if (failure) {
      return failure
    }
    if (!job) {
      return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
    }

    const previewModel = buildPreviewModel(job)
    if (!previewModel) {
      return buildPrintFailureResponse(job.error ?? '打印任务尚未完成', 'CONFLICT', {
        jobId,
        status: job.status
      })
    }

    return {
      success: true,
      model: previewModel
    }
  })

  ipcMain.handle(
    'print:updatePreviewSettings',
    async (event, payload: { jobId: string; settings: Partial<PrintPreviewSettings> }) => {
      const { job, failure } = resolveAccessiblePrintJob(event, payload.jobId)
      if (failure) {
        return failure
      }
      if (!job) {
        return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', {
          jobId: payload.jobId
        })
      }
      if (!job.sourceDocument) {
        return buildPrintFailureResponse(job.error ?? '打印任务尚未完成', 'CONFLICT', {
          jobId: payload.jobId,
          status: job.status
        })
      }

      try {
        const nextSettings = normalizePrintPreviewSettings(
          payload.settings,
          job.settings.orientation
        )
        const layoutResult = await layoutPrintDocument(job.sourceDocument, nextSettings)
        job.settings = nextSettings
        job.orientation = nextSettings.orientation
        job.layoutResult = layoutResult
        job.layoutVersion += 1
        job.error = null
        if (job.preferenceKey) {
          persistPreviewSettings(db, job.createdBy, job.preferenceKey, nextSettings)
        }
        savePrintJob(job)
        return {
          success: true,
          model: buildPreviewModel(job)
        }
      } catch (error) {
        job.error = error instanceof Error ? error.message : '更新打印预览失败'
        savePrintJob(job)
        return buildPrintFailureResponse(job.error, 'CONFLICT', {
          jobId: payload.jobId,
          status: job.status
        })
      }
    }
  )

  ipcMain.handle('print:openPreview', async (event, jobId: string) => {
    const { job, failure } = resolveAccessiblePrintJob(event, jobId)
    if (failure) {
      return failure
    }
    if (!job) {
      return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', { jobId })
    }
    if (job.status !== 'ready' || !job.layoutResult) {
      return buildPrintFailureResponse(job.error ?? '打印任务尚未完成', 'CONFLICT', {
        jobId,
        status: job.status
      })
    }

    await openPreviewWindow(jobId)
    return { success: true }
  })

  ipcMain.handle('print:print', async (event, payload: PrintCommandPayload) => {
    const command = resolvePrintCommandPayload(payload)
    const { job, failure } = resolveAccessiblePrintJob(event, command.jobId)
    if (failure) {
      return failure
    }
    if (!job) {
      return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', {
        jobId: command.jobId
      })
    }
    if (job.status !== 'ready' || !job.layoutResult) {
      return buildPrintFailureResponse(job.error ?? '打印任务尚未完成', 'CONFLICT', {
        jobId: command.jobId,
        status: job.status
      })
    }

    return printJobToSystem(command.jobId, {
      silent: command.silent,
      deviceName: command.deviceName
    })

    /*
    const previewWindow = getPreviewWindow(command.jobId)
    if (!previewWindow) {
      return { success: false, error: '请先打开打印预览' }
    }

    return await new Promise<{ success: boolean; error?: string }>((resolve) => {
      previewWindow.webContents.print(
        {
          printBackground: true,
          landscape: job.orientation === 'landscape'
        },
        (success, failureReason) => {
          resolve(success ? { success: true } : { success: false, error: failureReason })
        }
      )
    })
    */
  })

  ipcMain.handle('print:exportPdf', async (event, payload: PrintCommandPayload) => {
    const command = resolvePrintCommandPayload(payload)
    const { job, failure } = resolveAccessiblePrintJob(event, command.jobId)
    if (failure) {
      return failure
    }
    if (!job) {
      return buildPrintFailureResponse('打印任务不存在', 'NOT_FOUND', {
        jobId: command.jobId
      })
    }
    if (job.status !== 'ready' || !job.layoutResult) {
      return buildPrintFailureResponse(job.error ?? '打印任务尚未完成', 'CONFLICT', {
        jobId: command.jobId,
        status: job.status
      })
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = path.join(getPrintExportDir(), `${sanitizeFileName(job.title)}.pdf`)
    const saveResult = command.outputPath
      ? { canceled: false, filePath: command.outputPath }
      : browserWindow
        ? await dialog.showSaveDialog(browserWindow, {
            defaultPath,
            filters: [{ name: 'PDF 鏂囨。', extensions: ['pdf'] }]
          })
        : await dialog.showSaveDialog({
            defaultPath,
            filters: [{ name: 'PDF 鏂囨。', extensions: ['pdf'] }]
          })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const filePath = await exportPrintJobPdfToPath(command.jobId, saveResult.filePath)
    return { success: true, filePath }

    /*
    const previewWindow = getPreviewWindow(command.jobId)
    if (!previewWindow) {
      return { success: false, error: '请先打开打印预览' }
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = path.join(getPrintExportDir(), `${sanitizeFileName(job.title)}.pdf`)
    const saveResult = browserWindow
      ? await dialog.showSaveDialog(browserWindow, {
          defaultPath,
          filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath,
          filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
        })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const pdfBuffer = await previewWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      landscape: job.orientation === 'landscape',
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
    })

    await import('node:fs/promises').then((fs) =>
      fs.mkdir(path.dirname(saveResult.filePath as string), { recursive: true })
    )
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(saveResult.filePath as string, pdfBuffer)
    )

    return { success: true, filePath: saveResult.filePath }
    */
  })

  ipcMain.handle('print:dispose', (event, jobId: string) => {
    const job = (() => {
      try {
        return getAccessiblePrintJob(event, jobId)
      } catch {
        return null
      }
    })()
    if (!job) {
      return { success: true }
    }

    const previewWindow = getPreviewWindow(jobId)
    previewWindow?.close()
    deletePrintJob(jobId)
    return { success: true }
  })
}

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import { getDatabase } from '../database/init'
import { sanitizePathSegment } from '../services/fileIntegrity'
import { getReportSnapshotDetail, type ReportSnapshotDetail } from '../services/reporting'
import {
  buildPrintDocumentHtml,
  buildPrintPreviewHtml,
  resolveBookPrintOrientation,
  type PrintDocument,
  type PrintJobType,
  type PrintTableSegment,
  type PrintTableColumn,
  type PrintTableRow,
  type PrintVoucherRecord
} from '../services/print'
import { requireAuth, requireLedgerAccess } from './session'

type PrintJobStatus = 'preparing' | 'ready' | 'failed'

type PrintPreparePayload =
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
  title: string
  ledgerId: number | null
  createdBy: number
  createdAt: number
  lastAccessAt: number
  status: PrintJobStatus
  orientation: 'portrait' | 'landscape'
  html: string | null
  error: string | null
  previewWebContentsId: number | null
}

const printJobs = new Map<string, PrintJobRecord>()
const PRINT_JOB_TTL_MS = 1000 * 60 * 60 * 12

function pruneExpiredPrintJobs(now: number = Date.now()): void {
  for (const [jobId, job] of printJobs) {
    if (now - job.lastAccessAt <= PRINT_JOB_TTL_MS) {
      continue
    }

    const previewWindow =
      job.previewWebContentsId === null
        ? null
        : BrowserWindow.getAllWindows().find(
            (window) => window.webContents.id === job.previewWebContentsId
          ) ?? null
    previewWindow?.close()
    printJobs.delete(jobId)
  }
}

function sanitizeFileName(value: string): string {
  return sanitizePathSegment(value, '打印预览')
}

function getPrintExportDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '打印导出')
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
    metaLines: [
      `取数范围：${detail.content.scope.startDate} 至 ${detail.content.scope.endDate}`,
      `口径：${detail.content.scope.includeUnpostedVouchers ? '含未记账凭证' : '仅已记账凭证'}`
    ],
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
  html: string
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
      html: buildPrintDocumentHtml(document)
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
      html: buildPrintDocumentHtml(document)
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
      html: buildPrintDocumentHtml(document)
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
    html: buildPrintDocumentHtml(document)
  }
}

function getPreviewWindow(jobId: string): BrowserWindow | null {
  pruneExpiredPrintJobs()
  const job = printJobs.get(jobId)
  if (!job?.previewWebContentsId) {
    return null
  }
  job.lastAccessAt = Date.now()
  return (
    BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === job.previewWebContentsId
    ) ?? null
  )
}

function getAccessiblePrintJob(event: IpcMainInvokeEvent, jobId: string): PrintJobRecord | null {
  pruneExpiredPrintJobs()
  const job = printJobs.get(jobId)
  if (!job) {
    return null
  }
  job.lastAccessAt = Date.now()

  if (job.previewWebContentsId === event.sender.id) {
    return job
  }

  const user = requireAuth(event)
  if (job.createdBy !== user.id && !user.isAdmin) {
    throw new Error('无权访问该打印任务')
  }

  return job
}

async function openPreviewWindow(
  jobId: string,
  title: string,
  contentHtml: string,
  orientation: 'portrait' | 'landscape'
): Promise<void> {
  const existing = getPreviewWindow(jobId)
  if (existing) {
    existing.focus()
    return
  }

  const previewWindow = new BrowserWindow({
    width: 1120,
    height: 860,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  const previewHtml = buildPrintPreviewHtml(jobId, title, contentHtml, orientation)
  previewWindow.on('closed', () => {
    const job = printJobs.get(jobId)
    if (job) {
      job.previewWebContentsId = null
    }
  })
  await previewWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`)
  const job = printJobs.get(jobId)
  if (job) {
    job.previewWebContentsId = previewWindow.webContents.id
  }
}

export function registerPrintHandlers(): void {
  ipcMain.handle('print:prepare', (event, payload: PrintPreparePayload) => {
    const user = requireAuth(event)
    const db = getDatabase()
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
    printJobs.set(jobId, {
      id: jobId,
      type: payload.type === 'batch' ? 'batch' : payload.type,
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
      html: null,
      error: null,
      previewWebContentsId: null
    })

    void Promise.resolve().then(() => {
      const job = printJobs.get(jobId)
      if (!job) return
      try {
        const prepared = createPrintDocument(db, payload)
        job.type = prepared.type
        job.title = prepared.title
        job.ledgerId = prepared.ledgerId
        job.orientation = prepared.orientation
        job.html = prepared.html
        job.status = 'ready'
      } catch (error) {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : '生成打印任务失败'
      }
    })

    return { success: true, jobId }
  })

  ipcMain.handle('print:getJobStatus', (event, jobId: string) => {
    const job = (() => {
      try {
        return getAccessiblePrintJob(event, jobId)
      } catch {
        return null
      }
    })()
    if (!job) {
      return { success: false, error: '打印任务不存在' }
    }
    return {
      success: true,
      status: job.status,
      title: job.title,
      error: job.error
    }
  })

  ipcMain.handle('print:openPreview', async (event, jobId: string) => {
    const job = (() => {
      try {
        return getAccessiblePrintJob(event, jobId)
      } catch {
        return null
      }
    })()
    if (!job) {
      return { success: false, error: '打印任务不存在' }
    }
    if (job.status !== 'ready' || !job.html) {
      return { success: false, error: job.error ?? '打印任务尚未完成' }
    }

    await openPreviewWindow(jobId, job.title, job.html, job.orientation)
    return { success: true }
  })

  ipcMain.handle('print:print', async (event, jobId: string) => {
    const job = (() => {
      try {
        return getAccessiblePrintJob(event, jobId)
      } catch {
        return null
      }
    })()
    if (!job) {
      return { success: false, error: '打印任务不存在' }
    }

    const previewWindow = getPreviewWindow(jobId)
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
  })

  ipcMain.handle('print:exportPdf', async (event, jobId: string) => {
    const job = (() => {
      try {
        return getAccessiblePrintJob(event, jobId)
      } catch {
        return null
      }
    })()
    if (!job) {
      return { success: false, error: '打印任务不存在' }
    }

    const previewWindow = getPreviewWindow(jobId)
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
    printJobs.delete(jobId)
    return { success: true }
  })
}

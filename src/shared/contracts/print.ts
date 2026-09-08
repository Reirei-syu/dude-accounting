import type { ReportRenderOptions } from '../reportTablePresentation'

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
  forceSinglePage?: boolean
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
  controlLocks?: {
    orientation?: boolean
    scalePercent?: boolean
  }
}

export type PrintPreviewMarginPreset = 'default' | 'narrow' | 'extra-narrow'
export type PrintPreviewDensityPreset = 'default' | 'compact' | 'ultra-compact'

export interface PrintPreviewSettings {
  orientation: PrintOrientation
  scalePercent: number
  marginPreset: PrintPreviewMarginPreset
  densityPreset: PrintPreviewDensityPreset
}

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
      renderOptions?: ReportRenderOptions
    }
  | {
      type: 'batch'
      batchType: 'report'
      ledgerId?: number
      snapshotIds: number[]
      renderOptions?: ReportRenderOptions
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

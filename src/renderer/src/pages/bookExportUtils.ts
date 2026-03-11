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
  format: BookExportFormat
  columns: BookExportColumn[]
  rows: BookExportRow[]
}

export function toExportAmount(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2))
}

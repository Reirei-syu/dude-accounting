/** 电子凭证列表的固定查询结果；可空字段与现有数据库约束保持一致。 */
export interface ElectronicVoucherListRow {
  id: number
  ledger_id: number
  file_id: number
  voucher_type: 'digital_invoice' | 'bank_receipt' | 'bank_statement' | 'unknown'
  source_number: string | null
  source_date: string | null
  counterpart_name: string | null
  amount_cents: number | null
  fingerprint: string
  status: 'imported' | 'verified' | 'parsed' | 'converted' | 'rejected'
  created_at: string
  updated_at: string
  original_name: string
  stored_path: string
  sha256: string
  file_size: number
  latest_verification_status: 'pending' | 'verified' | 'failed' | null
  last_error: string | null
  linked_voucher_id: number | null
}

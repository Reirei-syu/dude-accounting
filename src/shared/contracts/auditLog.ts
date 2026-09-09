export const AUDIT_LOG_STATES = [
  'succeeded',
  'failed',
  'planned',
  'running',
  'recovery_required'
] as const
export type AuditLogState = (typeof AUDIT_LOG_STATES)[number]

export interface AuditLogCursor {
  createdAt: string
  id: number
}

/** 时间为带时区 ISO 时间；游标取上一页最后一条记录，不使用易被新增日志挤动的 offset。 */
export interface AuditLogFilters {
  ledgerId?: number
  module?: string
  action?: string
  userId?: number
  keyword?: string
  status?: AuditLogState
  operationId?: string
  startTime?: string
  endTime?: string
  cursor?: AuditLogCursor
  limit?: number
}

export interface AuditLogRow {
  id: number
  ledger_id: number | null
  user_id: number | null
  username: string | null
  module: string
  action: string
  target_type: string | null
  target_id: string | null
  reason: string | null
  approval_tag: string | null
  details_json: string
  created_at: string
  status: AuditLogState
  operation_id: string | null
}

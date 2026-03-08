import type Database from 'better-sqlite3'

export interface OperationLogInput {
  ledgerId?: number | null
  userId?: number | null
  username?: string | null
  module: string
  action: string
  targetType?: string | null
  targetId?: string | number | null
  reason?: string | null
  approvalTag?: string | null
  details?: Record<string, unknown> | null
}

export interface OperationLogFilters {
  ledgerId?: number
  module?: string
  action?: string
  userId?: number
  keyword?: string
  limit?: number
}

export interface OperationLogRow {
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
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\r\n]/.test(text)) {
    return text
  }
  return `"${text.replace(/"/g, '""')}"`
}

export function appendOperationLog(
  db: Database.Database,
  input: OperationLogInput
): number {
  const result = db
    .prepare(
      `INSERT INTO operation_logs (
         ledger_id,
         user_id,
         username,
         module,
         action,
         target_type,
         target_id,
         reason,
         approval_tag,
         details_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ledgerId ?? null,
      input.userId ?? null,
      normalizeOptionalText(input.username),
      input.module.trim(),
      input.action.trim(),
      normalizeOptionalText(input.targetType),
      input.targetId === null || input.targetId === undefined ? null : String(input.targetId),
      normalizeOptionalText(input.reason),
      normalizeOptionalText(input.approvalTag),
      JSON.stringify(input.details ?? {})
    )

  return Number(result.lastInsertRowid)
}

export function listOperationLogs(
  db: Database.Database,
  filters: OperationLogFilters = {}
): OperationLogRow[] {
  const whereClauses: string[] = []
  const params: Array<string | number> = []

  if (typeof filters.ledgerId === 'number') {
    whereClauses.push('ledger_id = ?')
    params.push(filters.ledgerId)
  }

  if (filters.module) {
    whereClauses.push('module = ?')
    params.push(filters.module)
  }

  if (filters.action) {
    whereClauses.push('action = ?')
    params.push(filters.action)
  }

  if (typeof filters.userId === 'number') {
    whereClauses.push('user_id = ?')
    params.push(filters.userId)
  }

  if (filters.keyword) {
    whereClauses.push(
      '(username LIKE ? OR reason LIKE ? OR approval_tag LIKE ? OR details_json LIKE ? OR target_id LIKE ?)'
    )
    const keyword = `%${filters.keyword.trim()}%`
    params.push(keyword, keyword, keyword, keyword, keyword)
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(filters.limit ?? 200, 1000))

  return db
    .prepare(
      `SELECT
         id,
         ledger_id,
         user_id,
         username,
         module,
         action,
         target_type,
         target_id,
         reason,
         approval_tag,
         details_json,
         created_at
       FROM operation_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ${limit}`
    )
    .all(...params) as OperationLogRow[]
}

export function exportOperationLogsAsCsv(rows: OperationLogRow[]): string {
  const header = [
    'id',
    'created_at',
    'module',
    'action',
    'ledger_id',
    'user_id',
    'username',
    'target_type',
    'target_id',
    'reason',
    'approval_tag',
    'details_json'
  ]

  const lines = rows.map((row) =>
    [
      row.id,
      row.created_at,
      row.module,
      row.action,
      row.ledger_id,
      row.user_id,
      row.username,
      row.target_type,
      row.target_id,
      row.reason,
      row.approval_tag,
      row.details_json
    ]
      .map((value) => escapeCsv(value))
      .join(',')
  )

  return [header.join(','), ...lines].join('\n')
}

import type Database from 'better-sqlite3'
import {
  AUDIT_LOG_STATES,
  type AuditLogFilters,
  type AuditLogRow
} from '../../shared/contracts/auditLog'
import { CommandError } from '../commands/types'
import { FileOperationJournal } from './fileOperationJournal'

function invalidFilter(): never {
  throw new CommandError('VALIDATION_ERROR', '操作日志筛选条件无效', null, 2)
}

function requireTime(value: unknown, cursor = false): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalidFilter()
  // SQLite 无时区字符串仅允许来自分页游标，含义固定为 UTC。
  if (
    !(
      /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      (cursor && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    )
  )
    invalidFilter()
  return value
}

export function validateAuditLogFilters(filters: AuditLogFilters): void {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) invalidFilter()
  for (const id of [filters.ledgerId, filters.userId]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) invalidFilter()
  }
  if (
    filters.limit !== undefined &&
    (!Number.isInteger(filters.limit) || filters.limit < 1 || filters.limit > 1000)
  )
    invalidFilter()
  for (const text of [filters.module, filters.action, filters.keyword, filters.operationId]) {
    if (text !== undefined && (typeof text !== 'string' || text.length > 200)) invalidFilter()
  }
  if (filters.status !== undefined && !AUDIT_LOG_STATES.includes(filters.status)) invalidFilter()
  if (filters.startTime !== undefined) requireTime(filters.startTime)
  if (filters.endTime !== undefined) requireTime(filters.endTime)
  if (
    filters.startTime &&
    filters.endTime &&
    Date.parse(filters.startTime) > Date.parse(filters.endTime)
  )
    invalidFilter()
  if (filters.cursor !== undefined) {
    if (!filters.cursor || typeof filters.cursor !== 'object') invalidFilter()
    requireTime(filters.cursor.createdAt, true)
    if (!Number.isSafeInteger(filters.cursor.id) || filters.cursor.id === 0) invalidFilter()
  }
}

/** 只发布白名单摘要，不发布 before/after、配置、凭据、附件路径或恢复计划。 */
const mainDetails = `CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END`
const mainState = `CASE
  WHEN json_extract(${mainDetails}, '$.state') IN ('succeeded','failed','planned','running','recovery_required')
    THEN json_extract(${mainDetails}, '$.state')
  ELSE 'succeeded' END`
const mainOperationId = `CASE WHEN json_type(${mainDetails}, '$.operationId')='text'
  THEN json_extract(${mainDetails}, '$.operationId') ELSE NULL END`

/** 负 ID 为控制事件；时间、绝对 ID、符号构成跨库唯一排序键。 */
export function listAuditableOperations(
  db: Database.Database,
  filters: AuditLogFilters = {}
): AuditLogRow[] {
  validateAuditLogFilters(filters)
  const journal = new FileOperationJournal(db.name)
  let attached = false
  try {
    db.prepare('ATTACH DATABASE ? AS audit_control').run(journal.databasePath)
    attached = true
    const where: string[] = []
    const params: Array<string | number> = []
    for (const [key, column] of [
      ['ledgerId', 'ledger_id'],
      ['userId', 'user_id'],
      ['module', 'module'],
      ['action', 'action'],
      ['status', 'status'],
      ['operationId', 'operation_id']
    ] as const) {
      const value = filters[key]
      if (value !== undefined && value !== '') {
        where.push(`${column} = ?`)
        params.push(value)
      }
    }
    if (filters.startTime) {
      where.push('julianday(created_at) >= julianday(?)')
      params.push(filters.startTime)
    }
    if (filters.endTime) {
      where.push('julianday(created_at) <= julianday(?)')
      params.push(filters.endTime)
    }
    if (filters.cursor) {
      where.push('(julianday(created_at), abs(id), id) < (julianday(?), ?, ?)')
      params.push(filters.cursor.createdAt, Math.abs(filters.cursor.id), filters.cursor.id)
    }
    if (filters.keyword?.trim()) {
      where.push(`(instr(lower(module || ' ' || action || ' ' || coalesce(username,'') || ' ' || coalesce(reason,'') || ' ' ||
        coalesce(approval_tag,'') || ' ' || coalesce(target_id,'') || ' ' || details_json), lower(?)) > 0)`)
      params.push(filters.keyword.trim())
    }
    const predicate = where.length ? `WHERE ${where.join(' AND ')}` : ''
    return db
      .prepare(
        `WITH audit_rows AS (
      SELECT id, ledger_id, user_id, username, module, action, target_type,
        CASE WHEN target_id GLOB '[A-Za-z]:*' OR substr(target_id,1,1) IN ('/', char(92))
          OR target_id LIKE 'file:%' THEN '[敏感路径已隐藏]' ELSE target_id END AS target_id,
        reason, approval_tag,
        created_at, ${mainState} AS status, ${mainOperationId} AS operation_id,
        json_object('state', ${mainState}, 'operationId', ${mainOperationId},
          'rowCount', CASE WHEN json_type(${mainDetails}, '$.rowCount')='integer' THEN json_extract(${mainDetails}, '$.rowCount') END,
          'entryCount', CASE WHEN json_type(${mainDetails}, '$.entryCount')='integer' THEN json_extract(${mainDetails}, '$.entryCount') END,
          'period', CASE WHEN json_extract(${mainDetails}, '$.period') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' THEN json_extract(${mainDetails}, '$.period') END
        ) AS details_json
      FROM operation_logs
      UNION ALL
      SELECT -e.id, o.ledger_id, o.actor_id, o.username, 'file_operation', o.kind,
        'file_operation', e.operation_id, NULL, NULL, e.created_at, e.state, e.operation_id,
        json_object('operationId', e.operation_id, 'state', e.state, 'errorCode', e.error_code,
          'compensation', e.compensation, 'currentCompletedSteps', json(o.steps_json))
      FROM audit_control.events e JOIN audit_control.operations o ON o.operation_id=e.operation_id
    ) SELECT * FROM audit_rows ${predicate}
      ORDER BY julianday(created_at) DESC, abs(id) DESC, id DESC LIMIT ?`
      )
      .all(...params, filters.limit ?? 200) as AuditLogRow[]
  } finally {
    try {
      if (attached) db.exec('DETACH DATABASE audit_control')
    } finally {
      journal.close()
    }
  }
}

import type Database from 'better-sqlite3'
import { FileOperationJournal } from './fileOperationJournal'
import { listOperationLogs, type OperationLogFilters, type OperationLogRow } from './auditLog'

function auditTimestamp(value: string): number {
  // SQLite datetime('now') 是 UTC，但没有时区后缀；不能按本地时区解析。
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z` : value)
}

/** 负 ID 属于控制日志事件，与主库正 ID 分离；只投影公开字段。 */
export function listAuditableOperations(
  db: Database.Database,
  filters: OperationLogFilters = {}
): OperationLogRow[] {
  const journal = new FileOperationJournal(db.name)
  try {
    const events: OperationLogRow[] = journal
      .listAuditEvents()
      .map((event) => ({
        id: -event.id,
        ledger_id: event.ledgerId,
        user_id: event.actorId,
        username: event.username,
        module: 'file_operation',
        action: event.kind,
        target_type: 'file_operation',
        target_id: event.operationId,
        reason: null,
        approval_tag: null,
        created_at: event.createdAt,
        details_json: JSON.stringify({
          operationId: event.operationId,
          state: event.state,
          errorCode: event.errorCode,
          compensation: event.compensation,
          currentCompletedSteps: JSON.parse(event.currentCompletedStepsJson)
        })
      }))
      .filter(
        (row) =>
          (filters.ledgerId === undefined || row.ledger_id === filters.ledgerId) &&
          (!filters.module || row.module === filters.module) &&
          (!filters.action || row.action === filters.action) &&
          (filters.userId === undefined || row.user_id === filters.userId) &&
          (!filters.keyword ||
            [row.username, row.target_id, row.details_json].some((value) =>
              value?.toLowerCase().includes(filters.keyword!.trim().toLowerCase())
            ))
      )
    const limit = Math.max(1, Math.min(filters.limit ?? 200, 1000))
    return [...listOperationLogs(db, filters), ...events]
      .sort(
        (a, b) =>
          auditTimestamp(b.created_at) - auditTimestamp(a.created_at) || Math.abs(b.id) - Math.abs(a.id)
      )
      .slice(0, limit)
  } finally {
    journal.close()
  }
}

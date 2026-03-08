import { describe, expect, it } from 'vitest'
import { appendOperationLog, exportOperationLogsAsCsv, listOperationLogs } from './auditLog'

type OperationLogRecord = {
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

class FakeAuditLogDb {
  private nextId = 1
  readonly rows: OperationLogRecord[] = []

  prepare(sql: string): {
    run: (...params: unknown[]) => { lastInsertRowid: number }
    all: (...params: unknown[]) => unknown[]
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (
      normalized ===
      "INSERT INTO operation_logs ( ledger_id, user_id, username, module, action, target_type, target_id, reason, approval_tag, details_json ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ) {
      return {
        run: (
          ledgerId,
          userId,
          username,
          module,
          action,
          targetType,
          targetId,
          reason,
          approvalTag,
          detailsJson
        ) => {
          const id = this.nextId++
          this.rows.push({
            id,
            ledger_id: (ledgerId as number | null) ?? null,
            user_id: (userId as number | null) ?? null,
            username: (username as string | null) ?? null,
            module: String(module),
            action: String(action),
            target_type: (targetType as string | null) ?? null,
            target_id: (targetId as string | null) ?? null,
            reason: (reason as string | null) ?? null,
            approval_tag: (approvalTag as string | null) ?? null,
            details_json: String(detailsJson),
            created_at: `2026-03-08 10:00:0${id}`
          })
          return { lastInsertRowid: id }
        },
        all: () => []
      }
    }

    if (normalized.includes('FROM operation_logs')) {
      return {
        run: () => ({ lastInsertRowid: 0 }),
        all: (...params) => {
          const limitMatch = normalized.match(/LIMIT (\d+)$/)
          const limit = Number(limitMatch?.[1] ?? 200)
          let filtered = [...this.rows]
          let cursor = 0

          if (normalized.includes('ledger_id = ?')) {
            filtered = filtered.filter((row) => row.ledger_id === Number(params[cursor]))
            cursor += 1
          }

          if (normalized.includes('module = ?')) {
            filtered = filtered.filter((row) => row.module === String(params[cursor]))
            cursor += 1
          }

          if (normalized.includes('action = ?')) {
            filtered = filtered.filter((row) => row.action === String(params[cursor]))
            cursor += 1
          }

          if (normalized.includes('user_id = ?')) {
            filtered = filtered.filter((row) => row.user_id === Number(params[cursor]))
            cursor += 1
          }

          if (normalized.includes('username LIKE ?')) {
            const keyword = String(params[cursor]).replace(/%/g, '')
            filtered = filtered.filter((row) =>
              [row.username, row.reason, row.approval_tag, row.details_json, row.target_id]
                .filter(Boolean)
                .some((value) => String(value).includes(keyword))
            )
          }

          return filtered.sort((left, right) => right.id - left.id).slice(0, limit)
        }
      }
    }

    throw new Error(`Unhandled SQL in FakeAuditLogDb: ${normalized}`)
  }
}

describe('auditLog service', () => {
  it('appends and filters operation logs', () => {
    const db = new FakeAuditLogDb()

    appendOperationLog(db as never, {
      ledgerId: 1,
      userId: 9,
      username: 'admin',
      module: 'voucher',
      action: 'emergency_unbookkeep',
      reason: '红字冲销前紧急逆转',
      approvalTag: 'APP-2026-001',
      details: { voucherIds: [12] }
    })
    appendOperationLog(db as never, {
      ledgerId: 2,
      userId: 10,
      username: 'auditor',
      module: 'period',
      action: 'close',
      details: { period: '2026-03' }
    })

    const voucherRows = listOperationLogs(db as never, { module: 'voucher' })
    expect(voucherRows).toHaveLength(1)
    expect(voucherRows[0].reason).toBe('红字冲销前紧急逆转')

    const keywordRows = listOperationLogs(db as never, { keyword: 'APP-2026' })
    expect(keywordRows).toHaveLength(1)
    expect(keywordRows[0].module).toBe('voucher')
  })

  it('exports logs as csv', () => {
    const db = new FakeAuditLogDb()

    appendOperationLog(db as never, {
      ledgerId: 1,
      userId: 9,
      username: 'admin',
      module: 'backup',
      action: 'create',
      details: { path: 'C:\\backups\\ledger-1.db' }
    })

    const csv = exportOperationLogsAsCsv(listOperationLogs(db as never))
    expect(csv).toContain('module,action')
    expect(csv).toContain('backup,create')
    expect(csv).toContain('"{""path"":""C:\\\\backups\\\\ledger-1.db""}"')
  })
})

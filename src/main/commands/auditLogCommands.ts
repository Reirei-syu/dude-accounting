import path from 'node:path'
import { createHash } from 'node:crypto'
import { FileOperationJournal, requireOperationId } from '../services/fileOperationJournal'
import { FileOperationLifecycle } from '../services/fileOperationLifecycle'
import {
  fileOperationFileExportRecovery,
  prepareFileOperationFileExport
} from '../services/fileOperationFileExport'
import { fileOperationCommandError } from './fileOperationError'
import { resolveSessionActor } from '../security/sessionAuthority'
import { listAuditableOperations } from '../services/fileOperationAudit'
import { exportOperationLogsAsCsv, type OperationLogFilters } from '../services/auditLog'
import { requireCommandAdmin } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'
import type { AuditLogCursor } from '../../shared/contracts/auditLog'

function normalizeAuditExportPath(value: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new CommandError('VALIDATION_ERROR', '导出文件路径不能为空', null, 2)
  let target = value.trim()
  if (process.platform === 'win32') {
    const mount = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(target)
    if (mount) target = `${mount[1].toUpperCase()}:\\${(mount[2] ?? '').replaceAll('/', '\\')}`
    else if (target.startsWith('/') && !target.startsWith('//')) {
      const distro = process.env.DUDEACC_WSL_DISTRO_NAME?.trim()
      if (!distro || !/^[\w .-]+$/.test(distro))
        throw new CommandError('VALIDATION_ERROR', 'WSL 原生路径需要明确发行版名称', null, 2)
      target = `\\\\wsl.localhost\\${distro}${target.replaceAll('/', '\\')}`
    }
  } else if (/^[a-z]:[/\\]/i.test(target) || target.startsWith('\\\\')) {
    throw new CommandError('VALIDATION_ERROR', '当前平台不能直接使用 Windows 路径', null, 2)
  }
  if (!path.isAbsolute(target))
    throw new CommandError('VALIDATION_ERROR', '导出文件必须使用显式绝对路径', null, 2)
  const normalized = path.normalize(target)
  if (
    process.platform === 'win32' &&
    !(/^[a-z]:\\/i.test(normalized) || /^\\\\[^\\]+\\[^\\]+\\/.test(normalized))
  ) {
    throw new CommandError('VALIDATION_ERROR', '导出文件必须明确盘符或完整 UNC 共享路径', null, 2)
  }
  return normalized
}

export async function listAuditLogsCommand(
  context: CommandContext,
  filters: OperationLogFilters = {}
): Promise<CommandResult<ReturnType<typeof listAuditableOperations>>> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    return listAuditableOperations(context.db, filters)
  })
}

export async function exportAuditLogsCommand(
  context: CommandContext,
  payload: { filters?: OperationLogFilters; filePath?: string; operationId?: string } = {}
): Promise<
  CommandResult<{
    csv?: string
    filePath?: string
    rowCount: number
    operationId?: string
    hasMore: boolean
    nextCursor?: AuditLogCursor
  }>
> {
  return withCommandResult(context, () => {
    requireCommandAdmin(context.actor)
    const rows = listAuditableOperations(context.db, payload.filters ?? {})
    const last = rows.at(-1)
    const cursor = last ? { createdAt: last.created_at, id: last.id } : undefined
    const hasMore = Boolean(
      cursor && listAuditableOperations(context.db, { ...payload.filters, cursor, limit: 1 }).length
    )
    const pagination = { hasMore, nextCursor: hasMore ? cursor : undefined }
    const csv = exportOperationLogsAsCsv(rows)
    if (payload.filePath !== undefined) {
      const actor = requireCommandAdmin(context.actor)
      const operationId = requireOperationId(payload.operationId)
      const target = normalizeAuditExportPath(payload.filePath)
      const journal = new FileOperationJournal(context.db.name)
      try {
        return new FileOperationLifecycle(journal, context.db).execute(
          {
            operationId,
            kind: 'audit_log_export',
            actorId: actor.id,
            username: actor.username,
            ledgerId: null,
            requestHash: createHash('sha256')
              .update(JSON.stringify([path.resolve(target), payload.filters ?? {}]))
              .digest('hex')
          },
          fileOperationFileExportRecovery,
          (lease) => {
            prepareFileOperationFileExport(journal, lease, operationId, target, csv)
          },
          () => {
            context.actor = resolveSessionActor(context.db, actor.session, actor.source)
            requireCommandAdmin(context.actor)
            appendActorOperationLog(context, {
              module: 'audit_log',
              action: 'export',
              details: { operationId, rowCount: rows.length }
            })
            return { operationId, rowCount: rows.length, filePath: target, ...pagination }
          }
        )
      } catch (error) {
        throw fileOperationCommandError(error, operationId, journal)
      } finally {
        journal.close()
      }
    }
    appendActorOperationLog(context, {
      module: 'audit_log',
      action: 'export',
      details: {
        rowCount: rows.length,
        filePath: payload.filePath ?? null
      }
    })
    return {
      rowCount: rows.length,
      ...pagination,
      filePath: payload.filePath,
      csv: payload.filePath ? undefined : csv
    }
  })
}

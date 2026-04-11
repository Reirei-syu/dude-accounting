import {
  buildReportExportDefaultPath,
  exportReportSnapshotsBatch,
  getDefaultReportExportRootDir,
  getPreferredReportExportDir,
  rememberReportExportDir
} from '../services/reportExport'
import {
  deleteReportSnapshot,
  generateReportSnapshot,
  getReportSnapshotDetail,
  listReportSnapshots,
  type GenerateReportSnapshotParams,
  type ReportExportFormat,
  type ReportListFilters
} from '../services/reporting'
import { writeReportSnapshotExcel, writeReportSnapshotPdf } from '../services/reportSnapshotOutput'
import type { ReportRenderOptions } from '../../shared/reportTablePresentation'
import {
  buildBookQueryExportDefaultPath,
  exportBookQueryToFile,
  getDefaultBookQueryExportRootDir,
  getPreferredBookQueryExportDir,
  normalizeBookQueryExportPayload,
  rememberBookQueryExportDir,
  type BookQueryExportPayload
} from '../services/bookQueryExport'
import {
  getAuxiliaryBalances,
  getAuxiliaryDetail,
  getDetailLedger,
  getJournal,
  listSubjectBalances,
  type AuxiliaryBalanceQuery,
  type AuxiliaryDetailQuery,
  type DetailLedgerQuery,
  type JournalQuery,
  type SubjectBalanceQuery
} from '../services/bookQuery'
import { requireCommandActor, requireCommandLedgerAccess } from './authz'
import { appendActorOperationLog } from './operationLog'
import { withCommandResult } from './result'
import type { CommandContext, CommandResult } from './types'
import { CommandError } from './types'

function resolveReportExportPath(
  context: CommandContext,
  format: ReportExportFormat,
  filePath: string | undefined,
  detail: ReturnType<typeof getReportSnapshotDetail>
): string {
  if (filePath) {
    return filePath
  }

  const preferredDir =
    getPreferredReportExportDir(context.db, context.runtime.documentsPath) ||
    getDefaultReportExportRootDir(context.runtime.documentsPath)
  return buildReportExportDefaultPath(preferredDir, detail, format)
}

function resolveBookExportPath(
  context: CommandContext,
  payload: BookQueryExportPayload
): string {
  if (payload.filePath) {
    return payload.filePath
  }

  const preferredDir =
    getPreferredBookQueryExportDir(context.db, context.runtime.documentsPath) ||
    getDefaultBookQueryExportRootDir(context.runtime.documentsPath)
  return buildBookQueryExportDefaultPath(preferredDir, payload)
}

export async function listReportsCommand(
  context: CommandContext,
  filters: ReportListFilters
): Promise<CommandResult<ReturnType<typeof listReportSnapshots>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, filters.ledgerId)
    return listReportSnapshots(context.db, filters)
  })
}

export async function getReportDetailCommand(
  context: CommandContext,
  payload: { snapshotId: number; ledgerId?: number }
): Promise<CommandResult<ReturnType<typeof getReportSnapshotDetail>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    const detail = getReportSnapshotDetail(context.db, payload.snapshotId, payload.ledgerId)
    requireCommandLedgerAccess(context.db, context.actor, detail.ledger_id)
    return detail
  })
}

export async function generateReportCommand(
  context: CommandContext,
  payload: GenerateReportSnapshotParams
): Promise<CommandResult<{ snapshot: ReturnType<typeof generateReportSnapshot> }>> {
  return withCommandResult(context, () => {
    const actor = requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const snapshot = generateReportSnapshot(context.db, {
      ...payload,
      generatedBy: actor.id
    })

    appendActorOperationLog(context, {
      ledgerId: snapshot.ledger_id,
      module: 'reporting',
      action: 'generate_snapshot',
      targetType: 'report_snapshot',
      targetId: snapshot.id,
      details: {
        reportType: snapshot.report_type,
        period: snapshot.period,
        reportName: snapshot.report_name
      }
    })

    return { snapshot }
  })
}

export async function deleteReportCommand(
  context: CommandContext,
  payload: { snapshotId: number; ledgerId: number }
): Promise<CommandResult<{ snapshotId: number }>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    const detail = getReportSnapshotDetail(context.db, payload.snapshotId, payload.ledgerId)
    const deleted = deleteReportSnapshot(context.db, payload.snapshotId, payload.ledgerId)
    if (!deleted) {
      throw new CommandError('NOT_FOUND', '报表快照不存在或已删除', null, 5)
    }

    appendActorOperationLog(context, {
      ledgerId: payload.ledgerId,
      module: 'reporting',
      action: 'delete_snapshot',
      targetType: 'report_snapshot',
      targetId: payload.snapshotId,
      details: {
        reportType: detail.report_type,
        period: detail.period,
        reportName: detail.report_name
      }
    })

    return { snapshotId: payload.snapshotId }
  })
}

export async function exportReportCommand(
  context: CommandContext,
  payload: {
    snapshotId: number
    ledgerId?: number
    format: ReportExportFormat
    filePath?: string
    renderOptions?: ReportRenderOptions
  }
): Promise<CommandResult<{ filePath: string }>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    const detail = getReportSnapshotDetail(context.db, payload.snapshotId, payload.ledgerId)
    requireCommandLedgerAccess(context.db, context.actor, detail.ledger_id)
    const targetPath = resolveReportExportPath(context, payload.format, payload.filePath, detail)
    const exportPath =
      payload.format === 'xlsx'
        ? await writeReportSnapshotExcel(targetPath, detail, payload.renderOptions)
        : await writeReportSnapshotPdf(targetPath, detail, payload.renderOptions)
    rememberReportExportDir(context.db, exportPath)

    appendActorOperationLog(context, {
      ledgerId: detail.ledger_id,
      module: 'reporting',
      action: 'export_snapshot',
      targetType: 'report_snapshot',
      targetId: detail.id,
      details: {
        reportType: detail.report_type,
        period: detail.period,
        reportName: detail.report_name,
        exportPath,
        format: payload.format
      }
    })

    return { filePath: exportPath }
  })
}

export async function exportReportsBatchCommand(
  context: CommandContext,
  payload: {
    snapshotIds: number[]
    ledgerId?: number
    format: ReportExportFormat
    directoryPath: string
    renderOptions?: ReportRenderOptions
  }
): Promise<CommandResult<{ directoryPath: string; filePaths: string[] }>> {
  return withCommandResult(context, async () => {
    requireCommandActor(context.actor)
    if (!Array.isArray(payload.snapshotIds) || payload.snapshotIds.length === 0) {
      throw new CommandError('VALIDATION_ERROR', '请先选择至少一张报表', null, 2)
    }

    const details = payload.snapshotIds.map((snapshotId) =>
      getReportSnapshotDetail(context.db, snapshotId, payload.ledgerId)
    )
    for (const detail of details) {
      requireCommandLedgerAccess(context.db, context.actor, detail.ledger_id)
    }

    const filePaths = await exportReportSnapshotsBatch(
      details,
      payload.format,
      payload.directoryPath,
      async (detail, filePath) =>
        payload.format === 'xlsx'
          ? writeReportSnapshotExcel(filePath, detail, payload.renderOptions)
          : writeReportSnapshotPdf(filePath, detail, payload.renderOptions)
    )
    rememberReportExportDir(context.db, payload.directoryPath)

    appendActorOperationLog(context, {
      ledgerId: details[0]?.ledger_id ?? null,
      module: 'reporting',
      action: 'export_snapshot_batch',
      targetType: 'report_snapshot_batch',
      targetId: payload.snapshotIds.join(','),
      details: {
        reportCount: details.length,
        format: payload.format,
        directoryPath: payload.directoryPath
      }
    })

    return {
      directoryPath: payload.directoryPath,
      filePaths
    }
  })
}

export async function listSubjectBalancesCommand(
  context: CommandContext,
  query: SubjectBalanceQuery
): Promise<CommandResult<ReturnType<typeof listSubjectBalances>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return listSubjectBalances(context.db, query)
  })
}

export async function getDetailLedgerCommand(
  context: CommandContext,
  query: DetailLedgerQuery
): Promise<CommandResult<ReturnType<typeof getDetailLedger>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return getDetailLedger(context.db, query)
  })
}

export async function getJournalCommand(
  context: CommandContext,
  query: JournalQuery
): Promise<CommandResult<ReturnType<typeof getJournal>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return getJournal(context.db, query)
  })
}

export async function getAuxiliaryBalancesCommand(
  context: CommandContext,
  query: AuxiliaryBalanceQuery
): Promise<CommandResult<ReturnType<typeof getAuxiliaryBalances>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return getAuxiliaryBalances(context.db, query)
  })
}

export async function getAuxiliaryDetailCommand(
  context: CommandContext,
  query: AuxiliaryDetailQuery
): Promise<CommandResult<ReturnType<typeof getAuxiliaryDetail>>> {
  return withCommandResult(context, () => {
    requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, query.ledgerId)
    return getAuxiliaryDetail(context.db, query)
  })
}

export async function exportBookQueryCommand(
  context: CommandContext,
  payload: BookQueryExportPayload
): Promise<CommandResult<{ filePath: string }>> {
  return withCommandResult(context, async () => {
    const actor = requireCommandActor(context.actor)
    requireCommandLedgerAccess(context.db, context.actor, payload.ledgerId)
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      throw new CommandError('VALIDATION_ERROR', '导出标题不能为空', null, 2)
    }
    if (!Array.isArray(payload.columns) || payload.columns.length === 0) {
      throw new CommandError('VALIDATION_ERROR', '导出列不能为空', null, 2)
    }

    const exportPayload = normalizeBookQueryExportPayload(payload)
    const exportPath = await exportBookQueryToFile(
      {
        ...exportPayload,
        filePath: resolveBookExportPath(context, exportPayload)
      },
      resolveBookExportPath(context, exportPayload)
    )
    rememberBookQueryExportDir(context.db, exportPath)

    appendActorOperationLog(
      {
        ...context,
        actor
      },
      {
        ledgerId: exportPayload.ledgerId,
        module: 'book_query',
        action: 'export',
        targetType: exportPayload.bookType,
        targetId: exportPayload.title,
        details: {
          title: exportPayload.title,
          subtitle: exportPayload.subtitle,
          format: exportPayload.format,
          rowCount: exportPayload.rows.length,
          exportPath
        }
      }
    )

    return { filePath: exportPath }
  })
}

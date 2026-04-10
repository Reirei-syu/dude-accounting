import { createCommandContext } from '../main/commands/context'
import {
  createUserCommand,
  deleteUserCommand,
  listUsersCommand,
  loginCommand,
  logoutCommand,
  updateUserCommand,
  whoamiCommand
} from '../main/commands/authCommands'
import {
  exportAuditLogsCommand,
  listAuditLogsCommand
} from '../main/commands/auditLogCommands'
import {
  createAuxiliaryItemCommand,
  createCashFlowMappingCommand,
  createSubjectCommand,
  deleteAuxiliaryItemCommand,
  deleteCashFlowMappingCommand,
  deleteSubjectCommand,
  listAuxiliaryItemsCommand,
  listCashFlowMappingsCommand,
  listSubjectsCommand,
  updateAuxiliaryItemCommand,
  updateCashFlowMappingCommand,
  updateSubjectCommand
} from '../main/commands/accountCommands'
import {
  createBackupCommand,
  deleteBackupCommand,
  importBackupCommand,
  listBackupsCommand,
  restoreBackupCommand,
  validateBackupCommand
} from '../main/commands/backupCommands'
import {
  deleteArchiveCommand,
  exportArchiveCommand,
  getArchiveManifestCommand,
  listArchivesCommand,
  validateArchiveCommand
} from '../main/commands/archiveCommands'
import {
  convertElectronicVoucherCommand,
  importElectronicVoucherCommand,
  listElectronicVouchersCommand,
  parseElectronicVoucherCommand,
  verifyElectronicVoucherCommand
} from '../main/commands/electronicVoucherCommands'
import {
  applyLedgerTemplateCommand,
  createLedgerCommand,
  deleteLedgerCommand,
  getLedgerDeletionRiskCommand,
  listLedgerPeriodsCommand,
  listLedgersCommand,
  listLedgerTemplatesCommand,
  updateLedgerCommand
} from '../main/commands/ledgerCommands'
import {
  closePeriodCommand,
  executeCarryForwardCommand,
  getPeriodStatusCommand,
  listCarryForwardRulesCommand,
  previewCarryForwardCommand,
  reopenPeriodCommand,
  saveCarryForwardRulesCommand
} from '../main/commands/periodCommands'
import {
  deleteReportCommand,
  exportBookQueryCommand,
  exportReportCommand,
  exportReportsBatchCommand,
  generateReportCommand,
  getAuxiliaryBalancesCommand,
  getAuxiliaryDetailCommand,
  getDetailLedgerCommand,
  getJournalCommand,
  getReportDetailCommand,
  listReportsCommand,
  listSubjectBalancesCommand
} from '../main/commands/reportingCommands'
import {
  createVoucherCommand,
  getNextVoucherNumberCommand,
  getVoucherEntriesCommand,
  listVouchersCommand,
  swapVoucherPositionsCommand,
  updateVoucherCommand,
  voucherBatchActionCommand
} from '../main/commands/voucherCommands'
import { renderCommandOutput } from './output'
import { parseCliArgs } from './parse'
import { resolveCliPayload } from './payload'
import {
  clearCliSession,
  requireCliSession,
  saveCliSession
} from './sessionStore'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandOutputMode, CommandResult } from '../main/commands/types'
import { CommandError } from '../main/commands/types'

type CommandExecutor = (
  runtime: RuntimeContext,
  payload: unknown,
  outputMode: CommandOutputMode,
  token?: string
) => Promise<CommandResult<unknown>>

function getExitCodeForResult(result: CommandResult<unknown>): number {
  if (result.status === 'success') {
    return 0
  }

  switch (result.error?.code) {
    case 'VALIDATION_ERROR':
    case 'RISK_CONFIRMATION_REQUIRED':
    case 'NOT_IMPLEMENTED':
      return 2
    case 'UNAUTHORIZED':
    case 'AUTH_FAILED':
      return 3
    case 'FORBIDDEN':
    case 'LEDGER_ACCESS_DENIED':
      return 4
    case 'NOT_FOUND':
      return 5
    case 'CONFLICT':
      return 6
    default:
      return 10
  }
}

function createAuthedContext(
  runtime: RuntimeContext,
  outputMode: CommandOutputMode,
  token?: string
) {
  const session = requireCliSession(runtime, token)
  return createCommandContext({
    runtime,
    actor: session.actor,
    outputMode
  })
}

const registry: Record<string, Record<string, CommandExecutor>> = {
  auth: {
    login: async (runtime, payload, outputMode) => {
      const context = createCommandContext({ runtime, outputMode })
      const result = await loginCommand(context, payload as { username: string; password: string })
      if (result.status === 'success' && result.data) {
        const session = saveCliSession(runtime, result.data.actor)
        return {
          status: 'success',
          data: {
            token: session.token,
            user: result.data.user
          },
          error: null
        }
      }
      return result as CommandResult<unknown>
    },
    logout: async (runtime, _payload, outputMode, token) => {
      const context = createAuthedContext(runtime, outputMode, token)
      const result = await logoutCommand(context)
      if (result.status === 'success') {
        clearCliSession(runtime)
      }
      return result as CommandResult<unknown>
    },
    whoami: async (runtime, _payload, outputMode, token) => {
      const session = requireCliSession(runtime, token)
      const context = createCommandContext({
        runtime,
        actor: session.actor,
        outputMode
      })
      const result = await whoamiCommand(context)
      if (result.status === 'success' && result.data) {
        return {
          status: 'success',
          data: {
            token: session.token,
            actor: result.data.actor
          },
          error: null
        }
      }
      return result as CommandResult<unknown>
    },
    'list-users': async (runtime, _payload, outputMode, token) =>
      listUsersCommand(createAuthedContext(runtime, outputMode, token)),
    'create-user': async (runtime, payload, outputMode, token) =>
      createUserCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'update-user': async (runtime, payload, outputMode, token) =>
      updateUserCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'delete-user': async (runtime, payload, outputMode, token) =>
      deleteUserCommand(createAuthedContext(runtime, outputMode, token), payload as { userId: number })
  },
  'audit-log': {
    list: async (runtime, payload, outputMode, token) =>
      listAuditLogsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    export: async (runtime, payload, outputMode, token) =>
      exportAuditLogsCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  ledger: {
    list: async (runtime, _payload, outputMode, token) =>
      listLedgersCommand(createAuthedContext(runtime, outputMode, token)),
    create: async (runtime, payload, outputMode, token) =>
      createLedgerCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    update: async (runtime, payload, outputMode, token) =>
      updateLedgerCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteLedgerCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    periods: async (runtime, payload, outputMode, token) =>
      listLedgerPeriodsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    templates: async (runtime, _payload, outputMode, token) =>
      listLedgerTemplatesCommand(createAuthedContext(runtime, outputMode, token)),
    'apply-template': async (runtime, payload, outputMode, token) =>
      applyLedgerTemplateCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    risk: async (runtime, payload, outputMode, token) =>
      getLedgerDeletionRiskCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  subject: {
    list: async (runtime, payload, outputMode, token) =>
      listSubjectsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    create: async (runtime, payload, outputMode, token) =>
      createSubjectCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    update: async (runtime, payload, outputMode, token) =>
      updateSubjectCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteSubjectCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  auxiliary: {
    list: async (runtime, payload, outputMode, token) =>
      listAuxiliaryItemsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    create: async (runtime, payload, outputMode, token) =>
      createAuxiliaryItemCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    update: async (runtime, payload, outputMode, token) =>
      updateAuxiliaryItemCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteAuxiliaryItemCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  cashflow: {
    list: async (runtime, payload, outputMode, token) =>
      listCashFlowMappingsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    create: async (runtime, payload, outputMode, token) =>
      createCashFlowMappingCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    update: async (runtime, payload, outputMode, token) =>
      updateCashFlowMappingCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteCashFlowMappingCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  voucher: {
    'next-number': async (runtime, payload, outputMode, token) =>
      getNextVoucherNumberCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    save: async (runtime, payload, outputMode, token) =>
      createVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    update: async (runtime, payload, outputMode, token) =>
      updateVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    list: async (runtime, payload, outputMode, token) =>
      listVouchersCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    entries: async (runtime, payload, outputMode, token) =>
      getVoucherEntriesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    swap: async (runtime, payload, outputMode, token) =>
      swapVoucherPositionsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    batch: async (runtime, payload, outputMode, token) =>
      voucherBatchActionCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  period: {
    status: async (runtime, payload, outputMode, token) =>
      getPeriodStatusCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    close: async (runtime, payload, outputMode, token) =>
      closePeriodCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    reopen: async (runtime, payload, outputMode, token) =>
      reopenPeriodCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  'carry-forward': {
    rules: async (runtime, payload, outputMode, token) =>
      listCarryForwardRulesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    save: async (runtime, payload, outputMode, token) =>
      saveCarryForwardRulesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    preview: async (runtime, payload, outputMode, token) =>
      previewCarryForwardCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    execute: async (runtime, payload, outputMode, token) =>
      executeCarryForwardCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  report: {
    list: async (runtime, payload, outputMode, token) =>
      listReportsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    detail: async (runtime, payload, outputMode, token) =>
      getReportDetailCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    generate: async (runtime, payload, outputMode, token) =>
      generateReportCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteReportCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    export: async (runtime, payload, outputMode, token) =>
      exportReportCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'export-batch': async (runtime, payload, outputMode, token) =>
      exportReportsBatchCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  book: {
    'subject-balances': async (runtime, payload, outputMode, token) =>
      listSubjectBalancesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'detail-ledger': async (runtime, payload, outputMode, token) =>
      getDetailLedgerCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    journal: async (runtime, payload, outputMode, token) =>
      getJournalCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'aux-balances': async (runtime, payload, outputMode, token) =>
      getAuxiliaryBalancesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    'aux-detail': async (runtime, payload, outputMode, token) =>
      getAuxiliaryDetailCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    export: async (runtime, payload, outputMode, token) =>
      exportBookQueryCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  backup: {
    create: async (runtime, payload, outputMode, token) =>
      createBackupCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    list: async (runtime, payload, outputMode, token) =>
      listBackupsCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    validate: async (runtime, payload, outputMode, token) =>
      validateBackupCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    import: async (runtime, payload, outputMode, token) =>
      importBackupCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteBackupCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    restore: async (runtime, payload, outputMode, token) =>
      restoreBackupCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  archive: {
    export: async (runtime, payload, outputMode, token) =>
      exportArchiveCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    list: async (runtime, payload, outputMode, token) =>
      listArchivesCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    validate: async (runtime, payload, outputMode, token) =>
      validateArchiveCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    delete: async (runtime, payload, outputMode, token) =>
      deleteArchiveCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    manifest: async (runtime, payload, outputMode, token) =>
      getArchiveManifestCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  },
  evoucher: {
    import: async (runtime, payload, outputMode, token) =>
      importElectronicVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    list: async (runtime, payload, outputMode, token) =>
      listElectronicVouchersCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    verify: async (runtime, payload, outputMode, token) =>
      verifyElectronicVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    parse: async (runtime, payload, outputMode, token) =>
      parseElectronicVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never),
    convert: async (runtime, payload, outputMode, token) =>
      convertElectronicVoucherCommand(createAuthedContext(runtime, outputMode, token), payload as never)
  }
}

function listCommands(): string[] {
  return Object.entries(registry).flatMap(([domain, actions]) =>
    Object.keys(actions).map((action) => `${domain} ${action}`)
  )
}

export async function runCli(runtime: RuntimeContext, argv: string[]): Promise<number> {
  let result: CommandResult<unknown>
  let outputMode: CommandOutputMode = 'json'

  try {
    if (argv.length === 0 || argv.includes('--help')) {
      result = {
        status: 'success',
        data: {
          product: 'dude-accounting',
          usage: 'dude-accounting <domain> <action> [--payload-file path | --payload-json json | --key value]',
          commands: listCommands()
        },
        error: null
      }
    } else {
      const parsed = parseCliArgs(argv)
      outputMode = parsed.outputMode
      const payload = resolveCliPayload({
        payloadFile: parsed.payloadFile,
        payloadJson: parsed.payloadJson,
        flags: parsed.flags
      })
      const domainRegistry = registry[parsed.domain]
      const executor = domainRegistry?.[parsed.action]
      if (!executor) {
        throw new CommandError(
          'VALIDATION_ERROR',
          `未知命令：${parsed.domain} ${parsed.action}`,
          {
            availableCommands: listCommands()
          },
          2
        )
      }

      result = await executor(runtime, payload, outputMode, parsed.token)
    }
  } catch (error) {
    if (error instanceof Error) {
      result = {
        status: 'error',
        data: null,
        error: {
          code: error instanceof CommandError ? error.code : 'INTERNAL_ERROR',
          message: error.message,
          details: null
        }
      }
    } else {
      result = {
        status: 'error',
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: '未知错误',
          details: null
        }
      }
    }
  }

  const output = renderCommandOutput(result, outputMode)
  if (result.status === 'success') {
    console.log(output)
  } else {
    console.error(output)
  }

  return getExitCodeForResult(result)
}

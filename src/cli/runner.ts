import { executeCliCommand, listCommands } from './executor'
import { runInteractiveCli, shouldEnterInteractiveShell } from './interactive'
import { renderCommandOutput } from './output'
import { parseCliArgs } from './parse'
import { resolveCliPayload } from './payload'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandOutputMode, CommandResult } from '../main/commands/types'
import { CommandError } from '../main/commands/types'

export function getExitCodeForResult(result: CommandResult<unknown>): number {
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

function buildHelpResult(): CommandResult<{
  product: string
  aliases: string[]
  usage: string
  interactiveEntry: string
  commands: string[]
}> {
  return {
    status: 'success',
    data: {
      product: 'dude-accounting',
      aliases: ['dudeacc'],
      usage:
        'dudeacc|dude-accounting <domain> <action> [--payload-file path | --payload-json json | --key value]',
      interactiveEntry: '无参数且当前终端为 TTY 时，直接进入 dudeacc 交互式命令壳',
      commands: listCommands()
    },
    error: null
  }
}

function detectInteractiveTerminalState() {
  return {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    forceInteractive: process.env.DUDEACC_CLI_FORCE_INTERACTIVE === '1'
  }
}

export async function runCliBatch(runtime: RuntimeContext, argv: string[]): Promise<number> {
  let result: CommandResult<unknown>
  let outputMode: CommandOutputMode = 'json'

  try {
    if (argv.length === 0 || argv.includes('--help')) {
      result = buildHelpResult()
    } else {
      const parsed = parseCliArgs(argv)
      outputMode = parsed.outputMode
      const payload = resolveCliPayload({
        payloadFile: parsed.payloadFile,
        payloadJson: parsed.payloadJson,
        flags: parsed.flags
      })

      result = await executeCliCommand(runtime, {
        outputMode,
        token: parsed.token,
        domain: parsed.domain,
        action: parsed.action,
        payload
      })
    }
  } catch (error) {
    if (error instanceof Error) {
      result = {
        status: 'error',
        data: null,
        error: {
          code: error instanceof CommandError ? error.code : 'INTERNAL_ERROR',
          message: error.message,
          details: error instanceof CommandError ? error.details : null
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

export async function runCli(runtime: RuntimeContext, argv: string[]): Promise<number> {
  if (shouldEnterInteractiveShell(argv, detectInteractiveTerminalState())) {
    return runInteractiveCli(runtime)
  }

  return runCliBatch(runtime, argv)
}


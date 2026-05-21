import { executeCliCommand, listCommands } from './executor'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  listShellBuiltInCommands,
  runInteractiveCli,
  shouldEnterInteractiveShell
} from './interactive'
import { renderCommandOutput } from './output'
import { parseCliArgs } from './parse'
import { resolveCliPayload } from './payload'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandOutputMode, CommandResult } from '../main/commands/types'
import { CommandError } from '../main/commands/types'
import { listCommandHelpEntries } from '../main/commands/catalog'

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

function buildHelpResult(showAll = false): CommandResult<{
  product: string
  aliases: string[]
  usage: string
  interactiveEntry: string
  commands: string[]
  builtinCommands?: Array<{ name: string; aliases: string[]; description: string }>
  allCommands?: Array<{
    domain: string
    action: string
    command: string
    aliasZh: string
    description: string
    requiresSession: boolean
    desktopAssisted: boolean
    headlessAlternatives: string[]
  }>
  domains?: string[]
}> {
  const allCommandEntries = showAll ? listCommandHelpEntries() : []
  return {
    status: 'success',
    data: {
      product: 'dude-accounting',
      aliases: ['dudeacc'],
      usage:
        'dudeacc|dude-accounting <domain> <action> [--payload-file path | --payload-stdin | --payload-json json | --key value]',
      interactiveEntry: '无参数且当前终端为 TTY 时，直接进入 dudeacc 交互式命令壳',
      commands: listCommands(),
      builtinCommands: showAll ? listShellBuiltInCommands() : undefined,
      allCommands: showAll ? allCommandEntries : undefined,
      domains: showAll ? [...new Set(allCommandEntries.map((item) => item.domain))] : undefined
    },
    error: null
  }
}

function parseHelpOutputPath(argv: string[]): string | undefined {
  const outputIndex = argv.indexOf('--output')
  if (outputIndex < 0) {
    return undefined
  }

  const outputPath = argv[outputIndex + 1]
  if (!outputPath || outputPath.startsWith('--')) {
    throw new CommandError('VALIDATION_ERROR', '--output 需要指定文件路径', null, 2)
  }
  return outputPath
}

async function writeCommandResultToFile(
  filePath: string,
  result: CommandResult<unknown>,
  outputMode: CommandOutputMode
): Promise<CommandResult<{ filePath: string; bytes: number }>> {
  const resolvedPath = path.resolve(filePath)
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
  const content = `${renderCommandOutput(result, outputMode)}\n`
  await fs.writeFile(resolvedPath, content, 'utf8')
  return {
    status: 'success',
    data: {
      filePath: resolvedPath,
      bytes: Buffer.byteLength(content, 'utf8')
    },
    error: null
  }
}

async function readStdinPayloadJson(): Promise<string> {
  const envPayload = process.env.DUDEACC_PAYLOAD_STDIN_JSON
  if (typeof envPayload === 'string') {
    if (!envPayload.trim()) {
      throw new CommandError('VALIDATION_ERROR', '--payload-stdin 未读取到 JSON 输入', null, 2)
    }
    return envPayload
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) {
    throw new CommandError('VALIDATION_ERROR', '--payload-stdin 未读取到 JSON 输入', null, 2)
  }
  return raw
}

function detectInteractiveTerminalState(): {
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  forceInteractive: boolean
} {
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
      const helpOutputPath = parseHelpOutputPath(argv)
      outputMode = argv.includes('--pretty') ? 'pretty' : 'json'
      result = buildHelpResult(argv.includes('--all'))
      if (helpOutputPath) {
        result = await writeCommandResultToFile(helpOutputPath, result, outputMode)
      }
    } else {
      const parsed = parseCliArgs(argv)
      outputMode = parsed.outputMode
      const payloadStdinJson = parsed.payloadStdin ? await readStdinPayloadJson() : undefined
      const payload = resolveCliPayload({
        payloadFile: parsed.payloadFile,
        payloadStdinJson,
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


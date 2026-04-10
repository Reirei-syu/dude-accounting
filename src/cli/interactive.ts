import readline from 'node:readline/promises'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import type { Readable, Writable } from 'node:stream'
import { executeCliCommand, listCommands, type CliCommandInvocation } from './executor'
import { renderCommandOutput } from './output'
import { parseCliArgs } from './parse'
import { resolveCliPayload } from './payload'
import type { RuntimeContext } from '../main/runtime/runtimeContext'
import type { CommandOutputMode, CommandResult } from '../main/commands/types'
import { CommandError } from '../main/commands/types'

export interface InteractiveShellState {
  outputMode: CommandOutputMode
  ledgerId?: number
  period?: string
}

export interface CliCommandSpec {
  domain: string
  action: string
  aliases: string[]
  description: string
  examples?: string[]
}

export interface ShellBuiltInCommand {
  name: string
  aliases: string[]
  description: string
}

export interface PromptPlanItem {
  key: 'username' | 'password' | 'ledgerId' | 'period'
}

export interface ResolvedInteractiveBuiltin {
  kind: 'builtin'
  name: string
  tokens: string[]
}

export interface ResolvedInteractiveCommand {
  kind: 'command'
  domain: string
  action: string
  payload: Record<string, unknown>
  outputMode: CommandOutputMode
  token?: string
  tokens: string[]
}

export type ResolvedInteractiveInput = ResolvedInteractiveBuiltin | ResolvedInteractiveCommand

export interface ShellBuiltinExecution {
  handled: boolean
  shouldExit?: boolean
  clearScreen?: boolean
  nextState: InteractiveShellState
  text?: string
  result?: CommandResult<unknown>
}

export interface InteractiveTerminalState {
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  forceInteractive?: boolean
}

export type InteractiveCommandExecutor = (
  runtime: RuntimeContext,
  invocation: CliCommandInvocation
) => Promise<CommandResult<unknown>>

const builtinCommands: ShellBuiltInCommand[] = [
  { name: 'help', aliases: ['帮助'], description: '查看交互式命令帮助' },
  { name: 'exit', aliases: ['quit', '退出'], description: '退出交互式 CLI' },
  { name: 'clear', aliases: ['cls', '清屏'], description: '清空当前终端内容' },
  { name: 'mode', aliases: ['模式'], description: '切换输出模式：mode pretty|json' },
  { name: 'context', aliases: ['上下文'], description: '查看当前交互上下文' },
  { name: 'context clear', aliases: ['清空上下文'], description: '清空当前账套和期间上下文' },
  { name: 'use ledger', aliases: ['选择账套'], description: '设置当前账套：use ledger <ledgerId>' },
  { name: 'use period', aliases: ['选择期间'], description: '设置当前期间：use period <YYYY-MM>' },
  { name: 'unset ledger', aliases: ['清除账套'], description: '清除当前账套并一并清除期间' },
  { name: 'unset period', aliases: ['清除期间'], description: '清除当前期间' }
]

const commandSpecs: CliCommandSpec[] = [
  {
    domain: 'auth',
    action: 'login',
    aliases: ['登录'],
    description: '登录当前 CLI 会话'
  },
  {
    domain: 'auth',
    action: 'logout',
    aliases: ['退出登录'],
    description: '退出当前 CLI 登录态'
  },
  {
    domain: 'auth',
    action: 'whoami',
    aliases: ['我是谁'],
    description: '查看当前登录用户'
  },
  {
    domain: 'ledger',
    action: 'list',
    aliases: ['账套列表'],
    description: '查看当前用户可访问的账套列表'
  },
  {
    domain: 'ledger',
    action: 'periods',
    aliases: ['期间列表'],
    description: '查看当前账套的期间列表'
  },
  {
    domain: 'book',
    action: 'subject-balances',
    aliases: ['科目余额表'],
    description: '按当前账套/期间查询科目余额表'
  },
  {
    domain: 'voucher',
    action: 'list',
    aliases: ['凭证列表'],
    description: '按当前账套/期间查询凭证列表'
  },
  {
    domain: 'report',
    action: 'list',
    aliases: ['报表列表'],
    description: '按当前账套/期间查询已生成报表'
  },
  {
    domain: 'period',
    action: 'status',
    aliases: ['期间状态'],
    description: '查看当前账套当前期间的状态'
  }
]

function createSuccessResult<T>(data: T): CommandResult<T> {
  return {
    status: 'success',
    data,
    error: null
  }
}

function createErrorResult(message: string, details: Record<string, unknown> | null = null): CommandResult<null> {
  return {
    status: 'error',
    data: null,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details
    }
  }
}

function tokenizeInteractiveLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of line.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function normalizeBuiltinTokens(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return tokens
  }

  const [first, ...rest] = tokens
  switch (first) {
    case '帮助':
      return ['help', ...rest]
    case '退出':
      return ['exit', ...rest]
    case '清屏':
      return ['clear', ...rest]
    case '模式':
      return ['mode', ...rest]
    case '上下文':
      return ['context', ...rest]
    case '清空上下文':
      return ['context', 'clear', ...rest]
    case '选择账套':
      return ['use', 'ledger', ...rest]
    case '选择期间':
      return ['use', 'period', ...rest]
    case '清除账套':
      return ['unset', 'ledger', ...rest]
    case '清除期间':
      return ['unset', 'period', ...rest]
    default:
      return tokens
  }
}

function normalizeCommandTokens(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return tokens
  }

  const matched = commandSpecs.find((spec) => spec.aliases.includes(tokens[0]))
  if (!matched) {
    return tokens
  }

  return [matched.domain, matched.action, ...tokens.slice(1)]
}

function detectBuiltinName(tokens: string[]): string | null {
  if (tokens.length === 0) {
    return null
  }

  if (tokens[0] === 'help') return 'help'
  if (tokens[0] === 'exit' || tokens[0] === 'quit') return 'exit'
  if (tokens[0] === 'clear' || tokens[0] === 'cls') return 'clear'
  if (tokens[0] === 'mode') return 'mode'
  if (tokens[0] === 'context') return tokens[1] === 'clear' ? 'context clear' : 'context'
  if (tokens[0] === 'use' && tokens[1] === 'ledger') return 'use ledger'
  if (tokens[0] === 'use' && tokens[1] === 'period') return 'use period'
  if (tokens[0] === 'unset' && tokens[1] === 'ledger') return 'unset ledger'
  if (tokens[0] === 'unset' && tokens[1] === 'period') return 'unset period'

  return null
}

function isValidPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

function toPeriodDateRange(period: string): { startDate: string; endDate: string } {
  const [year, month] = period.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    startDate: `${period}-01`,
    endDate: `${period}-${String(lastDay).padStart(2, '0')}`
  }
}

function formatStateSummary(state: InteractiveShellState): string {
  const parts = [`outputMode=${state.outputMode}`]
  parts.push(`ledgerId=${state.ledgerId ?? '未选择'}`)
  parts.push(`period=${state.period ?? '未选择'}`)
  return parts.join(', ')
}

function buildInteractiveHelpResult() {
  return createSuccessResult({
    entrypoints: ['dudeacc', 'dude-accounting'],
    builtinCommands: builtinCommands.map((item) => ({
      name: item.name,
      aliases: item.aliases,
      description: item.description
    })),
    commandAliases: commandSpecs.map((item) => ({
      alias: item.aliases[0],
      command: `${item.domain} ${item.action}`,
      description: item.description
    })),
    rawCommands: listCommands()
  })
}

function buildInteractiveHelpText(): string {
  const builtinLines = builtinCommands.map((item) => {
    const aliasText = item.aliases.length > 0 ? ` / ${item.aliases.join(' / ')}` : ''
    return `  ${item.name}${aliasText}  - ${item.description}`
  })
  const aliasLines = commandSpecs.map(
    (item) => `  ${item.aliases[0]}  ->  ${item.domain} ${item.action}`
  )

  return [
    'DudeAcc 交互式 CLI',
    '',
    '内建命令：',
    ...builtinLines,
    '',
    '高频中文别名：',
    ...aliasLines,
    '',
    '说明：',
    '  1. 无参数且终端为 TTY 时进入交互态。',
    '  2. 也可以直接输入英文原始命令，例如：ledger list',
    '  3. 账套和期间上下文只在当前交互会话内有效。'
  ].join('\n')
}

export function formatInteractivePrompt(state: InteractiveShellState): string {
  const contextParts: string[] = []
  if (typeof state.ledgerId === 'number') {
    contextParts.push(`ledger:${state.ledgerId}`)
  }
  if (state.period) {
    contextParts.push(`period:${state.period}`)
  }

  if (contextParts.length === 0) {
    return 'dudeacc>'
  }

  return `dudeacc[${contextParts.join('|')}]>`
}

export function shouldEnterInteractiveShell(
  argv: string[],
  terminal: InteractiveTerminalState
): boolean {
  if (argv.length > 0) {
    return false
  }

  return Boolean(
    terminal.forceInteractive || (terminal.stdinIsTTY && terminal.stdoutIsTTY)
  )
}

export function resolveInteractiveCommand(line: string): ResolvedInteractiveInput {
  const rawTokens = tokenizeInteractiveLine(line)
  if (rawTokens.length === 0) {
    throw new CommandError('VALIDATION_ERROR', '请输入命令', null, 2)
  }

  const builtinTokens = normalizeBuiltinTokens(rawTokens)
  const builtinName = detectBuiltinName(builtinTokens)
  if (builtinName) {
    return {
      kind: 'builtin',
      name: builtinName,
      tokens: builtinTokens
    }
  }

  const commandTokens = normalizeCommandTokens(rawTokens)
  const parsed = parseCliArgs(commandTokens)
  return {
    kind: 'command',
    domain: parsed.domain,
    action: parsed.action,
    payload: resolveCliPayload({
      payloadFile: parsed.payloadFile,
      payloadJson: parsed.payloadJson,
      flags: parsed.flags
    }) as Record<string, unknown>,
    outputMode: parsed.outputMode,
    token: parsed.token,
    tokens: commandTokens
  }
}

export function applyInteractiveContext(
  input: {
    domain: string
    action: string
    payload: Record<string, unknown>
  },
  state: InteractiveShellState
): {
  domain: string
  action: string
  payload: Record<string, unknown>
} {
  const payload = { ...input.payload }

  if (input.domain === 'ledger' && input.action === 'periods') {
    if (typeof payload.ledgerId !== 'number' && typeof state.ledgerId === 'number') {
      payload.ledgerId = state.ledgerId
    }
  }

  if (input.domain === 'voucher' && input.action === 'list') {
    if (typeof payload.ledgerId !== 'number' && typeof state.ledgerId === 'number') {
      payload.ledgerId = state.ledgerId
    }
    if (!isValidPeriod(payload.period) && state.period) {
      payload.period = state.period
    }
  }

  if (input.domain === 'report' && input.action === 'list') {
    if (typeof payload.ledgerId !== 'number' && typeof state.ledgerId === 'number') {
      payload.ledgerId = state.ledgerId
    }

    if (typeof payload.period === 'string') {
      payload.periods = [payload.period]
      delete payload.period
    }

    if (typeof payload.periods === 'string') {
      payload.periods = [payload.periods]
    }

    if (!Array.isArray(payload.periods) && state.period) {
      payload.periods = [state.period]
    }
  }

  if (input.domain === 'period' && input.action === 'status') {
    if (typeof payload.ledgerId !== 'number' && typeof state.ledgerId === 'number') {
      payload.ledgerId = state.ledgerId
    }
    if (!isValidPeriod(payload.period) && state.period) {
      payload.period = state.period
    }
  }

  if (input.domain === 'book' && input.action === 'subject-balances') {
    if (typeof payload.ledgerId !== 'number' && typeof state.ledgerId === 'number') {
      payload.ledgerId = state.ledgerId
    }

    const derivedPeriod =
      typeof payload.period === 'string' && isValidPeriod(payload.period)
        ? payload.period
        : state.period

    if (
      (!payload.startDate || !payload.endDate) &&
      derivedPeriod &&
      isValidPeriod(derivedPeriod)
    ) {
      const { startDate, endDate } = toPeriodDateRange(derivedPeriod)
      payload.startDate = startDate
      payload.endDate = endDate
    }

    delete payload.period
  }

  return {
    domain: input.domain,
    action: input.action,
    payload
  }
}

export function getInteractivePromptPlan(
  input: {
    domain: string
    action: string
    payload: Record<string, unknown>
  },
  state: InteractiveShellState
): PromptPlanItem[] {
  const merged = applyInteractiveContext(input, state)
  const prompts: PromptPlanItem[] = []

  if (merged.domain === 'auth' && merged.action === 'login') {
    if (typeof merged.payload.username !== 'string' || !merged.payload.username.trim()) {
      prompts.push({ key: 'username' })
    }
    if (typeof merged.payload.password !== 'string') {
      prompts.push({ key: 'password' })
    }
    return prompts
  }

  const needsLedger =
    (merged.domain === 'ledger' && merged.action === 'periods') ||
    (merged.domain === 'book' && merged.action === 'subject-balances') ||
    (merged.domain === 'report' && merged.action === 'list') ||
    (merged.domain === 'voucher' && merged.action === 'list') ||
    (merged.domain === 'period' && merged.action === 'status')

  if (needsLedger && typeof merged.payload.ledgerId !== 'number') {
    prompts.push({ key: 'ledgerId' })
    return prompts
  }

  const needsPeriod =
    (merged.domain === 'book' && merged.action === 'subject-balances') ||
    (merged.domain === 'period' && merged.action === 'status')

  if (
    needsPeriod &&
    !isValidPeriod(merged.payload.period) &&
    (!merged.payload.startDate || !merged.payload.endDate)
  ) {
    prompts.push({ key: 'period' })
  }

  return prompts
}

export function executeShellBuiltin(
  tokens: string[],
  state: InteractiveShellState
): ShellBuiltinExecution {
  const normalizedTokens = normalizeBuiltinTokens(tokens)
  const builtinName = detectBuiltinName(normalizedTokens)
  if (!builtinName) {
    return {
      handled: false,
      nextState: state
    }
  }

  switch (builtinName) {
    case 'help':
      return {
        handled: true,
        nextState: state,
        text: buildInteractiveHelpText(),
        result: buildInteractiveHelpResult()
      }
    case 'exit':
      return {
        handled: true,
        shouldExit: true,
        nextState: state
      }
    case 'clear':
      return {
        handled: true,
        clearScreen: true,
        nextState: state
      }
    case 'mode': {
      const mode = normalizedTokens[1]
      if (mode !== 'pretty' && mode !== 'json') {
        return {
          handled: true,
          nextState: state,
          text: '用法：mode pretty|json',
          result: createErrorResult('用法：mode pretty|json')
        }
      }

      const nextState: InteractiveShellState = {
        ...state,
        outputMode: mode
      }
      return {
        handled: true,
        nextState,
        text: `输出模式已切换为 ${mode}`,
        result: createSuccessResult({ outputMode: mode })
      }
    }
    case 'context':
      return {
        handled: true,
        nextState: state,
        text: `当前上下文：${formatStateSummary(state)}`,
        result: createSuccessResult({
          outputMode: state.outputMode,
          ledgerId: state.ledgerId ?? null,
          period: state.period ?? null
        })
      }
    case 'context clear': {
      const nextState: InteractiveShellState = {
        outputMode: state.outputMode
      }
      return {
        handled: true,
        nextState,
        text: '已清空当前账套和期间上下文',
        result: createSuccessResult({
          outputMode: nextState.outputMode,
          ledgerId: null,
          period: null
        })
      }
    }
    case 'use ledger': {
      const rawLedgerId = normalizedTokens[2]
      const ledgerId = Number(rawLedgerId)
      if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
        return {
          handled: true,
          nextState: state,
          text: '用法：use ledger <ledgerId>',
          result: createErrorResult('用法：use ledger <ledgerId>')
        }
      }

      const nextState: InteractiveShellState = {
        outputMode: state.outputMode,
        ledgerId
      }
      return {
        handled: true,
        nextState,
        text: `已选择当前账套：${ledgerId}`,
        result: createSuccessResult({
          outputMode: nextState.outputMode,
          ledgerId,
          period: null
        })
      }
    }
    case 'use period': {
      const period = normalizedTokens[2]
      if (!isValidPeriod(period)) {
        return {
          handled: true,
          nextState: state,
          text: '用法：use period <YYYY-MM>',
          result: createErrorResult('用法：use period <YYYY-MM>')
        }
      }

      const nextState: InteractiveShellState = {
        ...state,
        period
      }
      return {
        handled: true,
        nextState,
        text: `已选择当前期间：${period}`,
        result: createSuccessResult({
          outputMode: nextState.outputMode,
          ledgerId: nextState.ledgerId ?? null,
          period
        })
      }
    }
    case 'unset ledger': {
      const nextState: InteractiveShellState = {
        outputMode: state.outputMode
      }
      return {
        handled: true,
        nextState,
        text: '已清除当前账套与期间上下文',
        result: createSuccessResult({
          outputMode: nextState.outputMode,
          ledgerId: null,
          period: null
        })
      }
    }
    case 'unset period': {
      const nextState: InteractiveShellState = {
        ...state
      }
      delete nextState.period
      return {
        handled: true,
        nextState,
        text: '已清除当前期间上下文',
        result: createSuccessResult({
          outputMode: nextState.outputMode,
          ledgerId: nextState.ledgerId ?? null,
          period: null
        })
      }
    }
    default:
      return {
        handled: false,
        nextState: state
      }
  }
}

async function writeShellExecution(
  output: Writable,
  state: InteractiveShellState,
  execution: ShellBuiltinExecution
): Promise<void> {
  if (execution.clearScreen) {
    output.write('\x1bc')
  }

  if (execution.text && state.outputMode === 'pretty') {
    output.write(`${execution.text}\n`)
    return
  }

  if (execution.result) {
    output.write(`${renderCommandOutput(execution.result, execution.nextState.outputMode)}\n`)
  }
}

function formatLedgerChoices(ledgers: Array<Record<string, unknown>>): string {
  const lines = ['可选账套：']
  for (const ledger of ledgers) {
    lines.push(
      `  [${ledger.id}] ${String(ledger.name)} (${String(ledger.standard_type)}, 当前期间 ${String(ledger.current_period)})`
    )
  }
  return lines.join('\n')
}

function formatPeriodChoices(periods: Array<Record<string, unknown>>): string {
  const lines = ['可选期间：']
  for (const period of periods) {
    const suffix = Number(period.is_closed) === 1 ? '已结账' : '未结账'
    lines.push(`  ${String(period.period)} (${suffix})`)
  }
  return lines.join('\n')
}

async function promptForLedgerId(
  runtime: RuntimeContext,
  rl: readline.Interface,
  output: Writable,
  outputMode: CommandOutputMode,
  executeCommand: InteractiveCommandExecutor
): Promise<number> {
  const result = await executeCommand(runtime, {
    domain: 'ledger',
    action: 'list',
    payload: {},
    outputMode
  })

  if (result.status !== 'success' || !Array.isArray(result.data)) {
    throw new CommandError(
      result.error?.code ?? 'UNAUTHORIZED',
      result.error?.message ?? '读取账套列表失败',
      result.error?.details ?? null,
      3
    )
  }

  if (result.data.length === 0) {
    throw new CommandError('VALIDATION_ERROR', '当前没有可选账套', null, 2)
  }

  output.write(`${formatLedgerChoices(result.data as Array<Record<string, unknown>>)}\n`)
  const answer = (await rl.question('请输入账套ID: ')).trim()
  const ledgerId = Number(answer)
  if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
    throw new CommandError('VALIDATION_ERROR', '账套ID 必须是正整数', null, 2)
  }

  return ledgerId
}

async function promptForPeriod(
  runtime: RuntimeContext,
  rl: readline.Interface,
  output: Writable,
  ledgerId: number,
  outputMode: CommandOutputMode,
  executeCommand: InteractiveCommandExecutor
): Promise<string> {
  const result = await executeCommand(runtime, {
    domain: 'ledger',
    action: 'periods',
    payload: { ledgerId },
    outputMode
  })

  if (result.status !== 'success' || !Array.isArray(result.data)) {
    throw new CommandError(
      result.error?.code ?? 'VALIDATION_ERROR',
      result.error?.message ?? '读取期间列表失败',
      result.error?.details ?? null,
      2
    )
  }

  if (result.data.length === 0) {
    throw new CommandError('VALIDATION_ERROR', '当前账套还没有可选期间', { ledgerId }, 2)
  }

  output.write(`${formatPeriodChoices(result.data as Array<Record<string, unknown>>)}\n`)
  const defaultPeriod = String((result.data[0] as Record<string, unknown>).period)
  const answer = (await rl.question(`请输入期间（默认 ${defaultPeriod}）: `)).trim()
  const period = answer || defaultPeriod
  if (!isValidPeriod(period)) {
    throw new CommandError('VALIDATION_ERROR', '期间格式应为 YYYY-MM', null, 2)
  }

  return period
}

async function promptForItem(
  runtime: RuntimeContext,
  rl: readline.Interface,
  output: Writable,
  item: PromptPlanItem,
  state: InteractiveShellState,
  payload: Record<string, unknown>,
  executeCommand: InteractiveCommandExecutor
): Promise<unknown> {
  switch (item.key) {
    case 'username': {
      const answer = (await rl.question('用户名: ')).trim()
      if (!answer) {
        throw new CommandError('VALIDATION_ERROR', '用户名不能为空', null, 2)
      }
      return answer
    }
    case 'password':
      return await rl.question('密码: ')
    case 'ledgerId':
      return await promptForLedgerId(runtime, rl, output, state.outputMode, executeCommand)
    case 'period': {
      const ledgerId =
        typeof payload.ledgerId === 'number'
          ? payload.ledgerId
          : typeof state.ledgerId === 'number'
            ? state.ledgerId
            : undefined
      if (typeof ledgerId !== 'number') {
        throw new CommandError('VALIDATION_ERROR', '请选择账套后再选择期间', null, 2)
      }
      return await promptForPeriod(runtime, rl, output, ledgerId, state.outputMode, executeCommand)
    }
    default:
      throw new CommandError('VALIDATION_ERROR', `不支持的补问项：${item.key}`, null, 2)
  }
}

function renderShellCommandResult(
  output: Writable,
  result: CommandResult<unknown>,
  outputMode: CommandOutputMode
): void {
  output.write(`${renderCommandOutput(result, outputMode)}\n`)
}

export async function runInteractiveCli(
  runtime: RuntimeContext,
  options: {
    input?: Readable
    output?: Writable
    executeCommand?: InteractiveCommandExecutor
  } = {}
): Promise<number> {
  const input = options.input ?? processStdin
  const output = options.output ?? processStdout
  const executeCommand = options.executeCommand ?? executeCliCommand
  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean((input as Readable & { isTTY?: boolean }).isTTY && (output as Writable & { isTTY?: boolean }).isTTY)
  })

  let state: InteractiveShellState = {
    outputMode: 'pretty'
  }

  try {
    while (true) {
      const line = await rl.question(formatInteractivePrompt(state))
      if (!line.trim()) {
        continue
      }

      try {
        const resolved = resolveInteractiveCommand(line)
        if (resolved.kind === 'builtin') {
          let builtinTokens = resolved.tokens

          if (resolved.name === 'use ledger' && !builtinTokens[2]) {
            builtinTokens = [
              'use',
              'ledger',
              String(await promptForLedgerId(runtime, rl, output, state.outputMode, executeCommand))
            ]
          }

          if (resolved.name === 'use period' && !builtinTokens[2]) {
            const ledgerId = typeof state.ledgerId === 'number'
              ? state.ledgerId
              : await promptForLedgerId(runtime, rl, output, state.outputMode, executeCommand)
            if (typeof state.ledgerId !== 'number') {
              state = { ...state, ledgerId }
            }
            builtinTokens = [
              'use',
              'period',
              await promptForPeriod(runtime, rl, output, ledgerId, state.outputMode, executeCommand)
            ]
          }

          const execution = executeShellBuiltin(builtinTokens, state)
          await writeShellExecution(output, state, execution)
          state = execution.nextState
          if (execution.shouldExit) {
            return 0
          }
          continue
        }

        let commandInput: ResolvedInteractiveCommand = resolved
        let prepared = applyInteractiveContext(commandInput, state)
        const promptPlan = getInteractivePromptPlan(prepared, state)

        for (const item of promptPlan) {
          const value = await promptForItem(
            runtime,
            rl,
            output,
            item,
            state,
            prepared.payload,
            executeCommand
          )
          prepared = {
            ...prepared,
            payload: {
              ...prepared.payload,
              [item.key]: value
            }
          }
          prepared = applyInteractiveContext(prepared, state)
        }

        const result = await executeCommand(runtime, {
          domain: prepared.domain,
          action: prepared.action,
          payload: prepared.payload,
          outputMode: state.outputMode,
          token: commandInput.token
        })

        renderShellCommandResult(output, result, state.outputMode)
      } catch (error) {
        const result =
          error instanceof CommandError
            ? {
                status: 'error' as const,
                data: null,
                error: {
                  code: error.code,
                  message: error.message,
                  details: error.details
                }
              }
            : {
                status: 'error' as const,
                data: null,
                error: {
                  code: 'INTERNAL_ERROR',
                  message: error instanceof Error ? error.message : '未知错误',
                  details: null
                }
              }

        renderShellCommandResult(output, result, state.outputMode)
      }
    }
  } finally {
    rl.close()
  }
}

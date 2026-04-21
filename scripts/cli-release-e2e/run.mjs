import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..')
const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)

const ENTRYPOINT_EXE = 'dude-app.exe --cli'
const ENTRYPOINT_CMD = 'dude-accounting.cmd'
const ENTRYPOINT_INTERACTIVE = 'dudeacc.cmd'

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true })
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function parseSingleQuotedList(rawValue) {
  return [...rawValue.matchAll(/'([^']*)'/g)].map((match) => match[1])
}

function parseCatalogSurface() {
  const catalogPath = path.join(repoRoot, 'src', 'main', 'commands', 'catalog.ts')
  const source = readText(catalogPath)
  const blockRegex =
    /\{\s*domain:\s*'([^']+)'\s*,\s*action:\s*'([^']+)'\s*,\s*description:\s*'([^']*)'\s*,\s*aliases:\s*\[([^\]]*)\]\s*,\s*batchSafe:\s*(true|false)\s*,\s*desktopAssisted:\s*(true|false)\s*,\s*requiresSession:\s*(true|false)\s*,\s*sessionEffect:\s*'([^']+)'\s*,\s*uiMethods:\s*\[([^\]]*)\]\s*,\s*uiAssistedMethods:\s*\[([^\]]*)\]\s*,\s*promptHints:\s*\[([^\]]*)\]\s*\}/g

  const commands = []
  for (const match of source.matchAll(blockRegex)) {
    const aliases = parseSingleQuotedList(match[4])
    const command = `${match[1]} ${match[2]}`
    commands.push({
      command,
      domain: match[1],
      action: match[2],
      description: match[3],
      aliases,
      batchSafe: match[5] === 'true',
      desktopAssisted: match[6] === 'true',
      requiresSession: match[7] === 'true',
      sessionEffect: match[8],
      uiMethods: parseSingleQuotedList(match[9]),
      uiAssistedMethods: parseSingleQuotedList(match[10]),
      promptHints: parseSingleQuotedList(match[11])
    })
  }

  if (commands.length === 0) {
    throw new Error('未能从 catalog.ts 解析 CLI 命令元数据')
  }

  const aliasEntries = commands.flatMap((item) =>
    item.aliases.map((alias) => ({
      alias,
      command: item.command,
      description: item.description
    }))
  )

  return {
    commands,
    canonicalCommands: commands.map((item) => item.command),
    aliasEntries,
    desktopAssistedCommands: commands
      .filter((item) => item.desktopAssisted)
      .map((item) => item.command)
  }
}

function parseInteractiveBuiltins() {
  const interactivePath = path.join(repoRoot, 'src', 'cli', 'interactive.ts')
  const source = readText(interactivePath)
  const itemRegex =
    /\{\s*name:\s*'([^']+)'\s*,\s*aliases:\s*\[([^\]]*)\]\s*,\s*description:\s*'([^']+)'\s*\}/g
  const builtins = []
  for (const match of source.matchAll(itemRegex)) {
    builtins.push({
      name: match[1],
      aliases: parseSingleQuotedList(match[2]),
      description: match[3]
    })
  }

  if (builtins.length === 0) {
    throw new Error('未能从 interactive.ts 解析内建命令')
  }

  return builtins
}

function resolveReleaseRoot() {
  const envOverride = process.env.DUDEACC_RELEASE_WIN_UNPACKED?.trim()
  if (envOverride) {
    return path.resolve(envOverride)
  }

  const builderConfig = readText(path.join(repoRoot, 'electron-builder.yml'))
  const outputMatch = builderConfig.match(/^\s*output:\s*(.+)$/m)
  const outputDirectory = outputMatch ? outputMatch[1].trim() : 'D:/coding/completed/dude-app'
  return path.join(outputDirectory, 'win-unpacked')
}

function buildIsolatedEnvironment(label, outputRoot) {
  const envRoot = path.join(outputRoot, 'envs', label)
  const homeDirectory = path.join(envRoot, 'home')
  const appDataPath = path.join(envRoot, 'appdata')
  const eventsFile = path.join(envRoot, 'events', 'cli-e2e.jsonl')
  const workDirectory = path.join(envRoot, 'work')
  const payloadDirectory = path.join(workDirectory, 'payloads')
  const exportDirectory = path.join(workDirectory, 'exports')
  const fixtureDirectory = path.join(workDirectory, 'fixtures')
  const logDirectory = path.join(workDirectory, 'logs')
  const userDataPath = path.join(appDataPath, 'dude-app')
  const databasePath = path.join(userDataPath, 'data', 'dude-accounting.db')
  const documentsPath = path.join(homeDirectory, 'Documents')

  for (const directoryPath of [
    homeDirectory,
    appDataPath,
    path.dirname(eventsFile),
    workDirectory,
    payloadDirectory,
    exportDirectory,
    fixtureDirectory,
    logDirectory,
    documentsPath
  ]) {
    ensureDir(directoryPath)
  }

  return {
    label,
    envRoot,
    homeDirectory,
    appDataPath,
    userDataPath,
    databasePath,
    documentsPath,
    eventsFile,
    workDirectory,
    payloadDirectory,
    exportDirectory,
    fixtureDirectory,
    logDirectory,
    env: {
      ...process.env,
      APPDATA: appDataPath,
      DUDEACC_E2E_APPDATA_PATH: appDataPath,
      DUDEACC_E2E_EVENTS_FILE: eventsFile,
      DUDEACC_E2E_DRY_RUN_DESKTOP_ACTIONS: '1',
      DUDEACC_E2E_SUPPRESS_RELAUNCH: '1'
    }
  }
}

function quoteCmdArg(value) {
  if (!value) {
    return '""'
  }

  if (!/[ \t"&()^[\]{}=;!'+,`~|<>]/.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

function buildCmdInvocation(targetPath, args) {
  const command = path.basename(targetPath)
  return {
    command: 'cmd.exe',
    args: ['/d', '/c', command, ...args]
  }
}

function countNewlines(value) {
  if (!value) {
    return 0
  }
  return value.split(/\r?\n/).filter((line) => line.trim() !== '').length
}

function getEventsCursor(envContext) {
  if (!fs.existsSync(envContext.eventsFile)) {
    return 0
  }
  return countNewlines(readText(envContext.eventsFile))
}

function readEventsSince(envContext, cursor) {
  if (!fs.existsSync(envContext.eventsFile)) {
    return []
  }

  return readText(envContext.eventsFile)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(cursor)
    .map((line) => JSON.parse(line))
}

function extractCommandResult(output) {
  const matches = []

  for (let startIndex = 0; startIndex < output.length; startIndex += 1) {
    if (output[startIndex] !== '{') {
      continue
    }

    let depth = 0
    for (let index = startIndex; index < output.length; index += 1) {
      const current = output[index]
      if (current === '{') depth += 1
      if (current === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(output.slice(startIndex, index + 1))
            if (
              parsed &&
              typeof parsed.status === 'string' &&
              Object.prototype.hasOwnProperty.call(parsed, 'data') &&
              Object.prototype.hasOwnProperty.call(parsed, 'error')
            ) {
              matches.push(parsed)
            }
          } catch {
            // ignore invalid slices
          }
          break
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`未找到 CLI JSON 输出：\n${output}`)
  }

  return matches[matches.length - 1]
}

function extractFirstJsonValue(output) {
  const trimmed = output.trim()
  if (!trimmed) {
    throw new Error('未找到可解析的 JSON 输出')
  }

  for (let startIndex = 0; startIndex < trimmed.length; startIndex += 1) {
    if (trimmed[startIndex] !== '{') {
      continue
    }

    let depth = 0
    for (let index = startIndex; index < trimmed.length; index += 1) {
      const current = trimmed[index]
      if (current === '{') depth += 1
      if (current === '}') {
        depth -= 1
        if (depth === 0) {
          return JSON.parse(trimmed.slice(startIndex, index + 1))
        }
      }
    }
  }

  throw new Error(`未找到可解析的 JSON 输出：\n${output}`)
}

async function waitForPreviewTargets(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const payload = await response.json()
        const pages = Array.isArray(payload)
          ? payload.filter((item) => item && item.type === 'page')
          : []
        if (pages.length > 0) {
          return {
            port,
            pageCount: pages.length,
            pages: pages.map((item) => ({
              id: item.id,
              title: item.title,
              url: item.url
            }))
          }
        }
      }
    } catch {
      // ignore polling errors until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`等待 preview target 超时，port=${port}`)
}

async function spawnBuffered(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000
  const stdinMode = options.stdinText ? 'pipe' : 'ignore'

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: [stdinMode, 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`命令执行超时：${command} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        signal: signal ?? null,
        stdout,
        stderr
      })
    })

    if (options.stdinText) {
      child.stdin.write(options.stdinText)
      child.stdin.end()
    }
  })
}

function buildCliArgs(commandKey, input, payloadFilePath) {
  const [domain, action] = commandKey.split(' ')
  const args = [domain, action]

  if (payloadFilePath) {
    args.push('--payload-file', payloadFilePath)
  }

  if (input.flags) {
    for (const [key, value] of Object.entries(input.flags)) {
      args.push(`--${key}`)
      if (value !== true) {
        args.push(String(value))
      }
    }
  }

  return args
}

function sanitizeForFileName(value) {
  return value.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'payload'
}

function createBatchPayloadFile(envContext, commandKey, payload, sequenceNo) {
  const fileName = `${String(sequenceNo).padStart(3, '0')}-${sanitizeForFileName(commandKey)}.json`
  const filePath = path.join(envContext.payloadDirectory, fileName)
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return filePath
}

function todayToken() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
}

function seedDiagnosticRuntimeLog(envContext) {
  const logDir = path.join(envContext.userDataPath, 'logs')
  ensureDir(logDir)
  const filePath = path.join(logDir, `runtime-${todayToken()}.jsonl`)
  fs.appendFileSync(
    filePath,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'cli.release.e2e.seed'
    })}\n`,
    'utf8'
  )
  return filePath
}

function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function createSystemBackupFixture({ databasePath, backupDir, ledgerId, ledgerName, period, fiscalYear }) {
  ensureDir(backupDir)
  const safeLedgerName = ledgerName.replace(/[\\/:*?"<>|]/g, '_')
  const safePeriod = period.replace(/[\\/:*?"<>|]/g, '_')
  const packageDir = path.join(backupDir, `${safeLedgerName}_${safePeriod}_system-backup`)
  ensureDir(packageDir)
  const databaseFile = `${safeLedgerName}_${safePeriod}_system-backup.db`
  const backupPath = path.join(packageDir, databaseFile)
  fs.copyFileSync(databasePath, backupPath)
  const checksum = computeFileSha256(backupPath)
  const fileSize = fs.statSync(backupPath).size
  const createdAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const manifestPath = path.join(packageDir, 'manifest.json')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: '1.0',
        packageType: 'system_backup',
        ledgerId,
        ledgerName,
        period,
        fiscalYear,
        createdAt,
        databaseFile,
        checksum,
        fileSize
      },
      null,
      2
    ),
    'utf8'
  )
  return {
    packageDir,
    backupPath,
    manifestPath
  }
}

function createReportRecord(entry) {
  return {
    startedAt: new Date().toISOString(),
    ...entry
  }
}

class CoverageTracker {
  constructor(surface, outputDir) {
    this.surface = surface
    this.outputDir = outputDir
    this.entries = []
    this.canonicalSuccess = new Set()
    this.aliasSuccess = new Set()
    this.builtinSuccess = new Set()
  }

  record(entry) {
    this.entries.push({
      ...createReportRecord(entry),
      finishedAt: new Date().toISOString()
    })

    if (
      entry.mode === 'batch-canonical' ||
      entry.mode === 'desktop-assisted' ||
      entry.mode === 'interactive-canonical'
    ) {
      this.canonicalSuccess.add(entry.command)
    }
    if (entry.mode === 'interactive-alias' && entry.alias) {
      this.aliasSuccess.add(entry.alias)
    }
    if (entry.mode === 'interactive-builtin') {
      this.builtinSuccess.add(entry.command)
    }
  }

  assertCoverage() {
    const missingCanonical = this.surface.canonicalCommands.filter(
      (command) => !this.canonicalSuccess.has(command)
    )
    const missingAliases = this.surface.aliasEntries
      .map((item) => item.alias)
      .filter((alias) => !this.aliasSuccess.has(alias))
    const missingBuiltins = this.surface.builtins
      .map((item) => item.name)
      .filter((name) => !this.builtinSuccess.has(name))

    if (missingCanonical.length > 0 || missingAliases.length > 0 || missingBuiltins.length > 0) {
      throw new Error(
        [
          missingCanonical.length > 0
            ? `缺少 canonical 命令覆盖：${missingCanonical.join(', ')}`
            : '',
          missingAliases.length > 0 ? `缺少 alias 覆盖：${missingAliases.join(', ')}` : '',
          missingBuiltins.length > 0 ? `缺少 built-in 覆盖：${missingBuiltins.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      )
    }
  }

  writeSummary(extra) {
    const reportPath = path.join(this.outputDir, 'cli-release-e2e-report.json')
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          surface: {
            canonicalCount: this.surface.canonicalCommands.length,
            aliasCount: this.surface.aliasEntries.length,
            builtinCount: this.surface.builtins.length,
            desktopAssistedCount: this.surface.desktopAssistedCommands.length,
            canonicalCommands: this.surface.canonicalCommands,
            aliasEntries: this.surface.aliasEntries,
            builtins: this.surface.builtins
          },
          summary: extra,
          entries: this.entries
        },
        null,
        2
      ),
      'utf8'
    )

    const markdownPath = path.join(this.outputDir, 'cli-release-e2e-summary.md')
    const failedEntries = this.entries.filter((entry) => entry.status !== 'success')
    fs.writeFileSync(
      markdownPath,
      [
        '# CLI 发布前 E2E 摘要',
        '',
        `- canonical 命令数：${this.surface.canonicalCommands.length}`,
        `- alias 数：${this.surface.aliasEntries.length}`,
        `- built-in 数：${this.surface.builtins.length}`,
        `- 执行记录数：${this.entries.length}`,
        `- 失败记录数：${failedEntries.length}`,
        '',
        '## 失败矩阵',
        '',
        failedEntries.length === 0
          ? '- 无'
          : failedEntries
              .map(
                (entry) =>
                  `- ${entry.mode} | ${entry.entrypoint} | ${entry.command} | exit=${entry.exitCode} | ${entry.errorMessage ?? 'unknown error'}`
              )
              .join('\n'),
        ''
      ].join('\n'),
      'utf8'
    )

    return {
      reportPath,
      markdownPath
    }
  }
}

class CliReleaseHarness {
  constructor({ surface, releasePaths, outputDir }) {
    this.surface = surface
    this.releasePaths = releasePaths
    this.outputDir = outputDir
    this.coverage = new CoverageTracker(surface, outputDir)
    this.mainEnv = buildIsolatedEnvironment('main', outputDir)
    this.sequenceNo = 0
    this.commandIndex = new Map(surface.canonicalCommands.map((command, index) => [command, index]))
    this.state = {
      ledgers: {},
      users: {},
      subjects: {},
      auxiliary: {},
      cashflow: {},
      vouchers: {},
      reports: {},
      backups: {},
      archives: {},
      evouchers: {},
      print: {},
      templates: {},
      files: {}
    }
  }

  nextSequence() {
    this.sequenceNo += 1
    return this.sequenceNo
  }

  pickBatchEntrypoint(commandKey) {
    void commandKey
    return ENTRYPOINT_CMD
  }

  async runBatchCommand(commandKey, input = {}, options = {}) {
    const entrypoint = options.entrypoint ?? this.pickBatchEntrypoint(commandKey)
    const sequenceNo = this.nextSequence()
    const payloadFilePath =
      input.payload !== undefined
        ? createBatchPayloadFile(this.mainEnv, commandKey, input.payload, sequenceNo)
        : null
    const cliArgs = buildCliArgs(commandKey, input, payloadFilePath)
    const eventsCursor = getEventsCursor(this.mainEnv)
    const logPrefix = `${String(sequenceNo).padStart(3, '0')}-${sanitizeForFileName(
      `${entrypoint}-${commandKey}`
    )}`

    const execution =
      entrypoint === ENTRYPOINT_EXE
        ? await spawnBuffered(
            this.releasePaths.exePath,
            [...(options.preExeArgs ?? []), '--cli', ...cliArgs],
            {
              cwd: this.releasePaths.releaseRoot,
              env: this.mainEnv.env,
              timeoutMs: options.timeoutMs
            }
          )
        : await spawnBuffered(
            ...(() => {
              const invocation = buildCmdInvocation(this.releasePaths.batchCmdPath, cliArgs)
              return [invocation.command, invocation.args, {
                cwd: this.releasePaths.releaseRoot,
                env: this.mainEnv.env,
                timeoutMs: options.timeoutMs
              }]
            })()
          )

    const stdoutPath = path.join(this.mainEnv.logDirectory, `${logPrefix}.stdout.txt`)
    const stderrPath = path.join(this.mainEnv.logDirectory, `${logPrefix}.stderr.txt`)
    fs.writeFileSync(stdoutPath, execution.stdout, 'utf8')
    fs.writeFileSync(stderrPath, execution.stderr, 'utf8')

    const output = `${execution.stdout}\n${execution.stderr}`
    const result = extractCommandResult(output)
    const events = readEventsSince(this.mainEnv, eventsCursor)
    const artifactPaths = options.artifactPaths ?? []

    if (execution.code !== 0) {
      this.coverage.record({
        command: commandKey,
        entrypoint,
        mode: options.mode ?? 'batch-canonical',
        status: 'failed',
        exitCode: execution.code,
        artifactPaths: [stdoutPath, stderrPath, ...artifactPaths],
        eventsSeen: events.map((event) => event.action),
        errorMessage: `CLI 退出码异常：${execution.code}`
      })
      throw new Error(`命令 ${commandKey} 退出码异常：${execution.code}`)
    }

    if (result.status !== 'success') {
      this.coverage.record({
        command: commandKey,
        entrypoint,
        mode: options.mode ?? 'batch-canonical',
        status: 'failed',
        exitCode: execution.code,
        artifactPaths: [stdoutPath, stderrPath, ...artifactPaths],
        eventsSeen: events.map((event) => event.action),
        errorMessage: result.error?.message ?? 'CLI 返回 error'
      })
      throw new Error(`命令 ${commandKey} 返回失败：${result.error?.message ?? 'unknown error'}`)
    }

    if (options.assertResult) {
      await options.assertResult(result.data, events)
    }

    this.coverage.record({
      command: commandKey,
      entrypoint,
      mode: options.mode ?? 'batch-canonical',
      status: 'success',
      exitCode: execution.code,
      artifactPaths: [stdoutPath, stderrPath, ...artifactPaths],
      eventsSeen: events.map((event) => event.action)
    })

    return {
      data: result.data,
      output,
      events,
      stdoutPath,
      stderrPath
    }
  }

  async runExpectedError(commandKey, input, options = {}) {
    const entrypoint = options.entrypoint ?? ENTRYPOINT_CMD
    const sequenceNo = this.nextSequence()
    const payloadFilePath =
      input.payload !== undefined
        ? createBatchPayloadFile(this.mainEnv, `${commandKey}-expected-error`, input.payload, sequenceNo)
        : null
    const cliArgs = buildCliArgs(commandKey, input, payloadFilePath)
    const execution =
      entrypoint === ENTRYPOINT_EXE
        ? await spawnBuffered(
            this.releasePaths.exePath,
            [...(options.preExeArgs ?? []), '--cli', ...cliArgs],
            {
              cwd: this.releasePaths.releaseRoot,
              env: this.mainEnv.env,
              timeoutMs: options.timeoutMs
            }
          )
        : await spawnBuffered(
            ...(() => {
              const invocation = buildCmdInvocation(this.releasePaths.batchCmdPath, cliArgs)
              return [invocation.command, invocation.args, {
                cwd: this.releasePaths.releaseRoot,
                env: this.mainEnv.env,
                timeoutMs: options.timeoutMs
              }]
            })()
          )

    const output = `${execution.stdout}\n${execution.stderr}`
    const result = extractCommandResult(output)
    if (result.status !== 'error') {
      throw new Error(`期望 ${commandKey} 返回错误，但得到 success`)
    }
    if (options.errorCode && result.error?.code !== options.errorCode) {
      throw new Error(
        `期望 ${commandKey} 返回错误码 ${options.errorCode}，实际为 ${result.error?.code ?? 'unknown'}`
      )
    }
    return result
  }
}

CliReleaseHarness.prototype.waitForPrintReady = async function (jobId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await this.runBatchCommand(
      'print status',
      {
        flags: {
          jobId
        }
      },
      {
        mode: 'batch-canonical',
        assertResult: async () => {}
      }
    )
    if (result.data?.status === 'ready') {
      return result.data
    }
    if (result.data?.status === 'failed') {
      throw new Error(`打印任务失败：${JSON.stringify(result.data)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`打印任务 ${jobId} 未在预期时间内就绪`)
}

CliReleaseHarness.prototype.createInteractiveSession = async function () {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-Command', `& '${this.releasePaths.interactiveCmdPath.replace(/'/g, "''")}'`],
    {
      cwd: this.mainEnv.workDirectory,
      env: this.mainEnv.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  )

  let buffer = ''
  let closed = false
  let exitCode = null

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    buffer += chunk.toString()
  })
  child.on('close', (code) => {
    closed = true
    exitCode = code ?? -1
  })

  const waitForText = async (text, timeoutMs = 120_000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (buffer.includes(text)) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`等待交互输出超时：${text}\n当前输出：\n${buffer}`)
  }

  return {
    send(value) {
      child.stdin.write(value.replace(/\n/g, '\r\n'))
    },
    waitForText,
    async waitForClose(timeoutMs = 120_000) {
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        if (closed) {
          return exitCode
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(`等待 interactive shell 退出超时\n当前输出：\n${buffer}`)
    },
    dispose() {
      if (!closed) {
        child.kill('SIGKILL')
      }
    }
  }
}

CliReleaseHarness.prototype.runInteractiveWrapperSmoke = async function () {
  const session = await this.createInteractiveSession()

  try {
    await session.waitForText('dudeacc>', 30_000)
    session.send('help\n')
    await session.waitForText('DudeAcc', 30_000)
    session.send('exit\n')

    const exitCode = await session.waitForClose(30_000)
    if (exitCode !== 0) {
      throw new Error(`dudeacc.cmd 浜や簰鍚姩閫€鍑虹爜寮傚父锛?{exitCode}`)
    }

    this.coverage.record({
      command: 'interactive-session-smoke',
      entrypoint: ENTRYPOINT_INTERACTIVE,
      mode: 'interactive-smoke',
      status: 'success',
      exitCode,
      artifactPaths: [],
      eventsSeen: []
    })
  } finally {
    session.dispose()
  }
}

CliReleaseHarness.prototype.runInteractiveCoverage = async function () {
  const interactiveModule = await import(
    pathToFileURL(path.join(repoRoot, 'out', 'cli', 'cli', 'interactive.js')).href
  )
  let shellState = {
    outputMode: 'pretty'
  }
  const aliasMap = new Map(this.surface.aliasEntries.map((item) => [item.alias, item.command]))
  const builtinNames = new Set(this.surface.builtins.map((item) => item.name))

  const recordBuiltin = (name) => {
    if (!builtinNames.has(name)) {
      throw new Error(`未知 built-in：${name}`)
    }
    this.coverage.record({
      command: name,
      entrypoint: ENTRYPOINT_INTERACTIVE,
      mode: 'interactive-builtin',
      status: 'success',
      exitCode: 0,
      artifactPaths: [],
      eventsSeen: []
    })
  }

  const recordAlias = (alias) => {
    const command = aliasMap.get(alias)
    if (!command) {
      throw new Error(`未知 alias：${alias}`)
    }
    this.coverage.record({
      command,
      alias,
      entrypoint: ENTRYPOINT_INTERACTIVE,
      mode: 'interactive-alias',
      status: 'success',
      exitCode: 0,
      artifactPaths: [],
      eventsSeen: []
    })
  }

  const applyBuiltin = (line, expectedName) => {
    const resolved = interactiveModule.resolveInteractiveCommand(line)
    if (resolved.kind !== 'builtin') {
      throw new Error(`期望 ${line} 解析为 builtin`)
    }
    if (resolved.name !== expectedName) {
      throw new Error(`builtin 解析错误：${line} -> ${resolved.name}`)
    }
    const execution = interactiveModule.executeShellBuiltin(resolved.tokens, shellState)
    if (!execution.handled) {
      throw new Error(`builtin 未处理：${line}`)
    }
    shellState = execution.nextState
    recordBuiltin(expectedName)
    return execution
  }

  const executeResolvedCommand = async (line, options = {}) => {
    const resolved = interactiveModule.resolveInteractiveCommand(line)
    if (resolved.kind !== 'command') {
      throw new Error(`期望 ${line} 解析为命令`)
    }

    const applied = interactiveModule.applyInteractiveContext(resolved, shellState)
    const promptPlan = interactiveModule.getInteractivePromptPlan(applied, shellState)
    if (options.assertPromptHints) {
      const actualPromptHints = promptPlan.map((item) => item.key)
      if (JSON.stringify(actualPromptHints) !== JSON.stringify(options.assertPromptHints)) {
        throw new Error(
          `命令 ${line} 的 prompt hints 不匹配：${JSON.stringify(actualPromptHints)}`
        )
      }
    } else if (promptPlan.length > 0) {
      throw new Error(`命令 ${line} 仍需补问：${promptPlan.map((item) => item.key).join(', ')}`)
    }

    const commandKey = `${applied.domain} ${applied.action}`
    const cliArgs = [applied.domain, applied.action]
    if (applied.token) {
      cliArgs.push('--token', applied.token)
    }
    const effectivePayload = options.payloadOverride ?? applied.payload
    if (effectivePayload && typeof effectivePayload === 'object') {
      const payloadPath = createBatchPayloadFile(
        this.mainEnv,
        `interactive-${commandKey}`,
        effectivePayload,
        this.nextSequence()
      )
      cliArgs.push('--payload-file', payloadPath)
    }

    const invocation = buildCmdInvocation(this.releasePaths.batchCmdPath, cliArgs)
    const execution = await spawnBuffered(invocation.command, invocation.args, {
      cwd: this.releasePaths.releaseRoot,
      env: this.mainEnv.env,
      timeoutMs: 120_000
    })
    const result = extractCommandResult(`${execution.stdout}\n${execution.stderr}`)
    if (result.status !== 'success') {
      throw new Error(`interactive 命令失败：${line} -> ${result.error?.message ?? 'unknown'}`)
    }

    if (options.alias) {
      recordAlias(options.alias)
    } else {
      this.coverage.record({
        command: commandKey,
        entrypoint: ENTRYPOINT_INTERACTIVE,
        mode: 'interactive-canonical',
        status: 'success',
        exitCode: execution.code,
        artifactPaths: [],
        eventsSeen: []
      })
    }

    return result
  }

  try {
    applyBuiltin('help', 'help')
    applyBuiltin('mode json', 'mode')
    applyBuiltin('context', 'context')

    await executeResolvedCommand('登录', {
      alias: '登录',
      assertPromptHints: ['username', 'password'],
      payloadOverride: {
        username: 'admin',
        password: ''
      }
    })
    await executeResolvedCommand('我是谁', {
      alias: '我是谁'
    })
    await executeResolvedCommand('账套列表', {
      alias: '账套列表'
    })

    applyBuiltin(`use ledger ${this.state.ledgers.enterpriseId}`, 'use ledger')
    await executeResolvedCommand('ledger list')
    applyBuiltin('use period 2026-03', 'use period')

    await executeResolvedCommand('期间列表', {
      alias: '期间列表'
    })
    await executeResolvedCommand('凭证列表', {
      alias: '凭证列表'
    })
    await executeResolvedCommand('期间状态', {
      alias: '期间状态'
    })
    await executeResolvedCommand('报表列表', {
      alias: '报表列表'
    })
    await executeResolvedCommand('科目余额表 --startDate 2026-03-01 --endDate 2026-03-31', {
      alias: '科目余额表'
    })

    applyBuiltin('mode pretty', 'mode')
    applyBuiltin('context clear', 'context clear')
    applyBuiltin('unset period', 'unset period')
    applyBuiltin('unset ledger', 'unset ledger')
    applyBuiltin('clear', 'clear')

    await executeResolvedCommand('退出登录', {
      alias: '退出登录'
    })
    const exitExecution = applyBuiltin('exit', 'exit')
    if (exitExecution.shouldExit !== true) {
      throw new Error('interactive exit built-in 未触发 shouldExit')
    }
  } finally {
    // no-op
  }
}

CliReleaseHarness.prototype.runOpenPreviewAudit = async function (jobId) {
  const port = 9340 + Math.floor(Math.random() * 200)
  const eventsCursor = getEventsCursor(this.mainEnv)
  const child = spawn(
    this.releasePaths.exePath,
    [`--remote-debugging-port=${port}`, '--cli', 'print', 'open-preview', '--jobId', jobId],
    {
      cwd: this.releasePaths.releaseRoot,
      env: this.mainEnv.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let stdout = ''
  let stderr = ''
  let closed = false
  let exitCode = null
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.on('close', (code) => {
    closed = true
    exitCode = code ?? -1
  })

  const waitForResult = async (timeoutMs = 30_000) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      try {
        return extractCommandResult(`${stdout}\n${stderr}`)
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw new Error(`等待 print open-preview CLI 输出超时\nstdout:\n${stdout}\nstderr:\n${stderr}`)
  }

  const previewInfo = await waitForPreviewTargets(port, 120_000)
  const result = await waitForResult()
  if (!closed) {
    child.kill('SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (result.status !== 'success') {
    throw new Error(
      `print open-preview 审计失败：exit=${exitCode ?? 'running'}, status=${result.status}, stderr=${stderr}`
    )
  }

  const events = readEventsSince(this.mainEnv, eventsCursor)
  const eventNames = events.map((event) => event.action)
  if (
    !eventNames.includes('print.open-preview.requested') ||
    !eventNames.includes('print.preview.window-opened')
  ) {
    throw new Error(`print open-preview 缺少预期事件：${eventNames.join(', ')}`)
  }

  this.coverage.record({
    command: 'print open-preview',
    entrypoint: ENTRYPOINT_EXE,
    mode: 'desktop-assisted',
    status: 'success',
    exitCode: exitCode ?? 0,
    artifactPaths: [],
    eventsSeen: eventNames
  })

  return previewInfo
}

CliReleaseHarness.prototype.runDesktopAssistedSuccess = async function (
  commandKey,
  input,
  expectedEventNames
) {
  const result = await this.runBatchCommand(commandKey, input, {
    entrypoint: ENTRYPOINT_EXE,
    mode: 'desktop-assisted',
    assertResult: async (_data, events) => {
      const eventNames = events.map((event) => event.action)
      for (const expectedName of expectedEventNames) {
        if (!eventNames.includes(expectedName)) {
          throw new Error(`${commandKey} 缺少预期事件：${expectedName}`)
        }
      }
    }
  })
  return result.data
}

CliReleaseHarness.prototype.populateSubjectTemplateWorkbook = async function (filePath) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const templateSheet = workbook.getWorksheet('一级科目模板')
  if (!templateSheet) {
    throw new Error('一级科目模板工作表不存在')
  }

  templateSheet.addRow([
    '1619',
    'CLI Medical Asset',
    '资产类',
    '借',
    '否',
    '是',
    '',
    'cli release asset'
  ])
  templateSheet.addRow([
    '6608',
    'CLI Medical Cost',
    '损益类',
    '借',
    '否',
    '是',
    '4103 本年利润',
    ''
  ])
  await workbook.xlsx.writeFile(filePath)
}

CliReleaseHarness.prototype.runRestoreSuccessCoverage = async function () {
  const restoreEnv = buildIsolatedEnvironment('restore-success', this.outputDir)
  const restoreRun = async (commandKey, input = {}, options = {}) => {
    const payloadFilePath =
      input.payload !== undefined
        ? createBatchPayloadFile(restoreEnv, commandKey, input.payload, this.nextSequence())
        : null
    const cliArgs = buildCliArgs(commandKey, input, payloadFilePath)
    const invocation = buildCmdInvocation(this.releasePaths.batchCmdPath, cliArgs)
    const execution = await spawnBuffered(invocation.command, invocation.args, {
      cwd: this.releasePaths.releaseRoot,
      env: restoreEnv.env,
      timeoutMs: options.timeoutMs
    })
    const result = extractCommandResult(`${execution.stdout}\n${execution.stderr}`)
    if (execution.code !== 0 || result.status !== 'success') {
      throw new Error(
        `restore success 子环境命令失败：${commandKey} exit=${execution.code} status=${result.status}`
      )
    }
    return result.data
  }

  await restoreRun('auth login', {
    payload: {
      username: 'admin',
      password: ''
    }
  })
  const ledger = await restoreRun('ledger create', {
    payload: {
      name: `restore-fixture-${runId}`,
      standardType: 'enterprise',
      startPeriod: '2026-03'
    }
  })
  const fixture = createSystemBackupFixture({
    databasePath: restoreEnv.databasePath,
    backupDir: path.join(restoreEnv.fixtureDirectory, 'system-backup'),
    ledgerId: ledger.id,
    ledgerName: `restore-fixture-${runId}`,
    period: '2026-03',
    fiscalYear: '2026'
  })
  const eventsCursor = getEventsCursor(restoreEnv)
  const restored = await restoreRun(
    'backup restore',
    {
      payload: {
        packagePath: fixture.packageDir
      }
    },
    {
      timeoutMs: 180_000
    }
  )
  const events = readEventsSince(restoreEnv, eventsCursor)
  const eventNames = events.map((event) => event.action)
  if (
    !eventNames.includes('backup.restore.requested') ||
    !eventNames.includes('backup.restore.relaunch-requested')
  ) {
    throw new Error(`backup restore 成功路径缺少事件：${eventNames.join(', ')}`)
  }
  if (restored.restartRequired !== true) {
    throw new Error('backup restore 成功路径未返回 restartRequired=true')
  }
  this.coverage.record({
    command: 'backup restore',
    entrypoint: ENTRYPOINT_EXE,
    mode: 'desktop-assisted',
    status: 'success',
    exitCode: 0,
    artifactPaths: [fixture.packageDir, fixture.backupPath, fixture.manifestPath],
    eventsSeen: eventNames
  })
}

CliReleaseHarness.prototype.runBatchCoverage = async function () {
  seedDiagnosticRuntimeLog(this.mainEnv)
  this.state.files.wallpaperSource = path.join(
    repoRoot,
    'src',
    'renderer',
    'src',
    'assets',
    'wallpaper.png'
  )
  this.state.files.evoucherSource = path.join(this.mainEnv.fixtureDirectory, 'bank_receipt.pdf')
  fs.writeFileSync(this.state.files.evoucherSource, 'bank receipt content', 'utf8')

  await this.runBatchCommand('auth login', {
    payload: {
      username: 'admin',
      password: ''
    }
  })
  await this.runBatchCommand('auth whoami')
  await this.runBatchCommand('ledger templates')

  const enterpriseLedger = await this.runBatchCommand('ledger create', {
    payload: {
      name: `enterprise-ledger-${runId}`,
      standardType: 'enterprise',
      startPeriod: '2026-03'
    }
  })
  this.state.ledgers.enterpriseId = enterpriseLedger.data.id
  this.state.ledgers.enterpriseName = `enterprise-ledger-${runId}`

  const npoLedger = await this.runBatchCommand('ledger create', {
    payload: {
      name: `npo-ledger-${runId}`,
      standardType: 'npo',
      startPeriod: '2026-03'
    }
  })
  this.state.ledgers.npoId = npoLedger.data.id
  this.state.ledgers.npoName = `npo-ledger-${runId}`

  const templateLedger = await this.runBatchCommand('ledger create', {
    payload: {
      name: `template-ledger-${runId}`,
      standardType: 'enterprise',
      startPeriod: '2026-03'
    }
  })
  this.state.ledgers.templateId = templateLedger.data.id

  const deleteLedger = await this.runBatchCommand('ledger create', {
    payload: {
      name: `delete-ledger-${runId}`,
      standardType: 'enterprise',
      startPeriod: '2026-03'
    }
  })
  this.state.ledgers.deleteId = deleteLedger.data.id

  const periodLedger = await this.runBatchCommand('ledger create', {
    payload: {
      name: `period-ledger-${runId}`,
      standardType: 'enterprise',
      startPeriod: '2026-03'
    }
  })
  this.state.ledgers.periodId = periodLedger.data.id

  await this.runBatchCommand('ledger list')
  await this.runBatchCommand('ledger update', {
    payload: {
      id: this.state.ledgers.templateId,
      name: `template-ledger-renamed-${runId}`
    }
  })
  await this.runBatchCommand('ledger periods', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('ledger risk', {
    payload: {
      ledgerId: this.state.ledgers.deleteId
    }
  })

  const createdUser = await this.runBatchCommand('auth create-user', {
    payload: {
      username: `cliuser_${runId}`,
      realName: 'CLI User',
      password: '',
      permissions: {
        voucher_entry: true,
        audit: true,
        bookkeeping: true
      },
      ledgerIds: [this.state.ledgers.enterpriseId]
    }
  })
  this.state.users.tempUserId = createdUser.data.userId
  this.state.users.tempUsername = `cliuser_${runId}`

  await this.runBatchCommand('auth list-users')
  await this.runBatchCommand('auth update-user', {
    payload: {
      id: this.state.users.tempUserId,
      realName: 'CLI User Updated',
      password: '',
      permissions: {
        voucher_entry: true,
        audit: true,
        bookkeeping: true,
        ledger_settings: true
      },
      ledgerIds: [this.state.ledgers.enterpriseId, this.state.ledgers.npoId]
    }
  })

  await this.runBatchCommand('auth logout')
  await this.runBatchCommand('auth login', {
    payload: {
      username: this.state.users.tempUsername,
      password: ''
    }
  })
  await this.runBatchCommand('auth whoami')
  await this.runBatchCommand('auth logout')
  await this.runBatchCommand('auth login', {
    payload: {
      username: 'admin',
      password: ''
    }
  })

  await this.runBatchCommand('settings system-get')
  await this.runBatchCommand('settings system-set', {
    payload: {
      key: 'default_voucher_word',
      value: '收'
    }
  })
  await this.runBatchCommand('settings runtime-defaults-get')
  await this.runBatchCommand('settings preferences-set', {
    payload: {
      preferences: {
        cli_release_tag: runId
      }
    }
  })
  await this.runBatchCommand('settings preferences-get')
  await this.runBatchCommand('settings diagnostics-status')
  await this.runBatchCommand('settings diagnostics-export', {
    payload: {
      directoryPath: path.join(this.mainEnv.exportDirectory, 'diagnostics-export')
    }
  })
  await this.runBatchCommand('settings diagnostics-set-dir', {
    payload: {
      directoryPath: path.join(this.mainEnv.workDirectory, 'custom-diagnostics')
    }
  })
  await this.runDesktopAssistedSuccess(
    'settings diagnostics-open-dir',
    {},
    ['settings.diagnostics-open-dir.requested']
  )
  await this.runBatchCommand('settings diagnostics-reset-dir')
  await this.runBatchCommand('settings wallpaper-status')
  await this.runBatchCommand('settings wallpaper-login-status')
  await this.runBatchCommand('settings wallpaper-analyze', {
    payload: {
      sourcePath: this.state.files.wallpaperSource
    }
  })
  await this.runBatchCommand('settings wallpaper-apply', {
    payload: {
      sourcePath: this.state.files.wallpaperSource,
      useSuggestedViewport: true
    }
  })
  await this.runBatchCommand('settings wallpaper-restore')

  this.state.files.subjectTemplatePath = path.join(
    this.mainEnv.fixtureDirectory,
    'enterprise-subject-template.xlsx'
  )
  await this.runBatchCommand('settings subject-template-download', {
    payload: {
      standardType: 'enterprise',
      filePath: this.state.files.subjectTemplatePath
    }
  })
  await this.populateSubjectTemplateWorkbook(this.state.files.subjectTemplatePath)
  const parsedTemplate = await this.runBatchCommand('settings subject-template-parse-import', {
    payload: {
      standardType: 'enterprise',
      sourcePath: this.state.files.subjectTemplatePath
    }
  })
  this.state.templates.parsedEnterpriseEntries = parsedTemplate.data.entries
  await this.runBatchCommand('settings subject-template-save', {
    payload: {
      standardType: 'enterprise',
      templateName: `subject-template-save-${runId}`,
      entries: this.state.templates.parsedEnterpriseEntries
    }
  })
  await this.runBatchCommand('settings subject-template-get', {
    payload: {
      standardType: 'enterprise'
    }
  })
  await this.runBatchCommand('settings subject-template-reference', {
    payload: {
      standardType: 'enterprise'
    }
  })
  await this.runBatchCommand('settings subject-template-import', {
    payload: {
      standardType: 'enterprise',
      sourcePath: this.state.files.subjectTemplatePath
    }
  })
  await this.runBatchCommand('settings subject-template-clear', {
    payload: {
      standardType: 'enterprise'
    }
  })

  const savedCustomTemplate = await this.runBatchCommand('settings custom-template-save', {
    payload: {
      baseStandardType: 'enterprise',
      templateName: `custom-template-save-${runId}`,
      templateDescription: 'cli release save',
      entries: this.state.templates.parsedEnterpriseEntries
    }
  })
  this.state.templates.savedCustomTemplateId = savedCustomTemplate.data.template.id
  await this.runBatchCommand('settings custom-template-list')
  await this.runBatchCommand('settings custom-template-get', {
    payload: {
      templateId: this.state.templates.savedCustomTemplateId
    }
  })
  const importedCustomTemplate = await this.runBatchCommand('settings custom-template-import', {
    payload: {
      baseStandardType: 'enterprise',
      templateName: `custom-template-import-${runId}`,
      templateDescription: 'cli release import',
      sourcePath: this.state.files.subjectTemplatePath
    }
  })
  this.state.templates.importedCustomTemplateId = importedCustomTemplate.data.template.id
  await this.runBatchCommand('settings custom-template-clear-entries', {
    payload: {
      templateId: this.state.templates.importedCustomTemplateId
    }
  })
  await this.runBatchCommand('settings custom-template-delete', {
    payload: {
      templateId: this.state.templates.importedCustomTemplateId
    }
  })

  const enterpriseSubjectList = await this.runBatchCommand('subject list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  const enterpriseSubjects = enterpriseSubjectList.data
  const firstBy = (predicate) => enterpriseSubjects.find(predicate)
  const assetSubject = firstBy((row) => row.category === 'asset')
  const assetLeafSubject = firstBy(
    (row) => row.category === 'asset' && row.code !== assetSubject?.code
  )
  const nonCashflowAssetSubject = firstBy(
    (row) =>
      row.category === 'asset' &&
      Number(row.is_cash_flow) !== 1 &&
      row.code !== assetSubject?.code
  )
  const liabilitySubject = firstBy(
    (row) => row.category === 'liability' && row.code !== assetSubject?.code
  )
  const revenueSubject = firstBy(
    (row) =>
      (row.category === 'profit_loss' || row.category === 'income') &&
      Number(row.balance_direction) < 0
  )
  const expenseParentSubject = firstBy(
    (row) =>
      (row.category === 'profit_loss' || row.category === 'cost' || row.category === 'expense') &&
      Number(row.balance_direction) > 0
  )
  const expenseLeafSubject = firstBy(
    (row) =>
      (row.category === 'profit_loss' || row.category === 'cost' || row.category === 'expense') &&
      Number(row.balance_direction) > 0 &&
      row.code !== expenseParentSubject?.code
  )
  const cashFlowSubject =
    firstBy((row) => Number(row.is_cash_flow) === 1 && row.code !== assetSubject?.code) ??
    firstBy((row) => Number(row.is_cash_flow) === 1)
  if (
    !assetSubject ||
    !assetLeafSubject ||
    !nonCashflowAssetSubject ||
    !liabilitySubject ||
    !revenueSubject ||
    !expenseParentSubject ||
    !expenseLeafSubject ||
    !cashFlowSubject
  ) {
    throw new Error('无法从企业账套科目模板中解析 E2E 所需的基础科目')
  }
  this.state.subjects.assetParentCode = assetSubject.code
  this.state.subjects.assetLeafCode = assetLeafSubject.code
  this.state.subjects.nonCashflowAssetCode = nonCashflowAssetSubject.code
  this.state.subjects.liabilityCode = liabilitySubject.code
  this.state.subjects.revenueCode = revenueSubject.code
  this.state.subjects.expenseParentCode = expenseParentSubject.code
  this.state.subjects.expenseCode = expenseLeafSubject.code
  this.state.subjects.cashFlowSourceCode = cashFlowSubject.code

  const auxiliaryCreated = await this.runBatchCommand('auxiliary create', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      category: 'custom',
      code: `AUX-${runId}`,
      name: 'CLI Auxiliary'
    }
  })
  this.state.auxiliary.itemId = auxiliaryCreated.data.auxiliaryItemId
  await this.runBatchCommand('auxiliary list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('auxiliary update', {
    payload: {
      id: this.state.auxiliary.itemId,
      name: 'CLI Auxiliary Updated'
    }
  })

  const auxSubject = await this.runBatchCommand('subject create', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      parentCode: this.state.subjects.assetParentCode,
      code: `${this.state.subjects.assetParentCode}01`,
      name: 'CLI Auxiliary Subject',
      auxiliaryCategories: ['custom'],
      customAuxiliaryItemIds: [this.state.auxiliary.itemId],
      isCashFlow: false
    }
  })
  this.state.subjects.auxSubjectId = auxSubject.data.subjectId
  const deletableSubject = await this.runBatchCommand('subject create', {
      payload: {
        ledgerId: this.state.ledgers.enterpriseId,
      parentCode: this.state.subjects.expenseParentCode,
      code: `${this.state.subjects.expenseParentCode}99`,
        name: 'CLI Deletable Subject',
        auxiliaryCategories: [],
        customAuxiliaryItemIds: [],
      isCashFlow: false
    }
  })
  this.state.subjects.deletableSubjectId = deletableSubject.data.subjectId
  await this.runBatchCommand('subject list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('subject search', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      keyword: 'CLI'
    }
  })
  await this.runBatchCommand('subject update', {
    payload: {
      subjectId: this.state.subjects.deletableSubjectId,
      name: 'CLI Deletable Subject Updated'
    }
  })

  const cashflowItems = await this.runBatchCommand('cashflow items', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  this.state.cashflow.itemId = cashflowItems.data[0].id
  const existingCashflowMappings = await this.runBatchCommand('cashflow list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  const existingCashflowKeys = new Set(
    existingCashflowMappings.data.map(
      (row) => `${row.subject_code}|${row.counterpart_subject_code}|${row.entry_direction}`
    )
  )
  const createCounterpart = enterpriseSubjects.find(
    (row) =>
      row.code !== this.state.subjects.cashFlowSourceCode &&
      !existingCashflowKeys.has(
        `${this.state.subjects.cashFlowSourceCode}|${row.code}|inflow`
      )
  )
  if (!createCounterpart) {
    throw new Error('无法为 cashflow create 找到唯一可用的对方科目')
  }
  const updateCounterpart = enterpriseSubjects.find(
    (row) =>
      row.code !== this.state.subjects.cashFlowSourceCode &&
      row.code !== createCounterpart.code &&
      !existingCashflowKeys.has(
        `${this.state.subjects.cashFlowSourceCode}|${row.code}|outflow`
      )
  )
  if (!updateCounterpart) {
    throw new Error('无法为 cashflow update 找到唯一可用的对方科目')
  }
  const cashflowMapping = await this.runBatchCommand('cashflow create', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      subjectCode: this.state.subjects.cashFlowSourceCode,
      counterpartSubjectCode: createCounterpart.code,
      entryDirection: 'inflow',
      cashFlowItemId: this.state.cashflow.itemId
    }
  })
  this.state.cashflow.mappingId = cashflowMapping.data.mappingId
  await this.runBatchCommand('cashflow update', {
    payload: {
      id: this.state.cashflow.mappingId,
      subjectCode: this.state.subjects.cashFlowSourceCode,
      counterpartSubjectCode: updateCounterpart.code,
      entryDirection: 'outflow',
      cashFlowItemId: this.state.cashflow.itemId
    }
  })
  await this.runBatchCommand('cashflow delete', {
    payload: {
      id: this.state.cashflow.mappingId
    }
  })

  await this.runBatchCommand('initial-balance list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03'
    }
  })
  await this.runBatchCommand('initial-balance save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03',
      entries: []
    }
  })

  await this.runBatchCommand('voucher next-number', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03'
    }
  })

  const voucherA = await this.runBatchCommand('voucher save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      voucherDate: '2026-03-05',
      entries: [
        {
          summary: 'CLI Revenue',
          subjectCode: this.state.subjects.nonCashflowAssetCode,
          debitAmount: '5000.00',
          creditAmount: '0.00',
          cashFlowItemId: null
        },
        {
          summary: 'CLI Revenue',
          subjectCode: this.state.subjects.revenueCode,
          debitAmount: '0.00',
          creditAmount: '5000.00',
          cashFlowItemId: null
        }
      ]
    }
  })
  const voucherB = await this.runBatchCommand('voucher save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      voucherDate: '2026-03-06',
      entries: [
        {
          summary: 'CLI Expense',
          subjectCode: this.state.subjects.expenseCode,
          debitAmount: '1200.00',
          creditAmount: '0.00',
          cashFlowItemId: null
        },
        {
          summary: 'CLI Expense',
          subjectCode: this.state.subjects.liabilityCode,
          debitAmount: '0.00',
          creditAmount: '1200.00',
          cashFlowItemId: null
        }
      ]
    }
  })
  const voucherC = await this.runBatchCommand('voucher save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      voucherDate: '2026-03-07',
      entries: [
        {
          summary: 'CLI Swap A',
          subjectCode: this.state.subjects.expenseCode,
          debitAmount: '300.00',
          creditAmount: '0.00',
          cashFlowItemId: null
        },
        {
          summary: 'CLI Swap A',
          subjectCode: this.state.subjects.liabilityCode,
          debitAmount: '0.00',
          creditAmount: '300.00',
          cashFlowItemId: null
        }
      ]
    }
  })
  const voucherD = await this.runBatchCommand('voucher save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      voucherDate: '2026-03-08',
      entries: [
        {
          summary: 'CLI Swap B',
          subjectCode: this.state.subjects.expenseCode,
          debitAmount: '400.00',
          creditAmount: '0.00',
          cashFlowItemId: null
        },
        {
          summary: 'CLI Swap B',
          subjectCode: this.state.subjects.liabilityCode,
          debitAmount: '0.00',
          creditAmount: '400.00',
          cashFlowItemId: null
        }
      ]
    }
  })
  this.state.vouchers.primaryIds = [
    voucherA.data.voucherId,
    voucherB.data.voucherId,
    voucherC.data.voucherId,
    voucherD.data.voucherId
  ]

  await this.runBatchCommand('voucher list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03',
      status: 'all'
    }
  })
  await this.runBatchCommand('voucher entries', {
    payload: {
      voucherId: voucherA.data.voucherId
    }
  })
  await this.runBatchCommand('voucher update', {
    payload: {
      voucherId: voucherA.data.voucherId,
      ledgerId: this.state.ledgers.enterpriseId,
      voucherDate: '2026-03-05',
      entries: [
        {
          summary: 'CLI Revenue Updated',
          subjectCode: this.state.subjects.nonCashflowAssetCode,
          debitAmount: '6000.00',
          creditAmount: '0.00',
          cashFlowItemId: null
        },
        {
          summary: 'CLI Revenue Updated',
          subjectCode: this.state.subjects.revenueCode,
          debitAmount: '0.00',
          creditAmount: '6000.00',
          cashFlowItemId: null
        }
      ]
    }
  })
  await this.runBatchCommand('voucher swap', {
    payload: {
      voucherIds: [voucherC.data.voucherId, voucherD.data.voucherId]
    }
  })
  await this.runBatchCommand('voucher batch', {
    payload: {
      action: 'audit',
      voucherIds: this.state.vouchers.primaryIds
    }
  })
  await this.runBatchCommand('voucher batch', {
    payload: {
      action: 'bookkeep',
      voucherIds: this.state.vouchers.primaryIds
    }
  })

  const subjectBalances = await this.runBatchCommand('book subject-balances', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  })
  await this.runBatchCommand('book detail-ledger', {
      payload: {
        ledgerId: this.state.ledgers.enterpriseId,
        subjectCode: this.state.subjects.revenueCode,
        startDate: '2026-03-01',
        endDate: '2026-03-31'
      }
  })
  await this.runBatchCommand('book journal', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  })
  await this.runBatchCommand('book aux-balances', {
      payload: {
        ledgerId: this.state.ledgers.enterpriseId,
        startDate: '2026-03-01',
        endDate: '2026-03-31',
        subjectCodeStart: `${this.state.subjects.assetParentCode}01`,
        subjectCodeEnd: `${this.state.subjects.assetParentCode}01`
      }
    })
  await this.runBatchCommand('book aux-detail', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      subjectCode: `${this.state.subjects.assetParentCode}01`,
      auxiliaryItemId: this.state.auxiliary.itemId,
      startDate: '2026-03-01',
      endDate: '2026-03-31'
    }
  })

  const bookExportPath = path.join(this.mainEnv.exportDirectory, 'book-query-export.xlsx')
  await this.runBatchCommand(
    'book export',
    {
      payload: {
        ledgerId: this.state.ledgers.enterpriseId,
        bookType: 'subject-balance',
        title: 'CLI Book Export',
        subtitle: '2026-03',
        ledgerName: this.state.ledgers.enterpriseName,
        periodLabel: '2026-03',
        format: 'xlsx',
        filePath: bookExportPath,
        columns: [
          { key: 'subject_code', label: '科目编码' },
          { key: 'subject_name', label: '科目名称' },
          { key: 'ending_debit_amount', label: '期末借方', align: 'right' }
        ],
        rows: subjectBalances.data.slice(0, 5).map((row, index) => ({
          key: `row-${index + 1}`,
          cells: [
            { value: row.subject_code },
            { value: row.subject_name },
            { value: row.ending_debit_amount ?? 0, isAmount: true }
          ]
        }))
      }
    },
    {
      artifactPaths: [bookExportPath],
      assertResult: async () => {
        if (!fs.existsSync(bookExportPath)) {
          throw new Error('book export 文件未生成')
        }
      }
    }
  )

  await this.runBatchCommand('subject delete', {
    payload: {
      subjectId: this.state.subjects.deletableSubjectId
    }
  })
  await this.runBatchCommand('subject delete', {
    payload: {
      subjectId: this.state.subjects.auxSubjectId
    }
  })
  await this.runBatchCommand('auxiliary delete', {
    payload: {
      id: this.state.auxiliary.itemId
    }
  })

  const carryForwardRules = await this.runBatchCommand('carry-forward rules', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('carry-forward save', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      rules: carryForwardRules.data.map((row) => ({
        fromSubjectCode: row.fromSubjectCode,
        toSubjectCode: row.toSubjectCode
      }))
    }
  })
  await this.runBatchCommand('carry-forward preview', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03'
    }
  })
  await this.runBatchCommand('carry-forward execute', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03'
    }
  })

  await this.runBatchCommand('period status', {
    payload: {
      ledgerId: this.state.ledgers.periodId,
      period: '2026-03'
    }
  })
  await this.runBatchCommand('period close', {
    payload: {
      ledgerId: this.state.ledgers.periodId,
      period: '2026-03'
    }
  })
  await this.runBatchCommand('period reopen', {
    payload: {
      ledgerId: this.state.ledgers.periodId,
      period: '2026-03'
    }
  })

  await this.runBatchCommand('ledger apply-template', {
    payload: {
      ledgerId: this.state.ledgers.templateId,
      standardType: 'npo'
    }
  })

  const balanceSnapshot = await this.runBatchCommand('report generate', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      reportType: 'balance_sheet',
      month: '2026-03'
    }
  })
  const incomeSnapshot = await this.runBatchCommand('report generate', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      reportType: 'income_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03'
    }
  })
  const activitySnapshot = await this.runBatchCommand('report generate', {
    payload: {
      ledgerId: this.state.ledgers.npoId,
      reportType: 'activity_statement',
      startPeriod: '2026-03',
      endPeriod: '2026-03',
      includeUnpostedVouchers: true
    }
  })
  this.state.reports.balanceSnapshotId = balanceSnapshot.data.snapshot.id
  this.state.reports.incomeSnapshotId = incomeSnapshot.data.snapshot.id
  this.state.reports.activitySnapshotId = activitySnapshot.data.snapshot.id

  await this.runBatchCommand('report list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('report detail', {
    payload: {
      snapshotId: this.state.reports.balanceSnapshotId,
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  const reportExportPath = path.join(this.mainEnv.exportDirectory, 'report-export.xlsx')
  await this.runBatchCommand(
    'report export',
    {
      payload: {
        snapshotId: this.state.reports.balanceSnapshotId,
        ledgerId: this.state.ledgers.enterpriseId,
        format: 'xlsx',
        filePath: reportExportPath
      }
    },
    {
      artifactPaths: [reportExportPath],
      assertResult: async () => {
        if (!fs.existsSync(reportExportPath)) {
          throw new Error('report export 文件未生成')
        }
      }
    }
  )
  const reportBatchDirectory = path.join(this.mainEnv.exportDirectory, 'report-batch')
  await this.runBatchCommand(
    'report export-batch',
    {
      payload: {
        snapshotIds: [this.state.reports.balanceSnapshotId, this.state.reports.incomeSnapshotId],
        ledgerId: this.state.ledgers.enterpriseId,
        format: 'xlsx',
        directoryPath: reportBatchDirectory
      }
    },
    {
      artifactPaths: [reportBatchDirectory]
    }
  )
  await this.runBatchCommand('report delete', {
    payload: {
      snapshotId: this.state.reports.activitySnapshotId,
      ledgerId: this.state.ledgers.npoId
    }
  })

  const importedElectronicVoucher = await this.runBatchCommand('evoucher import', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      sourcePath: this.state.files.evoucherSource,
      sourceNumber: `EV-${runId}`,
      sourceDate: '2026-03-06',
      amountCents: 123400
    }
  })
  this.state.evouchers.recordId = importedElectronicVoucher.data.recordId
  await this.runBatchCommand('evoucher list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('evoucher parse', {
    payload: {
      recordId: this.state.evouchers.recordId,
      sourceNumber: `EV-${runId}`,
      sourceDate: '2026-03-06',
      amountCents: 123400,
      counterpartName: 'CLI Counterparty'
    }
  })
  await this.runBatchCommand('evoucher verify', {
    payload: {
      recordId: this.state.evouchers.recordId,
      verificationStatus: 'verified',
      verificationMethod: 'cli-release-e2e'
    }
  })
  await this.runBatchCommand('evoucher convert', {
    payload: {
      recordId: this.state.evouchers.recordId,
      voucherDate: '2026-03-06',
      voucherWord: '记'
    }
  })

  const backup1 = await this.runBatchCommand('backup create', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03',
      directoryPath: path.join(this.mainEnv.exportDirectory, 'backup')
    }
  })
  const backup2 = await this.runBatchCommand('backup create', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      period: '2026-03',
      directoryPath: path.join(this.mainEnv.exportDirectory, 'backup')
    }
  })
  this.state.backups.firstBackupId = backup1.data.backupId
  this.state.backups.secondBackupId = backup2.data.backupId
  this.state.backups.secondBackupPath = backup2.data.backupPath
  this.state.backups.secondBackupPackageDir = path.dirname(backup2.data.backupPath)
  await this.runBatchCommand('backup list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('backup validate', {
    payload: {
      backupId: this.state.backups.secondBackupId
    }
  })
  await this.runBatchCommand('backup import', {
    payload: {
      backupId: this.state.backups.secondBackupId
    }
  })
  await this.runBatchCommand('backup delete', {
    payload: {
      backupId: this.state.backups.firstBackupId
    }
  })
  await this.runExpectedError(
    'backup restore',
    {
      payload: {
        packagePath: this.state.backups.secondBackupPackageDir
      }
    },
    {
      errorCode: 'VALIDATION_ERROR'
    }
  )

  const archive1 = await this.runBatchCommand('archive export', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      fiscalYear: '2026',
      directoryPath: path.join(this.mainEnv.exportDirectory, 'archive')
    }
  })
  const archive2 = await this.runBatchCommand('archive export', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId,
      fiscalYear: '2026',
      directoryPath: path.join(this.mainEnv.exportDirectory, 'archive')
    }
  })
  this.state.archives.firstExportId = archive1.data.exportId
  this.state.archives.secondExportId = archive2.data.exportId
  await this.runBatchCommand('archive list', {
    payload: {
      ledgerId: this.state.ledgers.enterpriseId
    }
  })
  await this.runBatchCommand('archive validate', {
    payload: {
      exportId: this.state.archives.secondExportId
    }
  })
  await this.runBatchCommand('archive manifest', {
    payload: {
      exportId: this.state.archives.secondExportId
    }
  })
  await this.runBatchCommand('archive delete', {
    payload: {
      exportId: this.state.archives.firstExportId
    }
  })

  const printPrepare = await this.runBatchCommand('print prepare', {
    payload: {
      type: 'book',
      ledgerId: this.state.ledgers.enterpriseId,
      bookType: 'cli-release-book',
      title: 'CLI Release Print',
      periodLabel: '2026-03',
      columns: [
        { key: 'summary', label: '摘要' },
        { key: 'amount', label: '金额', align: 'right' }
      ],
      rows: [
        {
          key: 'row-1',
          cells: [
            { value: 'CLI Release Row' },
            { value: 1234.56, isAmount: true }
          ]
        }
      ]
    }
  })
  this.state.print.jobId = printPrepare.data.jobId
  await this.waitForPrintReady(this.state.print.jobId)
  await this.runBatchCommand('print model', {
    flags: {
      jobId: this.state.print.jobId
    }
  })
  await this.runBatchCommand('print update-settings', {
    payload: {
      jobId: this.state.print.jobId,
      settings: {
        scalePercent: 95,
        marginPreset: 'narrow'
      }
    }
  })
  const printPdfPath = path.join(this.mainEnv.exportDirectory, 'print-job.pdf')
  await this.runBatchCommand(
    'print export-pdf',
    {
      payload: {
        jobId: this.state.print.jobId,
        outputPath: printPdfPath
      }
    },
    {
      artifactPaths: [printPdfPath],
      assertResult: async () => {
        if (!fs.existsSync(printPdfPath)) {
          throw new Error('print export-pdf 文件未生成')
        }
      }
    }
  )
  await this.runOpenPreviewAudit(this.state.print.jobId)
  await this.runDesktopAssistedSuccess(
    'print print',
    {
      payload: {
        jobId: this.state.print.jobId,
        silent: true
      }
    },
    ['print.print.requested']
  )
  await this.runBatchCommand('print dispose', {
    flags: {
      jobId: this.state.print.jobId
    }
  })

  const auditExportPath = path.join(this.mainEnv.exportDirectory, 'audit-log.csv')
  await this.runBatchCommand('audit-log list')
  await this.runBatchCommand(
    'audit-log export',
    {
      payload: {
        filePath: auditExportPath
      }
    },
    {
      artifactPaths: [auditExportPath],
      assertResult: async () => {
        if (!fs.existsSync(auditExportPath)) {
          throw new Error('audit-log export 文件未生成')
        }
      }
    }
  )

  await this.runBatchCommand('ledger delete', {
    payload: {
      ledgerId: this.state.ledgers.deleteId,
      riskAcknowledged: true
    }
  })
  await this.runBatchCommand('auth delete-user', {
    payload: {
      userId: this.state.users.tempUserId
    }
  })
}

CliReleaseHarness.prototype.run = async function () {
  const helpCmd = await (async () => {
    const invocation = buildCmdInvocation(this.releasePaths.batchCmdPath, ['--help'])
    const execution = await spawnBuffered(invocation.command, invocation.args, {
      cwd: this.releasePaths.releaseRoot,
      env: this.mainEnv.env
    })
    return {
      execution,
      result: extractCommandResult(`${execution.stdout}\n${execution.stderr}`)
    }
  })()
  const helpCmdCommands = helpCmd.result.data.commands
  const sortCommands = (commands) => [...commands].sort((left, right) => left.localeCompare(right))
  if (
    JSON.stringify(sortCommands(helpCmdCommands)) !==
      JSON.stringify(sortCommands(this.surface.canonicalCommands))
  ) {
    throw new Error('catalog.ts 与发布态 CLI help 命令列表不一致')
  }

  this.coverage.record({
    command: '--help',
    entrypoint: ENTRYPOINT_CMD,
    mode: 'batch-help',
    status: 'success',
    exitCode: helpCmd.execution.code,
    artifactPaths: [],
    eventsSeen: []
  })
  this.coverage.record({
    command: '--help',
    entrypoint: ENTRYPOINT_INTERACTIVE,
    mode: 'interactive-smoke',
    status: 'success',
    exitCode: 0,
    artifactPaths: [],
    eventsSeen: []
  })

  await this.runInteractiveWrapperSmoke()
  await this.runBatchCoverage()
  await this.runInteractiveCoverage()
  await this.runRestoreSuccessCoverage()
  this.coverage.assertCoverage()
}

async function main() {
  const outputDir = path.join(repoRoot, 'out', 'cli-release-e2e', runId)
  ensureDir(outputDir)

  const surface = {
    ...parseCatalogSurface(),
    builtins: parseInteractiveBuiltins()
  }
  const releaseRoot = resolveReleaseRoot()
  const releasePaths = {
    releaseRoot,
    exePath: path.join(releaseRoot, 'dude-app.exe'),
    batchCmdPath: path.join(releaseRoot, 'dude-accounting.cmd'),
    interactiveCmdPath: path.join(releaseRoot, 'dudeacc.cmd')
  }

  for (const [label, filePath] of Object.entries(releasePaths)) {
    if (label === 'releaseRoot') continue
    if (!fs.existsSync(filePath)) {
      throw new Error(`发布态入口不存在：${filePath}`)
    }
  }

  const harness = new CliReleaseHarness({
    surface,
    releasePaths,
    outputDir
  })
  await harness.run()

  const summaryPaths = harness.coverage.writeSummary({
    runId,
    outputDir,
    releaseRoot
  })

  console.log(
    JSON.stringify(
      {
        status: 'success',
        runId,
        outputDir,
        reportPath: summaryPaths.reportPath,
        summaryPath: summaryPaths.markdownPath
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})

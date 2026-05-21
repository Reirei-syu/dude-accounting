import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import electronPath from 'electron'
import { extractCommandResult as extractCliCommandResult } from './cliCommandResult.mjs'

const cliArgs = process.argv.slice(2)

function getDefaultAppDataPath() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support')
  }

  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
}

function getDefaultDocumentsPath() {
  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE || os.homedir()
    return path.join(userProfile, 'Documents')
  }

  return path.join(os.homedir(), 'Documents')
}

function getElectronAppEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { stdoutTarget, stderrTarget, ...spawnOptions } = options
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: false,
      ...spawnOptions
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      if (stdoutTarget) {
        stdoutTarget.write(text)
      }
    })

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      if (stderrTarget) {
        stderrTarget.write(text)
      }
    })

    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      resolve({
        code: code ?? 0,
        stdout,
        stderr
      })
    })
  })
}

function readProcessStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve('')
  }

  return new Promise((resolve, reject) => {
    let input = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      input += chunk
    })
    process.stdin.once('error', reject)
    process.stdin.once('end', () => resolve(input))
  })
}

async function ensureBuildArtifacts() {
  const tscCliPath = path.join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
  const electronViteCliPath = path.join(
    process.cwd(),
    'node_modules',
    'electron-vite',
    'bin',
    'electron-vite.js'
  )

  const cliBuild = await run(process.execPath, [tscCliPath, '-p', 'tsconfig.cli.json'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdoutTarget: process.stdout,
    stderrTarget: process.stderr
  })
  if (cliBuild.code !== 0) {
    process.exit(cliBuild.code)
  }

  const electronBuild = await run(process.execPath, [electronViteCliPath, 'build'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdoutTarget: process.stdout,
    stderrTarget: process.stderr
  })
  if (electronBuild.code !== 0) {
    process.exit(electronBuild.code)
  }
}

function shouldUseInteractiveShell() {
  if (cliArgs.length > 0) {
    return false
  }

  return Boolean(
    process.env.DUDEACC_CLI_FORCE_INTERACTIVE === '1' ||
      (process.stdin.isTTY && process.stdout.isTTY)
  )
}

async function executeBatchCommand(invocation) {
  const args = ['.', '--cli', invocation.domain, invocation.action]

  if (invocation.token) {
    args.push('--token', invocation.token)
  }

  const payload = invocation.payload && typeof invocation.payload === 'object' ? invocation.payload : {}
  if (Object.keys(payload).length > 0) {
    args.push('--payload-json', JSON.stringify(payload))
  }

  const result = await run(electronPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: getElectronAppEnv()
  })

  if (result.code !== 0 && !result.stdout && !result.stderr) {
    throw new Error(`CLI 子命令执行失败，退出码 ${result.code}`)
  }

  return extractCliCommandResult(`${result.stdout}\n${result.stderr}`)
}

async function runInteractiveShell() {
  const interactiveModulePath = pathToFileURL(
    path.join(process.cwd(), 'out', 'cli', 'cli', 'interactive.js')
  ).href
  const interactiveModule = await import(interactiveModulePath)
  const runtime = {
    productName: 'dude-app',
    appDataPath: getDefaultAppDataPath(),
    documentsPath: getDefaultDocumentsPath(),
    userDataPath: path.join(getDefaultAppDataPath(), 'dude-app-dev'),
    executablePath: electronPath,
    isDevelopment: true,
    isPackaged: false
  }

  const exitCode = await interactiveModule.runInteractiveCli(runtime, {
    executeCommand: async (_runtime, invocation) => await executeBatchCommand(invocation)
  })
  process.exit(exitCode)
}

async function runBatchMode() {
  const shouldForwardStdin = cliArgs.includes('--payload-stdin')
  const env = shouldForwardStdin
    ? {
        ...process.env,
        DUDEACC_PAYLOAD_STDIN_JSON: await readProcessStdin()
      }
    : process.env
  const result = await run(electronPath, ['.', '--cli', ...cliArgs], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: getElectronAppEnv(env)
  })
  process.exit(result.code)
}

async function main() {
  if (process.env.DUDEACC_SKIP_BUILD !== '1') {
    await ensureBuildArtifacts()
  }

  if (shouldUseInteractiveShell()) {
    await runInteractiveShell()
    return
  }

  await runBatchMode()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

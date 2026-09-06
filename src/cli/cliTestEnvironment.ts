import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function stopCliTestProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  // Windows kill() 只终止包装器；/T 同时终止其 Electron/host 后代。
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10_000
      })
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) throw error
    }
  } else {
    // runCliTestCommand 在 POSIX 上启动独立进程组。
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

export async function waitCliTestExit(
  child: ChildProcess,
  timeoutMs = 10_000
): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode
  return new Promise((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void stopCliTestProcess(child).then(() => reject(new Error('CLI 测试进程退出超时')), reject)
    }, timeoutMs)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error('CLI 测试进程退出超时'))
      else resolve(code)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

export async function runCliTestCommand(
  tempRoot: string,
  appDataPath: string,
  args: string[],
  input?: string
): Promise<{ stdout: string; stderr: string }> {
  const env = getCliTestEnv(tempRoot, appDataPath)
  return new Promise((resolve, reject) => {
    let failure: Error | null = null
    let stdout = ''
    let stderr = ''
    const child = spawn('node', ['scripts/run-cli.mjs', ...args], {
      cwd: process.cwd(),
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const collect = (chunk: string, isError: boolean): void => {
      if (failure) return
      if (isError) stderr += chunk
      else stdout += chunk
      if (stdout.length + stderr.length > 20 * 1024 * 1024) {
        failure = new Error('CLI 测试输出超过限制')
        void stopCliTestProcess(child).catch(reject)
      }
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, false))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => collect(chunk, true))
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (failure || code !== 0) {
        reject(
          Object.assign(failure ?? new Error(`CLI 退出码 ${String(code)}`), { stdout, stderr })
        )
      } else resolve({ stdout, stderr })
    })
    const timer = setTimeout(() => {
      failure = new Error('CLI 测试命令超时')
      void stopCliTestProcess(child).catch(reject)
    }, 60_000)
    child.stdin?.end(input)
  })
}

// 仅供集成测试使用；必须是 mkdtemp 创建且真实落在临时目录下的独立根目录。
export function assertCliTestPath(tempRoot: string, appDataPath: string): void {
  const root = fs.realpathSync(tempRoot)
  const temporaryDirectory = fs.realpathSync(os.tmpdir())
  const relativeRoot = path.relative(temporaryDirectory, root)
  const data = fs.realpathSync(appDataPath)
  if (
    !relativeRoot ||
    relativeRoot.startsWith('..') ||
    path.isAbsolute(relativeRoot) ||
    !path.basename(root).startsWith('dude-') ||
    data !== path.join(root, 'AppData', 'Roaming')
  ) {
    throw new Error('CLI 测试数据目录必须位于独立临时根目录内')
  }
}

export function getCliTestEnv(tempRoot: string, appDataPath: string): NodeJS.ProcessEnv {
  assertCliTestPath(tempRoot, appDataPath)
  if (process.env.DUDEACC_TEST_BUILD_READY !== '1') {
    throw new Error('请通过 npm test 启动集成测试，以保证共享产物只构建一次')
  }
  return {
    ...process.env,
    APPDATA: appDataPath,
    XDG_CONFIG_HOME: appDataPath,
    DUDEACC_E2E_APPDATA_PATH: appDataPath,
    DUDEACC_SKIP_BUILD: '1'
  }
}

export function assertCliTestDatabase(appDataPath: string): void {
  if (!fs.existsSync(path.join(appDataPath, 'dude-app-dev', 'dude-accounting.db'))) {
    throw new Error('CLI 未在预期的隔离目录创建数据库')
  }
}

export function cleanupCliTestRoot(tempRoot: string, appDataPath: string): void {
  assertCliTestPath(tempRoot, appDataPath)
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

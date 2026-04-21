import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const wrapperTemplatePath = path.join(process.cwd(), 'build', 'cli', 'dudeacc.cmd')
const hostExePath = path.join(process.cwd(), 'build', 'cli', 'dudeacc-host.exe')
const electronExePath = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe')
const installedInteractiveEntryPath = path.join(
  process.cwd(),
  'out',
  'cli',
  'cli',
  'installedInteractiveShellEntry.js'
)

const tempRoots = new Set<string>()

function sleepSync(timeoutMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs)
}

function removeDirWithRetry(targetPath: string): void {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      sleepSync(200)
    }
  }

  throw lastError
}

function waitForText(getBuffer: () => string, text: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setInterval(() => {
      if (getBuffer().includes(text)) {
        clearInterval(timer)
        resolve()
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer)
        reject(new Error(`等待输出超时: ${text}\n当前输出:\n${getBuffer()}`))
      }
    }, 100)
  })
}

beforeAll(() => {
  execFileSync('cmd.exe', ['/d', '/c', 'npm.cmd run build:cli'], {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 120_000
  })
  execFileSync('cmd.exe', ['/d', '/c', 'npm.cmd run build:cli-host:win'], {
    cwd: process.cwd(),
    windowsHide: true,
    timeout: 240_000
  })
})

afterEach(() => {
  for (const tempRoot of tempRoots) {
    removeDirWithRetry(tempRoot)
    tempRoots.delete(tempRoot)
  }
})

describe('installed dudeacc shell wrapper', () => {
  it(
    'keeps the interactive shell alive when invoked through powershell and the cmd wrapper',
    async () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dudeacc-installed-shell-'))
      tempRoots.add(tempRoot)

      const wrapperPath = path.join(tempRoot, 'dudeacc.cmd')
      const copiedHostExePath = path.join(tempRoot, 'dudeacc-host.exe')
      const appDataPath = path.join(tempRoot, 'AppData', 'Roaming')
      const workDir = path.join(tempRoot, 'work')
      fs.mkdirSync(appDataPath, { recursive: true })
      fs.mkdirSync(workDir, { recursive: true })

      const wrapperTemplate = fs.readFileSync(wrapperTemplatePath, 'utf8')
      fs.copyFileSync(hostExePath, copiedHostExePath)
      fs.writeFileSync(wrapperPath, wrapperTemplate, 'utf8')

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Command', `& '${wrapperPath.replace(/'/g, "''")}'`],
        {
          cwd: workDir,
          env: {
            ...process.env,
            APPDATA: appDataPath,
            DUDEACC_HOST_APP_EXE_PATH: electronExePath,
            DUDEACC_HOST_INTERACTIVE_ENTRY_PATH: installedInteractiveEntryPath
          },
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )

      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })

      try {
        await waitForText(() => output, 'dudeacc>', 15_000)
        expect(child.exitCode).toBeNull()

        child.stdin.write('help\n')
        await waitForText(() => output, 'DudeAcc 交互式 CLI', 15_000)
        expect(child.exitCode).toBeNull()

        child.stdin.write('exit\n')
        child.stdin.end()

        const exitCode = await new Promise<number>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', (code) => resolve(code ?? -1))
        })

        expect(exitCode).toBe(0)
        expect(output).toContain('dudeacc>')
        expect(output).toContain('DudeAcc 交互式 CLI')
      } finally {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL')
        }
      }
    },
    30_000
  )
})

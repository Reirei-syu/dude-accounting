import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanupCliTestRoot,
  getCliTestEnv,
  stopCliTestProcess,
  waitCliTestExit
} from './cliTestEnvironment'

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

describe('dev cli entry script', () => {
  it('supports interactive shell through scripts/run-cli.mjs', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-cli-interactive-'))
    const appDataPath = path.join(tempRoot, 'AppData', 'Roaming')
    fs.mkdirSync(appDataPath, { recursive: true })
    const child = spawn('node', ['scripts/run-cli.mjs'], {
      cwd: process.cwd(),
      env: {
        ...getCliTestEnv(tempRoot, appDataPath),
        DUDEACC_CLI_FORCE_INTERACTIVE: '1'
      },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })

    try {
      await waitForText(() => output, 'dudeacc>', 15_000)
      expect(output).toContain('账号：')
      expect(output).toContain('账套：未选择 | 会计期间：未选择')
      child.stdin.write('help\n')
      await waitForText(() => output, 'DudeAcc 交互式 CLI', 15_000)
      child.stdin.write('exit\n')
      child.stdin.end()

      const exitCode = await waitCliTestExit(child)

      expect(exitCode).toBe(0)
      expect(output).toContain('dudeacc>')
      expect(output).toContain('DudeAcc 交互式 CLI')
    } finally {
      await stopCliTestProcess(child)
      cleanupCliTestRoot(tempRoot, appDataPath)
    }
  }, 60_000)
})

import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

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
  it(
    'supports interactive shell through scripts/run-cli.mjs',
    async () => {
      const child = spawn('node', ['scripts/run-cli.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DUDEACC_CLI_FORCE_INTERACTIVE: '1'
        },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let output = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        output += chunk.toString()
      })

      await waitForText(() => output, 'dudeacc>', 120_000)
      child.stdin.write('help\n')
      await waitForText(() => output, 'DudeAcc 交互式 CLI', 30_000)
      child.stdin.write('exit\n')
      child.stdin.end()

      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => resolve(code ?? -1))
      })

      expect(exitCode).toBe(0)
      expect(output).toContain('dudeacc>')
      expect(output).toContain('DudeAcc 交互式 CLI')
    },
    180_000
  )
})

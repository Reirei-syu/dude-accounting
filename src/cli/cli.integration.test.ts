import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const loginPayloadPath = path.join(os.tmpdir(), 'dude-cli-login-payload.json')

function extractCommandResult(output: string): { status: string; data: unknown; error: unknown } {
  const statusIndex = output.lastIndexOf('"status"')
  if (statusIndex < 0) {
    throw new Error(`未找到 CLI JSON 输出：\n${output}`)
  }

  const startIndex = output.lastIndexOf('{', statusIndex)
  if (startIndex < 0) {
    throw new Error(`未找到 CLI JSON 起始位置：\n${output}`)
  }

  let depth = 0
  for (let index = startIndex; index < output.length; index += 1) {
    const current = output[index]
    if (current === '{') depth += 1
    if (current === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(output.slice(startIndex, index + 1)) as {
          status: string
          data: unknown
          error: unknown
        }
      }
    }
  }

  throw new Error(`CLI JSON 输出不完整：\n${output}`)
}

async function runCli(args: string[]): Promise<{ status: string; data: unknown; error: unknown }> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    ['scripts/run-with-utf8.mjs', 'npx', 'electron-vite', 'preview', '--', '--cli', ...args],
    {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  )

  return extractCommandResult(`${stdout}\n${stderr}`)
}

describe('embedded cli integration', () => {
  afterAll(() => {
    if (fs.existsSync(loginPayloadPath)) {
      fs.rmSync(loginPayloadPath, { force: true })
    }
  })

  it(
    'prints command registry in help mode',
    async () => {
      const result = await runCli(['--help'])
      expect(result.status).toBe('success')
      expect(result.data).toMatchObject({
        product: 'dude-accounting'
      })
    },
    120_000
  )

  it(
    'supports login and whoami through persisted cli session',
    async () => {
      fs.writeFileSync(loginPayloadPath, JSON.stringify({ username: 'admin', password: '' }), 'utf8')

      const loginResult = await runCli(['auth', 'login', '--payload-file', loginPayloadPath])
      expect(loginResult.status).toBe('success')
      expect(loginResult.data).toMatchObject({
        user: {
          username: 'admin',
          isAdmin: true
        }
      })

      const whoamiResult = await runCli(['auth', 'whoami'])
      expect(whoamiResult.status).toBe('success')
      expect(whoamiResult.data).toMatchObject({
        actor: {
          username: 'admin',
          isAdmin: true
        }
      })
    },
    120_000
  )
})

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { extractCommandResult } from './cliCommandResult.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const electron = require('electron')

describe('真实 Electron 嵌入式 CLI 退出码与完整输出', () => {
  it('成功为0，未登录为3，参数错误为2，长帮助JSON不截断', () => {
    const base = path.join(root, '.tmp/embedded-cli-exit-tests')
    fs.mkdirSync(base, { recursive: true })
    const isolated = fs.mkdtempSync(path.join(base, 'run-'))
    const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: isolated }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    function call(args, expectedCode, expectedStatus) {
      const result = spawnSync(electron, [root, '--cli', ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status, result.stderr).toBe(expectedCode)
      const payload = extractCommandResult(`${result.stdout}\n${result.stderr}`)
      expect(payload.status).toBe(expectedStatus)
      return payload
    }
    expect(call(['auth', 'whoami'], 3, 'error').error.code).toBe('UNAUTHORIZED')
    call(
      ['auth', 'login', '--payload-json', JSON.stringify({ username: 'admin', password: '' })],
      0,
      'success'
    )
    expect(
      call(
        ['voucher', 'batch', '--payload-json', JSON.stringify({ action: 'audit', voucherIds: [] })],
        2,
        'error'
      ).error.code
    ).toBe('VALIDATION_ERROR')
    const help = call(['--help', '--all'], 0, 'success')
    expect(JSON.stringify(help.data).length).toBeGreaterThan(10_000)
  }, 60_000)
})

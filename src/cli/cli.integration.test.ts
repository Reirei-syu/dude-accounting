import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-cli-login-'))
const appDataPath = path.join(tempRoot, 'AppData', 'Roaming')
const loginPayloadPath = path.join(tempRoot, 'dude-cli-login-payload.json')
const ledgerCreatePayloadPath = path.join(tempRoot, 'dude-cli-ledger-create.json')
const voucherAliasPayloadPath = path.join(tempRoot, 'dude-cli-voucher-alias.json')
fs.mkdirSync(appDataPath, { recursive: true })

function extractCommandResult(output: string): { status: string; data: unknown; error: unknown } {
  const matches: Array<{ status: string; data: unknown; error: unknown }> = []

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
            const parsed = JSON.parse(output.slice(startIndex, index + 1)) as {
              status?: unknown
              data?: unknown
              error?: unknown
            }

            if (
              typeof parsed.status === 'string' &&
              Object.prototype.hasOwnProperty.call(parsed, 'data') &&
              Object.prototype.hasOwnProperty.call(parsed, 'error')
            ) {
              matches.push(parsed as { status: string; data: unknown; error: unknown })
            }
          } catch {
            // ignore invalid json slices
          }
          break
        }
      }
    }
  }

  if (matches.length > 0) {
    return matches[matches.length - 1]
  }

  throw new Error(`未找到 CLI JSON 输出：\n${output}`)
}

async function runCli(args: string[]): Promise<{ status: string; data: unknown; error: unknown }> {
  const { stdout, stderr } = await execFileAsync(
    'node',
    ['scripts/run-cli.mjs', ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APPDATA: appDataPath
      },
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }
  )

  return extractCommandResult(`${stdout}\n${stderr}`)
}

describe('embedded cli integration', () => {
  afterAll(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
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
    'prints full command catalog in help all mode',
    async () => {
      const result = await runCli(['--help', '--all'])
      expect(result.status).toBe('success')
      expect(result.data).toMatchObject({
        product: 'dude-accounting',
        builtinCommands: expect.arrayContaining([
          expect.objectContaining({
            name: 'help'
          })
        ]),
        domains: expect.arrayContaining(['auth', 'ledger', 'print']),
        allCommands: expect.arrayContaining([
          expect.objectContaining({
            command: 'auth create-user',
            aliasZh: '创建用户'
          }),
          expect.objectContaining({
            command: 'print open-preview',
            headlessAlternatives: ['print export-html']
          }),
          expect.objectContaining({
            command: 'backup restore',
            desktopAssisted: false
          })
        ])
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

  it(
    'accepts agent-style voucher payload aliases through the batch cli',
    async () => {
      fs.writeFileSync(loginPayloadPath, JSON.stringify({ username: 'admin', password: '' }), 'utf8')
      const loginResult = await runCli(['auth', 'login', '--payload-file', loginPayloadPath])
      expect(loginResult.status).toBe('success')

      fs.writeFileSync(
        ledgerCreatePayloadPath,
        JSON.stringify({
          name: `CLI 凭证别名测试 ${Date.now()}`,
          standardType: 'npo',
          startPeriod: '2026-01'
        }),
        'utf8'
      )

      const createLedgerResult = await runCli([
        'ledger',
        'create',
        '--payload-file',
        ledgerCreatePayloadPath
      ])
      expect(createLedgerResult.status).toBe('success')
      const ledgerId = (createLedgerResult.data as { id: number }).id

      const subjectSearchResult = await runCli([
        'subject',
        'search',
        '--ledgerId',
        String(ledgerId),
        '--keyword',
        '1002'
      ])
      expect(subjectSearchResult.status).toBe('success')
      expect(subjectSearchResult.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: '1002'
          })
        ])
      )

      fs.writeFileSync(
        voucherAliasPayloadPath,
        JSON.stringify({
          ledgerId,
          period: '2026-01',
          date: '2026-01-03',
          number: 1,
          description: '收到客户付款活动款（张三）',
          entries: [
            {
              subjectCode: 1002,
              debit: 3000,
              credit: 0,
              cashflowItemCode: 'CF01',
              auxiliaries: []
            },
            {
              subjectCode: '2206',
              debit: 0,
              credit: 20,
              auxiliaries: []
            },
            {
              subjectCode: '430101',
              debit: 0,
              credit: 2980,
              auxiliaries: []
            }
          ]
        }),
        'utf8'
      )

      const saveResult = await runCli([
        'voucher',
        'save',
        '--payload-file',
        voucherAliasPayloadPath
      ])
      expect(saveResult.status).toBe('success')

      const voucherId = (saveResult.data as { voucherId: number }).voucherId
      const entriesResult = await runCli(['voucher', 'entries', '--voucherId', String(voucherId)])
      expect(entriesResult.status).toBe('success')
      expect(entriesResult.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subject_code: '1002',
            cash_flow_code: 'CF01'
          }),
          expect.objectContaining({
            subject_code: '2206',
            credit_amount: 2000
          }),
          expect.objectContaining({
            subject_code: '430101',
            credit_amount: 298000
          })
        ])
      )
    },
    120_000
  )
})

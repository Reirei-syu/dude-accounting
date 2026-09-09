import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { extractCommandResult } from './cliCommandResult.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const playwrightRoot = execFileSync(
  'py',
  ['-3', '-c', 'import playwright; print(playwright.__path__[0])'],
  {
    encoding: 'utf8',
    windowsHide: true
  }
).trim()
const { _electron: electron } = require(path.join(playwrightRoot, 'driver/package'))
const base = path.join(root, '.tmp/emergency-reversal-app-smoke')
fs.mkdirSync(base, { recursive: true })
const output = fs.mkdtempSync(path.join(base, 'run-'))
const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: path.join(output, 'appdata') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const executablePath = path.join(root, 'node_modules/electron/dist/electron.exe')
function cli(domain, action, payload = {}) {
  const result = spawnSync(
    executablePath,
    [root, '--cli', domain, action, '--payload-json', JSON.stringify(payload)],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000
    }
  )
  if (result.error) throw result.error
  return extractCommandResult(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}
const application = await electron.launch({ executablePath, args: [root], cwd: root, env })
try {
  const page = await application.firstWindow()
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.api.auth.login('admin', ''))).success, true)
  const ledger = await page.evaluate(() =>
    window.api.ledger.create({
      name: '紧急逆转隔离验收',
      standardType: 'npo',
      startPeriod: '2026-09'
    })
  )
  assert.equal(ledger.success, true, JSON.stringify(ledger))
  const user = await page.evaluate(
    (ledgerId) =>
      window.api.auth.createUser({
        username: 'operator',
        realName: '隔离普通用户',
        password: 'Smoke123!',
        permissions: { voucher_entry: true, audit: true, bookkeeping: true, unbookkeep: true },
        ledgerIds: [ledgerId]
      }),
    ledger.id
  )
  assert.equal(user.success, true, JSON.stringify(user))
  const saved = await page.evaluate(
    (ledgerId) =>
      window.api.voucher.save({
        ledgerId,
        voucherDate: '2026-09-01',
        entries: [
          {
            summary: '逆转权限验证',
            subjectCode: '1001',
            debitAmount: '1.00',
            creditAmount: '0.00'
          },
          {
            summary: '逆转权限验证',
            subjectCode: '1002',
            debitAmount: '0.00',
            creditAmount: '1.00'
          }
        ]
      }),
    ledger.id
  )
  assert.equal(saved.success, true, JSON.stringify(saved))
  const rows = await page.evaluate((ledgerId) => window.api.voucher.list({ ledgerId }), ledger.id)
  const voucherIds = [rows[0].id]
  for (const action of ['audit', 'bookkeep']) {
    const result = await page.evaluate((payload) => window.api.voucher.batchAction(payload), {
      action,
      voucherIds
    })
    assert.equal(result.success, true, JSON.stringify(result))
  }
  await page.evaluate(() => window.api.auth.logout())
  assert.equal(
    (await page.evaluate(() => window.api.auth.login('operator', 'Smoke123!'))).success,
    true
  )
  const payload = {
    action: 'unbookkeep',
    voucherIds,
    reason: '隔离验收',
    approvalTag: 'APPROVED-SMOKE'
  }
  const denied = await page.evaluate((input) => window.api.voucher.batchAction(input), payload)
  assert.equal(denied.success, false)
  assert.equal(denied.errorCode, 'FORBIDDEN')
  assert.equal(
    cli('auth', 'login', { username: 'operator', password: 'Smoke123!' }).status,
    'success'
  )
  assert.equal(cli('voucher', 'batch', payload).error?.code, 'FORBIDDEN')
  assert.equal(cli('voucher', 'list', { ledgerId: ledger.id }).data[0].status, 2)
  assert.equal(cli('auth', 'login', { username: 'admin', password: '' }).status, 'success')
  const initialLogs = cli('audit-log', 'list', { module: 'voucher' }).data
  assert.equal(initialLogs.filter((row) => row.action === 'unbookkeep').length, 0)
  for (const invalid of [{ reason: '' }, { approvalTag: '' }]) {
    assert.equal(cli('voucher', 'batch', { ...payload, ...invalid }).status, 'error')
  }
  assert.equal(cli('voucher', 'list', { ledgerId: ledger.id }).data[0].status, 2)
  const reversed = cli('voucher', 'batch', payload)
  assert.equal(reversed.status, 'success', JSON.stringify(reversed))
  assert.equal(reversed.data.processedCount, 1)
  const guiRows = await page.evaluate(
    (ledgerId) => window.api.voucher.list({ ledgerId }),
    ledger.id
  )
  assert.equal(guiRows[0].status, 1)
  const logs = cli('audit-log', 'list', { module: 'voucher' }).data.filter(
    (row) => row.action === 'unbookkeep'
  )
  assert.equal(logs.length, 1)
  assert.equal(logs[0].username, 'admin')
  const report = {
    success: true,
    output,
    checks: [
      '真实IPC拒绝旧权限普通用户',
      '真实CLI拒绝旧权限普通用户',
      '拒绝后已记账状态保持',
      '管理员必填原因和审批',
      '管理员成功逆转仅一条留痕',
      'GUI与CLI同源状态'
    ]
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await application.close()
}

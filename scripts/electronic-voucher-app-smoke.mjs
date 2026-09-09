import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { extractCommandResult } from './cliCommandResult.mjs'

const root = process.cwd()
const require = createRequire(import.meta.url)
const playwrightRoot = execFileSync(
  'py',
  ['-3', '-c', 'import playwright; print(playwright.__path__[0])'],
  { encoding: 'utf8', windowsHide: true }
).trim()
const { _electron: electron } = require(path.join(playwrightRoot, 'driver/package'))
const base = path.join(root, '.tmp/electronic-voucher-app-smoke')
fs.mkdirSync(base, { recursive: true })
const output = fs.mkdtempSync(path.join(base, 'run-'))
const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: path.join(output, 'appdata') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const executablePath = path.join(root, 'node_modules/electron/dist/electron.exe')
const cli = (domain, action, payload = {}) => {
  const result = spawnSync(
    executablePath,
    [root, '--cli', domain, action, '--payload-json', JSON.stringify(payload)],
    { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 }
  )
  if (result.error) throw result.error
  return extractCommandResult(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}
const application = await electron.launch({ executablePath, args: [root], cwd: root, env })
try {
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  const pdf = await application.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ show: false })
    try {
      await window.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent('<h1>Isolated Receipt</h1><p>SMOKE-1 2026-09-02 CNY 12.34</p>')
      )
      return (await window.webContents.printToPDF({})).toString('base64')
    } finally {
      window.destroy()
    }
  })
  const sourcePath = path.join(output, 'receipt.pdf')
  fs.writeFileSync(sourcePath, Buffer.from(pdf, 'base64'))
  assert.equal((await page.evaluate(() => window.api.auth.login('admin', ''))).success, true)
  const ledger = await page.evaluate(() =>
    window.api.ledger.create({
      name: '电子凭证隔离 smoke',
      standardType: 'npo',
      startPeriod: '2026-09'
    })
  )
  assert.equal(ledger.success, true, JSON.stringify(ledger))
  await page.getByPlaceholder('请输入账号').fill('admin')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '账务处理', exact: true }).click()
  await page.getByRole('button', { name: '电子凭证', exact: true }).click()
  await page.getByLabel('原件绝对路径').fill(sourcePath)
  await page.getByRole('button', { name: '接收原件', exact: true }).click()
  await page.getByRole('button', { name: 'receipt.pdf', exact: true }).click()
  await page.getByRole('button', { name: '检查原件完整性（不代表验真）', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '完整性检查已留痕' }).waitFor()
  const list = await page.evaluate((id) => window.api.eVoucher.list(id), ledger.id)
  const recordId = list[0].id
  assert.equal(list[0].status, 'imported')
  assert.equal(
    await page
      .getByRole('button', { name: '打开凭证预填（待复核保存）', exact: true })
      .isDisabled(),
    true
  )
  assert.equal(cli('auth', 'login', { username: 'admin', password: '' }).status, 'success')
  assert.equal(cli('evoucher', 'convert', { recordId }).status, 'error')
  assert.equal(cli('evoucher', 'list', { ledgerId: ledger.id }).data[0].id, recordId)
  await page.getByLabel('人工核验依据', { exact: true }).fill('隔离测试 PDF 已人工核对，非自动验真')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '记录人工核验通过', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '人工核验申请已处理' }).waitFor()
  await page.getByLabel('来源号码', { exact: true }).fill('SMOKE-1')
  await page.getByLabel('来源日期', { exact: true }).fill('2026-09-02')
  await page.getByLabel('金额（元）', { exact: true }).fill('12.34')
  await page.getByRole('button', { name: '保存摘录并检查重复', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '结构化复核已保存' }).waitFor()
  await page.screenshot({ path: path.join(output, 'reviewed.png') })
  await page.getByRole('button', { name: '打开凭证预填（待复核保存）', exact: true }).click()
  const active = () => page.locator('[role="tabpanel"][aria-hidden="false"]')
  await active().getByLabel('voucher-row-summary', { exact: true }).first().fill('旧版本未保存分录')
  await page
    .getByRole('tab')
    .filter({ has: page.getByText('电子凭证', { exact: true }) })
    .click()
  await page.getByLabel('来源号码', { exact: true }).fill('SMOKE-2')
  await page.getByRole('button', { name: '保存摘录并检查重复', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '结构化复核已保存' }).waitFor()
  await page.getByRole('button', { name: '打开凭证预填（待复核保存）', exact: true }).click()
  await active().getByLabel('voucher-row-summary', { exact: true }).first().waitFor()
  assert.equal(
    await active().getByLabel('voucher-row-summary', { exact: true }).first().inputValue(),
    'SMOKE-2'
  )
  const oldTab = page
    .getByRole('tab')
    .filter({ hasText: `电子凭证 #${recordId} 预填` })
    .first()
  const newTab = page
    .getByRole('tab')
    .filter({ hasText: `电子凭证 #${recordId} 预填` })
    .last()
  assert.equal(
    await page
      .getByRole('tab')
      .filter({ hasText: `电子凭证 #${recordId} 预填` })
      .count(),
    2
  )
  await oldTab.click()
  assert.equal(
    await active().getByLabel('voucher-row-summary', { exact: true }).first().inputValue(),
    '旧版本未保存分录'
  )
  await newTab.click()
  for (const [index, code] of ['1001', '1002'].entries()) {
    const input = active().getByLabel('voucher-row-subject', { exact: true }).nth(index)
    await input.fill(code)
    await input.press('Enter')
    await page.waitForFunction(
      () => document.activeElement.getAttribute('aria-label') === 'voucher-row-debit'
    )
  }
  await active().getByLabel('voucher-row-debit', { exact: true }).first().fill('12.34')
  await active().getByLabel('voucher-row-credit', { exact: true }).nth(1).press('=')
  await page.screenshot({ path: path.join(output, 'prefill.png') })
  await active().getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[role="tabpanel"][aria-hidden="false"] [aria-label="voucher-row-summary"]'
      ).value === ''
  )
  const after = cli('evoucher', 'list', { ledgerId: ledger.id }).data[0]
  assert.equal(after.status, 'converted')
  assert.ok(after.linked_voucher_id)
  const vouchers = cli('voucher', 'list', { ledgerId: ledger.id, period: '2026-09' }).data
  assert.equal(vouchers.length, 1)
  assert.equal(vouchers[0].voucher_date, '2026-09-02')
  assert.equal(cli('evoucher', 'convert', { recordId }).status, 'error')
  assert.ok(
    cli('audit-log', 'list', { status: 'failed', module: 'electronic_voucher' }).data.some(
      (row) => row.action === 'convert_failed'
    )
  )
  const mountPath = `/mnt/${sourcePath[0].toLowerCase()}${sourcePath.slice(2).replaceAll('\\', '/')}`
  assert.equal(
    cli('evoucher', 'import', {
      ledgerId: ledger.id,
      sourcePath: mountPath,
      operationId: crypto.randomUUID()
    }).status,
    'error'
  )
  assert.equal(cli('evoucher', 'list', { ledgerId: ledger.id }).data.length, 1)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      success: true,
      output,
      checks: [
        '真实PDF原件接收',
        '默认不假验真与待核验门禁',
        '人工核验与摘录复核',
        '来源版本更新保留旧分录并打开新版预填',
        '真实录入保存与原子关联',
        'GUI/CLI同库查询',
        'WSL重复原件拦截',
        '失败审计状态可查询'
      ]
    })
  )
} finally {
  await application.close()
}

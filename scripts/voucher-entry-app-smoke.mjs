import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const require = createRequire(import.meta.url)
const playwrightRoot = execFileSync(
  'py',
  ['-3', '-c', 'import playwright; print(playwright.__path__[0])'],
  { encoding: 'utf8', windowsHide: true }
).trim()
const { _electron: electron } = require(path.join(playwrightRoot, 'driver/package'))
const outputRoot = path.join(root, '.tmp/voucher-entry-app-smoke')
fs.mkdirSync(outputRoot, { recursive: true })
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: path.join(output, 'appdata') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const application = await electron.launch({
  executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
  args: [root],
  cwd: root,
  env
})
try {
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.api.auth.login('admin', ''))).success, true)
  const created = await page.evaluate(() =>
    window.api.ledger.create({
      name: '凭证录入隔离 smoke',
      standardType: 'npo',
      startPeriod: '2026-09'
    })
  )
  assert.equal(created.success, true, JSON.stringify(created))
  await page.getByPlaceholder('请输入账号').fill('admin')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '账务处理', exact: true }).click()
  await page.getByRole('button', { name: '凭证录入', exact: true }).click()
  const summaries = page.getByLabel('voucher-row-summary', { exact: true })
  await summaries.first().fill('真实接口录入 smoke')
  for (const [index, code] of ['1001', '1002'].entries()) {
    const input = page.getByLabel('voucher-row-subject', { exact: true }).nth(index)
    await input.fill(code)
    await input.press('Enter')
    await page.waitForFunction(
      () => document.activeElement.getAttribute('aria-label') === 'voucher-row-debit'
    )
  }
  await page.getByLabel('voucher-row-debit', { exact: true }).first().fill('12.34')
  await page.getByLabel('voucher-row-credit', { exact: true }).nth(1).press('=')
  await page.screenshot({ path: path.join(output, 'before-save.png') })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="voucher-row-summary"]').value === ''
  )
  const result = await page.evaluate(async () => {
    const ledgers = await window.api.ledger.getAll()
    const vouchers = await window.api.voucher.list({ ledgerId: ledgers[0].id, period: '2026-09' })
    const entries = vouchers.length ? await window.api.voucher.getEntries(vouchers[0].id) : []
    return { ledgers, vouchers, entries }
  })
  assert.equal(result.vouchers.length, 1)
  assert.equal(result.entries.length, 2)
  assert.equal(result.entries[0].debit_amount, 1234)
  assert.equal(result.entries[1].credit_amount, 1234)
  assert.equal(result.vouchers[0].status, 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(output, 'after-save.png') })
  console.log(
    JSON.stringify({
      success: true,
      output,
      voucherId: result.vouchers[0].id,
      checks: [
        '真实登录',
        'GUI 录入和快捷键',
        'preload/IPC 保存',
        'SQLite 查询同分金额',
        '未审核草稿状态',
        '保存后新建'
      ]
    })
  )
} finally {
  await application.close()
}

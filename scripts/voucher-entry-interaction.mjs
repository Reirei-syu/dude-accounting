import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = process.cwd()
const require = createRequire(import.meta.url)
const playwrightRoot = execFileSync(
  'py',
  ['-3', '-c', 'import playwright; print(playwright.__path__[0])'],
  { encoding: 'utf8', windowsHide: true }
).trim()
const { _electron: electron } = require(path.join(playwrightRoot, 'driver/package'))
const server = await createServer({
  configFile: false,
  root,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 0,
    watch: { ignored: ['**/.tmp/**', '**/out/**', '**/docs/**'] }
  }
})
await server.listen()
const outputRoot = path.join(root, '.tmp/voucher-entry-interaction')
fs.mkdirSync(outputRoot, { recursive: true })
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
const env = {
  ...process.env,
  VOUCHER_FIXTURE_URL: `${server.resolvedUrls.local[0]}scripts/voucher-entry-fixture.html`
}
delete env.ELECTRON_RUN_AS_NODE
let application
try {
  application = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [
      path.join(root, 'scripts/voucher-entry-fixture.cjs'),
      `--user-data-dir=${path.join(output, 'appdata')}`
    ],
    env
  })
  const page = await application.firstWindow()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const summaries = page.getByLabel('voucher-row-summary', { exact: true })
  await summaries.first().waitFor()
  assert.equal(await summaries.count(), 4)
  assert.equal(await page.locator('#voucher-date-input').inputValue(), '2026-09-01')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('至少需要两条有效分录', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 0)
  await summaries.nth(0).fill('交互回归')
  await summaries.nth(0).press('Enter')
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'voucher-row-subject'
  )
  for (const [index, code] of ['1001', '1002'].entries()) {
    await page.getByLabel('voucher-row-subject', { exact: true }).nth(index).fill(code)
    await page
      .getByRole('button', { name: new RegExp(code) })
      .first()
      .click()
    await page.waitForFunction(
      () => document.activeElement.getAttribute('aria-label') === 'voucher-row-debit'
    )
  }
  await page.getByLabel('voucher-row-debit', { exact: true }).nth(0).fill('1.234')
  assert.equal(await page.getByLabel('voucher-row-debit', { exact: true }).nth(0).inputValue(), '')
  await page.getByLabel('voucher-row-debit', { exact: true }).nth(0).fill('12.34')
  await page.getByLabel('voucher-row-credit', { exact: true }).nth(1).press('=')
  assert.equal(
    await page.getByLabel('voucher-row-credit', { exact: true }).nth(1).inputValue(),
    '12.34'
  )
  await page.evaluate(() => window.fixture.failSave(true))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('隔离测试保存失败', { exact: true }).waitFor()
  assert.equal(await summaries.nth(0).inputValue(), '交互回归')
  const payload = await page.evaluate(() => window.fixture.calls[0])
  assert.equal(payload.ledgerId, 1)
  assert.equal(payload.entries.length, 2)
  assert.equal(payload.entries[0].debitAmount, '12.34')
  await page.screenshot({ path: path.join(output, 'entry.png') })
  await page.evaluate(() => window.fixture.failSave(false))
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="voucher-row-summary"]').value === ''
  )
  assert.equal(await page.evaluate(() => window.fixture.calls.length), 2)
  await summaries.nth(0).fill('账套 A 草稿')
  await page.evaluate(() => window.fixture.switchPeriod('2026-10'))
  await page.waitForFunction(
    () => document.querySelector('#voucher-date-input').value === '2026-10-01'
  )
  assert.equal(await summaries.first().inputValue(), '账套 A 草稿', '同账套切期间保留既有草稿语义')
  await page.evaluate(() => window.fixture.switchPeriod('2026-09'))
  await page.waitForFunction(
    () => document.querySelector('#voucher-date-input').value === '2026-09-01'
  )
  await page.evaluate(() => window.fixture.switchLedger(2))
  await page.getByText('单位：测试账套2', { exact: true }).waitFor()
  assert.equal(await summaries.nth(0).inputValue(), '', '切账套不得沿用旧草稿')
  await page.evaluate(() => {
    window.fixture.setVouchers(
      [10, 11].map((id) => ({
        id,
        period: '2026-09',
        voucher_date: '2026-09-02',
        voucher_number: id,
        voucher_word: '记',
        status: id === 10 ? 0 : 2
      }))
    )
    window.fixture.render({ editVoucherId: 10, editRequestKey: 1 })
  })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="voucher-row-summary"]').value === '凭证10'
  )
  assert.equal(await summaries.first().isDisabled(), true, '已保存凭证默认查看')
  await page.getByRole('button', { name: '修改', exact: true }).click()
  assert.equal(await summaries.first().isEnabled(), true)
  await page.getByRole('button', { name: '现金流量分配', exact: true }).click()
  const toggles = page.getByLabel('cashflow-allocation-row-toggle', { exact: true })
  await toggles.first().check()
  await page
    .getByLabel('cashflow-allocation-item-select', { exact: true })
    .first()
    .selectOption('1')
  await page.getByRole('button', { name: '确认分配', exact: true }).click()
  await page.getByText('已分配现金流', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('[aria-label="voucher-row-summary"]').disabled
  )
  assert.equal(await page.evaluate(() => window.fixture.calls.at(-1).entries[0].cashFlowItemId), 1)
  await page.evaluate(() => window.fixture.render({ editVoucherId: 11, editRequestKey: 2 }))
  await page.waitForFunction(
    () => document.querySelector('[aria-label="voucher-row-summary"]').value === '凭证11'
  )
  assert.equal(await page.getByRole('button', { name: '修改', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true)

  // 同一页面连续加载，后发先至；旧结果不得把已记账只读页变回草稿。
  await page.evaluate(() => {
    window.fixture.setDeferredEntries(true)
    window.fixture.render({ editVoucherId: 10, editRequestKey: 3 })
  })
  await page.waitForFunction(() => window.fixture.pendingEntries.has(10))
  await page.evaluate(() => window.fixture.render({ editVoucherId: 11, editRequestKey: 4 }))
  await page.waitForFunction(() => window.fixture.pendingEntries.has(11))
  await page.evaluate(() => window.fixture.pendingEntries.get(11)())
  await page.waitForFunction(() => !document.querySelector('button[title="打印当前凭证"]').disabled)
  await page.evaluate(() => window.fixture.pendingEntries.get(10)())
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.equal(await summaries.first().inputValue(), '凭证11')
  assert.equal(await page.getByRole('button', { name: '修改', exact: true }).isDisabled(), true)

  // 直接调用同一轮的真实 controller 回调，证明同步锁，而非依靠按钮重渲染。
  await page.evaluate(() => {
    window.fixture.setDeferredEntries(false)
    window.fixture.setVouchers([])
    window.fixture.probe()
  })
  await page.waitForFunction(() => window.fixtureController)
  await page.evaluate(() =>
    window.fixtureController.setRows(
      window.fixtureController.rows.map((row, index) =>
        index < 2
          ? {
              ...row,
              summary: '并发测试',
              subjectCode: index === 0 ? '1001' : '1002',
              debit: index === 0 ? '12.34' : '',
              credit: index === 1 ? '12.34' : ''
            }
          : row
      )
    )
  )
  await page.waitForFunction(() => window.fixtureController.balanced)
  const beforeConcurrent = await page.evaluate(() => window.fixture.calls.length)
  await page.evaluate(() => {
    window.fixture.failSave(true)
    window.fixture.setDeferredSave(true)
    const save = window.fixtureController.handleSave
    window.fixtureSavePromise = Promise.all([save(), save()])
  })
  await page.waitForFunction(() => window.fixture.pendingSaves.length === 1)
  assert.equal(await page.evaluate(() => window.fixture.calls.length), beforeConcurrent + 1)
  await page.evaluate(() => window.fixture.pendingSaves.shift()())
  await page.evaluate(() => window.fixtureSavePromise)
  await page.waitForFunction(() => !window.fixtureController.saving)
  assert.equal(await page.evaluate(() => window.fixtureController.rows[0].summary), '并发测试')
  await page.evaluate(() => {
    window.fixtureSavePromise = window.fixtureController.handleSave()
  })
  await page.waitForFunction(() => window.fixture.pendingSaves.length === 1)
  assert.equal(
    await page.evaluate(() => window.fixture.calls.length),
    beforeConcurrent + 2,
    '失败后允许重试'
  )
  await page.evaluate(() => {
    window.fixture.switchPeriod('2026-10')
    window.fixture.failSave(false)
  })
  await page.waitForFunction(() => window.fixtureController.date === '2026-10-01')
  await page.evaluate(() => window.fixture.pendingSaves.shift()())
  await page.evaluate(() => window.fixtureSavePromise)
  await page.waitForFunction(() => !window.fixtureController.saving)
  assert.equal(
    await page.evaluate(() => window.fixtureController.date),
    '2026-10-01',
    '旧保存不能把日期退回九月'
  )
  assert.equal(
    await page.evaluate(() => window.fixtureController.rows[0].summary),
    '并发测试',
    '切期间不清空草稿'
  )
  await page.evaluate(() => {
    window.fixtureSavePromise = window.fixtureController.handleSave()
  })
  await page.waitForFunction(() => window.fixture.pendingSaves.length === 1)
  await page.evaluate(() => {
    window.fixture.unmount()
    window.fixture.failSave(false)
  })
  await page.getByText('controller 隔离测试', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => {
    window.fixture.switchLedger(3)
    window.fixture.render()
  })
  await summaries.first().fill('新账套独立草稿')
  await page.evaluate(() => window.fixture.pendingSaves.shift()())
  await page.evaluate(() => window.fixtureSavePromise)
  assert.equal(await summaries.first().inputValue(), '新账套独立草稿', '旧保存完成不得清空新上下文')
  await page.getByLabel('voucher-row-credit', { exact: true }).nth(3).press('Enter')
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-label="voucher-row-summary"]').length === 5
  )
  await page.waitForFunction(
    () =>
      document.activeElement === document.querySelectorAll('[aria-label="voucher-row-summary"]')[4]
  )
  await page.evaluate(() => {
    window.fixture.setClosed(true)
    window.fixture.switchLedger(4)
  })
  await page.getByText('闭账只读', { exact: true }).waitFor()
  assert.equal(await summaries.first().isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  assert.deepEqual(pageErrors, [])
  await page.evaluate(() => {
    window.fixture.setClosed(false)
    window.fixture.setDeferredSave(false)
    window.fixture.failSave(false)
    window.fixture.switchLedger(5)
    window.fixtureNumbers = []
    window.api.voucher.getNextNumber = () =>
      new Promise((resolve) => window.fixtureNumbers.push(resolve))
    delete window.fixtureController
    window.fixture.probe()
  })
  await page.waitForFunction(() => window.fixtureController && window.fixtureNumbers.length >= 2)
  await page.evaluate(() =>
    window.fixtureController.setRows(
      window.fixtureController.rows.map((row, index) =>
        index < 2
          ? {
              ...row,
              summary: '凭证号竞态',
              subjectCode: index === 0 ? '1001' : '1002',
              debit: index === 0 ? '1.00' : '',
              credit: index === 1 ? '1.00' : ''
            }
          : row
      )
    )
  )
  await page.waitForFunction(() => window.fixtureController.balanced)
  const oldNumberRequests = await page.evaluate(() => window.fixtureNumbers.length)
  await page.evaluate(() => {
    window.fixtureSavePromise = window.fixtureController.handleSave()
  })
  await page.waitForFunction((count) => window.fixtureNumbers.length > count, oldNumberRequests)
  await page.evaluate(() => window.fixtureNumbers.at(-1)(2))
  await page.evaluate(() => window.fixtureSavePromise)
  await page.waitForFunction(() => window.fixtureController.voucherNumber === 2)
  await page.evaluate(
    (count) => window.fixtureNumbers.slice(0, count).forEach((resolve) => resolve(1)),
    oldNumberRequests
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  assert.equal(
    await page.evaluate(() => window.fixtureController.voucherNumber),
    2,
    '旧凭证号响应不能覆盖新号'
  )
  console.log(
    JSON.stringify({
      success: true,
      output,
      checks: [
        '默认行和日期',
        'Enter 焦点',
        '末级科目选择',
        '等号平衡',
        '保存失败保留草稿',
        '金额和账套 payload',
        '保存成功清空',
        '空凭证拒写',
        '三位小数拒收',
        '切账套清空旧草稿',
        '编辑保存及现金流分配',
        '已记账只读',
        '倒序加载隔离',
        '同轮双保存单请求',
        '失败可重试',
        '卸载后旧保存不污染新草稿',
        '末行 Enter 扩行和焦点',
        '闭账只读',
        '无渲染异常',
        '凭证号倒序响应隔离',
        '同账套切期间保留草稿',
        '保存挂起切期间不回退日期'
      ]
    })
  )
} finally {
  await application?.close()
  await server.close()
}

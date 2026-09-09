import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { extractCommandResult } from './cliCommandResult.mjs'

const root = process.cwd()
const require = createRequire(import.meta.url)
const playwrightRoot = execFileSync(
  'py',
  ['-3', '-c', 'import playwright; print(playwright.__path__[0])'],
  { encoding: 'utf8', windowsHide: true }
).trim()
const { _electron: electron } = require(path.join(playwrightRoot, 'driver/package'))
const base = path.join(root, '.tmp/home-app-smoke')
fs.mkdirSync(base, { recursive: true })
const output = fs.mkdtempSync(path.join(base, 'run-'))
const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: path.join(output, 'appdata') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const executablePath = path.join(root, 'node_modules/electron/dist/electron.exe')
const cli = (domain, action, payload = {}) =>
  extractCommandResult(
    execFileSync(
      executablePath,
      [root, '--cli', domain, action, '--payload-json', JSON.stringify(payload)],
      { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 }
    )
  )
const application = await electron.launch({ executablePath, args: [root], cwd: root, env })
const checks = []
try {
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const login = async (username = 'admin', password = '') => {
    await page.getByPlaceholder('请输入账号').fill(username)
    if (password) await page.getByPlaceholder('请输入密码').fill(password)
    await page.getByRole('button', { name: '登录', exact: true }).click()
  }
  const logout = () => page.getByRole('button', { name: /退出登录/ }).click()
  const home = page.getByRole('main', { name: '账套首页' })
  const tab = (title) =>
    page.getByRole('tab').filter({ has: page.getByText(title, { exact: true }) })
  const homeNav = page
    .getByRole('navigation', { name: '功能模块' })
    .getByRole('button', { name: '首页', exact: true })
  const month = (period) => home.getByRole('article', { name: `${period} 月度概览`, exact: true })
  const waitMonth = async (period, count, status = '未结账') => {
    await month(period).getByText(status, { exact: true }).waitFor()
    await page.waitForFunction(
      ({ period, count }) =>
        document.querySelector(
          `article[aria-label="${period} 月度概览"] .home-voucher-count strong`
        )?.textContent === String(count),
      { period, count }
    )
  }

  await login()
  await home.getByText(/请先选择账套/).waitFor()
  checks.push('无账套默认首页与空状态')
  const seeded = await page.evaluate(async () => {
    const ok = (value) => {
      if (!value.success) throw new Error(JSON.stringify(value))
      return value
    }
    const a = ok(
      await window.api.ledger.create({
        name: '首页测试 · 民非账套',
        standardType: 'npo',
        startPeriod: '2025-03'
      })
    )
    const b = ok(
      await window.api.ledger.create({
        name: '首页测试 · 企业账套',
        standardType: 'enterprise',
        startPeriod: '2026-01'
      })
    )
    ok(await window.api.settings.setSystemParam('allow_same_maker_auditor', '1'))
    const payload = {
      ledgerId: a.id,
      voucherDate: '2025-03-06',
      entries: [
        {
          summary: '首页统计验证',
          subjectCode: '1001',
          debitAmount: '12.34',
          creditAmount: '',
          cashFlowItemId: null
        },
        {
          summary: '首页统计验证',
          subjectCode: '1002',
          debitAmount: '',
          creditAmount: '12.34',
          cashFlowItemId: null
        }
      ]
    }
    const vouchers = []
    for (let index = 0; index < 4; index++)
      vouchers.push(ok(await window.api.voucher.save(payload)).voucherId)
    ok(
      await window.api.voucher.batchAction({
        action: 'audit',
        voucherIds: [vouchers[1], vouchers[2]]
      })
    )
    ok(await window.api.voucher.batchAction({ action: 'bookkeep', voucherIds: [vouchers[2]] }))
    ok(await window.api.voucher.batchAction({ action: 'delete', voucherIds: [vouchers[3]] }))
    ok(await window.api.settings.setUserPreferences({ default_ledger_id: String(a.id) }))
    ok(
      await window.api.auth.createUser({
        username: 'home-reader',
        realName: '首页只读用户',
        password: 'HomeSmoke9!',
        permissions: {},
        ledgerIds: [a.id]
      })
    )
    return { a, b, payload }
  })
  await logout()
  await login()
  await waitMonth('2025-03', 3)
  await waitMonth('2025-01', 0, '未启用')
  assert.equal(await home.locator('article').count(), 12)
  const navNames = await page
    .getByRole('navigation', { name: '功能模块' })
    .getByRole('button')
    .allTextContents()
  assert.deepEqual(navNames.slice(0, 2), ['首页', '账套设置'])
  await homeNav.click()
  assert.equal(await tab('首页').count(), 1)
  await home.getByRole('button', { name: '下一年', exact: true }).click()
  await waitMonth('2026-03', 0)
  assert.equal(await page.getByLabel('选择会计期间').inputValue(), '2025-03')
  await home.getByRole('button', { name: '当前账期年', exact: true }).click()
  await waitMonth('2025-03', 3)
  checks.push('导航排序与复用、12个月、年中启用、全部有效张数、切年不改变账期')

  for (const title of ['凭证录入', '凭证查询', '科目余额表', '报表查询']) {
    await home.getByRole('button', { name: title, exact: true }).click()
    assert.equal(await tab(title).getAttribute('aria-selected'), 'true')
    if (title === '凭证录入')
      await page
        .getByLabel('voucher-row-summary', { exact: true })
        .first()
        .fill('首页返回测试，尚未保存')
    await homeNav.click()
    await waitMonth('2025-03', 3)
  }
  assert.equal(cli('auth', 'login', { username: 'admin', password: '' }).status, 'success')
  assert.equal(cli('voucher', 'save', seeded.payload).status, 'success')
  await home.getByRole('button', { name: '刷新', exact: true }).click()
  await waitMonth('2025-03', 4)
  assert.equal(cli('voucher', 'list', { ledgerId: seeded.a.id, period: '2025-03' }).data.length, 4)
  checks.push('四个真实快捷入口、未保存草稿不计数、CLI写入与GUI汇总同源')

  const overview = cli('ledger', 'overview', { ledgerId: seeded.a.id, year: 2025 })
  assert.equal(overview.status, 'success')
  assert.deepEqual(
    overview.data,
    await page.evaluate(
      (ledgerId) => window.api.ledger.getYearOverview({ ledgerId, year: 2025 }),
      seeded.a.id
    )
  )
  const aliasOverview = extractCommandResult(
    execFileSync(
      executablePath,
      [root, '--cli', '账套年度概览', '--ledgerId', String(seeded.a.id), '--year', '2025'],
      { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 }
    )
  )
  assert.deepEqual(aliasOverview, overview)
  checks.push('年度概览CLI canonical与中文别名、IPC结果完全一致')

  await home.getByRole('button', { name: '凭证查询', exact: true }).click()
  const closed = await page.evaluate(
    (ledgerId) => window.api.period.close({ ledgerId, period: '2025-03' }),
    seeded.a.id
  )
  assert.equal(closed.success, true, JSON.stringify(closed))
  await homeNav.click()
  await waitMonth('2025-03', 4, '已结账')
  const reopened = await page.evaluate(
    (ledgerId) => window.api.period.reopen({ ledgerId, period: '2025-03' }),
    seeded.a.id
  )
  assert.equal(reopened.success, true, JSON.stringify(reopened))
  await home.getByRole('button', { name: '刷新', exact: true }).click()
  await waitMonth('2025-03', 4)
  checks.push('结账返回刷新、反结账手动刷新')

  // 只对测试窗口下一次请求注入延迟；其他请求仍经过真实 IPC 处理器。
  const stale = await page.evaluate(
    (ledgerId) => window.api.ledger.getYearOverview({ ledgerId, year: 2025 }),
    seeded.a.id
  )
  const holdNextOverview = () =>
    application.evaluate(({ BrowserWindow }, value) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      let markStarted
      const started = new Promise((resolve) => {
        markStarted = resolve
      })
      globalThis.homeSmoke = { started }
      wc.ipc.handleOnce('ledger:getYearOverview', () => {
        markStarted()
        return new Promise((resolve) => {
          globalThis.homeSmoke.release = () => resolve(value)
        })
      })
    }, stale)
  const releaseOverview = async () => {
    await application.evaluate(() => globalThis.homeSmoke.release())
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
  }
  await holdNextOverview()
  await home.getByRole('button', { name: '刷新', exact: true }).click()
  await application.evaluate(() => globalThis.homeSmoke.started)
  await page.getByLabel('选择账套').selectOption(String(seeded.b.id))
  await waitMonth('2026-01', 0)
  await releaseOverview()
  assert.equal(
    await home.getByRole('heading', { name: '首页测试 · 企业账套', exact: true }).count(),
    1
  )
  assert.equal(await home.locator('article[aria-label^="2025-"]').count(), 0)
  await page.getByLabel('选择账套').selectOption(String(seeded.a.id))
  await waitMonth('2025-03', 4)
  await holdNextOverview()
  await home.getByRole('button', { name: '刷新', exact: true }).click()
  await application.evaluate(() => globalThis.homeSmoke.started)
  await home.getByRole('button', { name: '下一年', exact: true }).click()
  await waitMonth('2026-03', 0)
  await releaseOverview()
  assert.equal(await home.locator('article[aria-label^="2025-"]').count(), 0)
  await home.getByRole('button', { name: '当前账期年', exact: true }).click()
  await waitMonth('2025-03', 4)
  checks.push('真实窗口延迟IPC：旧账套与旧年份响应均被丢弃')

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.ipc.handleOnce('ledger:getYearOverview', () => {
      throw new Error('首页读取故障测试')
    })
  })
  await home.getByRole('button', { name: '刷新', exact: true }).click()
  await home
    .getByRole('alert')
    .getByText(/首页读取故障测试/)
    .waitFor()
  assert.equal(await home.locator('article').count(), 0)
  await home.getByRole('button', { name: '重试', exact: true }).click()
  await waitMonth('2025-03', 4)
  checks.push('读取失败不显示假零，重试恢复真实数据')

  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 1040)
  )
  await page.screenshot({ path: path.join(output, 'home-wide.png') })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 800)
  )
  await page.screenshot({ path: path.join(output, 'home-narrow.png') })
  await month('2025-12').scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'home-narrow-months.png') })
  assert.equal(await home.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true)
  checks.push('宽窄窗口无横向溢出及截图')

  await page.getByRole('button', { name: '我的偏好', exact: true }).click()
  assert.equal(await page.getByRole('option', { name: '首页', exact: true }).count(), 1)
  assert.equal(
    (
      await page.evaluate(() =>
        window.api.settings.setUserPreferences({ default_home_tab: 'voucher-query' })
      )
    ).success,
    true
  )
  await logout()
  await login()
  await tab('凭证查询').waitFor()
  assert.equal(await tab('首页').count(), 0)
  await logout()
  await login('home-reader', 'HomeSmoke9!')
  await waitMonth('2025-03', 4)
  assert.equal(await home.getByRole('button', { name: '凭证录入', exact: true }).isDisabled(), true)
  assert.equal(
    await page
      .getByRole('navigation', { name: '功能模块' })
      .getByRole('button', { name: '账套设置', exact: true })
      .count(),
    0
  )
  assert.equal(
    await page.evaluate(async (ledgerId) => {
      try {
        await window.api.ledger.getYearOverview({ ledgerId, year: 2026 })
        return false
      } catch {
        return true
      }
    }, seeded.b.id),
    true
  )
  checks.push('已有启动偏好保留、普通用户首页可读且无录入权限、越权IPC拒绝')
  assert.deepEqual(errors, [])
  fs.writeFileSync(
    path.join(output, 'result.json'),
    JSON.stringify({ success: true, output, checks }, null, 2)
  )
  console.log(JSON.stringify({ success: true, output, checks }))
} finally {
  await application.close()
}

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
const base = path.join(root, '.tmp/audit-log-app-smoke')
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
try {
  const page = await application.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.api.auth.login('admin', ''))).success, true)
  const ledger = await page.evaluate(() =>
    window.api.ledger.create({
      name: '操作日志隔离 smoke',
      standardType: 'npo',
      startPeriod: '2026-09'
    })
  )
  assert.equal(ledger.success, true, JSON.stringify(ledger))
  await page.evaluate(async (id) => {
    for (let i = 0; i < 55; i++) {
      const result = await window.api.ledger.update({ id, name: `PRIVATE_BEFORE_AFTER_${i}` })
      if (!result.success) throw new Error(result.error)
    }
    await window.api.ledger.update({ id, name: '操作日志隔离 smoke' })
  }, ledger.id)
  assert.equal(
    (
      await page.evaluate(
        (id) =>
          window.api.auth.createUser({
            username: 'audit-smoke',
            realName: '隔离账号',
            password: 'SmokeOnly9!',
            permissions: { system_settings: true },
            ledgerIds: [id]
          }),
        ledger.id
      )
    ).success,
    true
  )
  const users = await page.evaluate(() => window.api.auth.getUsers())
  const otherId = users.find((user) => user.username === 'audit-smoke').id
  assert.equal(
    (await page.evaluate((id) => window.api.auth.updateUser({ id, isAdmin: true }), otherId))
      .success,
    true
  )
  await page.getByPlaceholder('请输入账号').fill('admin')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  await page.getByRole('button', { name: '操作日志', exact: true }).click()
  await page.getByLabel('操作日志页面').waitFor()
  await page.getByLabel('模块', { exact: true }).fill('ledger')
  await page.getByLabel('动作类型', { exact: true }).fill('update')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.getByText('第 1 页 · 本页 50 条', { exact: false }).waitFor()
  assert.equal(
    await page.getByRole('table', { name: '操作日志列表' }).locator('tbody tr').count(),
    50
  )
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByText('第 2 页 · 本页 6 条', { exact: false }).waitFor()
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await page.getByText('第 1 页 · 本页 50 条', { exact: false }).waitFor()
  assert.equal(cli('auth', 'login', { username: 'admin', password: '' }).status, 'success')
  const filters = { ledgerId: ledger.id, module: 'ledger', action: 'update', limit: 50 }
  const cliRows = cli('audit-log', 'list', filters)
  const guiRows = await page.evaluate((filters) => window.api.auditLog.list(filters), filters)
  assert.equal(cliRows.status, 'success')
  assert.deepEqual(cliRows.data, guiRows)
  assert.equal(JSON.stringify(guiRows).includes('PRIVATE_BEFORE_AFTER'), false)
  const csvPath = path.join(output, 'current-page.csv')
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, csvPath)
  await page.getByRole('button', { name: '导出当前页 CSV', exact: true }).click()
  await page.getByText('已导出当前筛选页 50 条，导出动作已留痕。', { exact: true }).waitFor()
  assert.equal(fs.readFileSync(csvPath, 'utf8').includes('PRIVATE_BEFORE_AFTER'), false)
  const exportLogs = await page.evaluate(() =>
    window.api.auditLog.list({ module: 'audit_log', action: 'export' })
  )
  assert.ok(exportLogs.length >= 1)
  await page.screenshot({ path: path.join(output, 'audit-log.png') })
  await page.getByLabel('operationId', { exact: true }).fill('not-found')
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.getByText('暂无符合条件的操作日志', { exact: true }).waitFor()
  await page.getByLabel('operationId', { exact: true }).fill('')
  assert.equal(
    cli('auth', 'login', { username: 'audit-smoke', password: 'SmokeOnly9!' }).status,
    'success'
  )
  assert.equal(
    cli('auth', 'update-user', {
      id: users.find((user) => user.username === 'admin').id,
      isAdmin: false
    }).status,
    'success'
  )
  await page.getByRole('button', { name: '查询', exact: true }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('[role="status"]')
      ?.textContent?.includes('登录态已失效或无权访问，请重新登录')
  )
  const denied = await page.evaluate(async () => {
    let listDenied = false
    try {
      await window.api.auditLog.list()
    } catch {
      listDenied = true
    }
    return { listDenied, exported: await window.api.auditLog.export() }
  })
  assert.equal(denied.listDenied, true)
  assert.equal(denied.exported.success, false)
  await page.getByRole('button', { name: /退出登录/ }).click()
  await page.getByPlaceholder('请输入账号').fill('admin')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  // 仍具备系统设置功能权限，也不能看到管理员专属审计入口。
  await page.getByRole('button', { name: '系统设置', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '操作日志', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify({
      success: true,
      output,
      checks: [
        '真实GUI导航与分页',
        '56条筛选与空结果',
        'GUI/CLI同库同筛选',
        '受控CSV文件与导出留痕',
        '敏感详情隐藏',
        '权限实时撤销与直接IPC拦截',
        '普通用户隐藏入口'
      ]
    })
  )
} finally {
  await application.close()
}

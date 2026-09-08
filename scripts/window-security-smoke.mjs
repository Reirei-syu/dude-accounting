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
const outputRoot = path.join(root, '.tmp/window-security-smoke')
fs.mkdirSync(outputRoot, { recursive: true })
const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))
const executable = process.argv[2] || path.join(root, 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, DUDEACC_E2E_APPDATA_PATH: path.join(output, 'appdata') }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const application = await electron.launch({
  executablePath: executable,
  args: process.argv[2] ? [] : [root],
  cwd: root,
  env
})
application.process().stderr.on('data', (data) => process.stderr.write(data))
const result = { output, executable }
try {
  const main = await application.firstWindow()
  await main.getByRole('button', { name: '登录', exact: true }).waitFor()
  await main.screenshot({ path: path.join(output, 'login.png') })
  assert.deepEqual(await main.evaluate(() => Object.keys(window.electron)), ['process'])
  assert.equal(await main.evaluate(() => typeof window.require), 'undefined')
  const login = await main.evaluate(() => window.api.auth.login('admin', ''))
  assert.equal(login.success, true, JSON.stringify(login))
  const ledger = await main.evaluate(() =>
    window.api.ledger.create({
      name: '窗口安全隔离测试',
      standardType: 'npo',
      startPeriod: '2026-09'
    })
  )
  assert.equal(ledger.success, true, JSON.stringify(ledger))
  const ledgers = await main.evaluate(() => window.api.ledger.getAll())
  await application.evaluate(({ app }) => {
    globalThis.__printSmokeMeasurements = []
    app.on('browser-window-created', (_event, window) => {
      const preferences = window.webContents.getLastWebPreferences()
      const record = {
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        completed: false
      }
      globalThis.__printSmokeMeasurements.push(record)
      const execute = window.webContents.executeJavaScript.bind(window.webContents)
      window.webContents.executeJavaScript = async (...args) => {
        const value = await execute(...args)
        record.completed = Array.isArray(value?.rowKeyGroups)
        return value
      }
    })
  })
  const prepared = await main.evaluate(
    (ledgerId) =>
      window.api.print.prepare({
        type: 'book',
        ledgerId,
        bookType: 'detail_ledger',
        title: '窗口安全回归',
        columns: [{ key: 'text', label: '测试内容' }],
        rows: Array.from({ length: 80 }, (_, index) => ({
          key: String(index),
          cells: [{ value: `第 ${index + 1} 行 <img src=x onerror=alert(1)>` }]
        }))
      }),
    ledgers[0].id
  )
  assert.equal(prepared.success, true, JSON.stringify(prepared))
  let status
  for (let attempt = 0; attempt < 150; attempt += 1) {
    status = await main.evaluate((id) => window.api.print.getJobStatus(id), prepared.jobId)
    if (status.status !== 'preparing') break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(status.status, 'ready', JSON.stringify(status))
  const newWindow = application.waitForEvent('window')
  newWindow.catch(() => {})
  const opened = await main.evaluate((id) => window.api.print.openPreview(id), prepared.jobId)
  assert.equal(opened.success, true, JSON.stringify(opened))
  const preview = await newWindow
  await preview.locator('.preview-page-card').first().waitFor()
  result.pageCount = await preview.locator('.preview-page-card').count()
  assert.ok(result.pageCount > 1)
  assert.ok(preview.url().startsWith('file:'))
  assert.deepEqual(await preview.evaluate(() => Object.keys(window.api)), ['print'])
  assert.deepEqual(
    await preview.evaluate(() => Object.keys(window.api.print).sort()),
    ['exportPdf', 'getPreviewModel', 'print', 'updatePreviewSettings'].sort()
  )
  assert.equal(await preview.evaluate(() => typeof window.electron), 'undefined')
  await preview.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.__untrustedScript = true'
    document.body.append(script)
    window.open('https://example.com')
  })
  assert.equal(await preview.evaluate(() => window.__untrustedScript), undefined)
  assert.ok(preview.url().startsWith('file:'))
  await preview.locator('#preview-density-select').selectOption('compact')
  await preview.waitForFunction(
    () => window.__PRINT_PREVIEW_MODEL__.settings.densityPreset === 'compact'
  )
  await preview.screenshot({ path: path.join(output, 'preview.png'), fullPage: true })
  result.windowPreferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      const preferences = window.webContents.getLastWebPreferences()
      return {
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        preload: preferences.preload
      }
    })
  )
  for (const preferences of result.windowPreferences) {
    assert.equal(preferences.sandbox, true)
    assert.equal(preferences.contextIsolation, true)
    assert.equal(preferences.nodeIntegration, false)
  }
  if (process.env.DUDEACC_NATIVE_PRINT_SMOKE === '1') {
    console.log(JSON.stringify({ nativePrintReady: true, output }))
    const cancelled = await preview.evaluate((id) => window.api.print.print(id), prepared.jobId)
    assert.equal(cancelled.success, false, JSON.stringify(cancelled))
    console.log(JSON.stringify({ nativePrintCancelled: cancelled }))
    const completed = await preview.evaluate((id) => window.api.print.print(id), prepared.jobId)
    assert.equal(completed.success, true, JSON.stringify(completed))
    result.nativePrint = { cancelled, completed }
  }
  // 自动回归的回调分支不向真实打印机发送纸张；PDF 使用真实 Chromium 输出。
  await application.evaluate(({ BrowserWindow }) => {
    const preview = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('print-pages')
    )
    preview.webContents.print = (_options, callback) => callback(false, 'cancelled')
  })
  assert.equal(
    (await preview.evaluate((id) => window.api.print.print(id), prepared.jobId)).success,
    false
  )
  await application.evaluate(({ BrowserWindow }) => {
    const preview = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('print-pages')
    )
    preview.webContents.print = (_options, callback) => callback(true)
  })
  assert.equal(
    (await preview.evaluate((id) => window.api.print.print(id), prepared.jobId)).success,
    true
  )
  const pdfPath = path.join(output, 'preview.pdf')
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, pdfPath)
  assert.equal(
    (await preview.evaluate((id) => window.api.print.exportPdf(id), prepared.jobId)).success,
    true
  )
  assert.ok(fs.readFileSync(pdfPath).subarray(0, 5).equals(Buffer.from('%PDF-')))
  await preview.evaluate(() => {
    location.href = 'https://example.com'
  })
  assert.ok(preview.url().startsWith('file:'))
  await preview.close()
  const mainUrl = main.url()
  await main.evaluate(() => {
    window.open('https://example.com')
    location.href = 'https://example.com'
  })
  assert.equal(main.url(), mainUrl)
  assert.equal(application.windows().length, 1)
  result.measurements = await application.evaluate(() =>
    globalThis.__printSmokeMeasurements.filter((record) => record.completed)
  )
  assert.ok(result.measurements.length > 0)
  for (const measurement of result.measurements) {
    assert.deepEqual(measurement, {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      completed: true
    })
  }
  result.success = true
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await application.close()
}

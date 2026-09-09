import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync, execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { extractCommandResult } from './cliCommandResult.mjs'

// --smoke 仅调试三轮，永不标记为长稳通过。
const smoke = process.argv.includes('--smoke')
const releaseIndex = process.argv.indexOf('--executable')
const releaseExecutable = releaseIndex < 0 ? null : process.argv[releaseIndex + 1]
if (releaseIndex >= 0) assert.ok(smoke && releaseExecutable, '--executable 仅用于 --smoke')
const root = path.resolve(import.meta.dirname, '..')
const base = path.join(root, '.tmp/phase15-soak')
fs.mkdirSync(base, { recursive: true })
const output = fs.mkdtempSync(path.join(base, smoke ? 'smoke-' : 'run-'))
const appData = path.join(output, 'appdata')
const env = {
  ...process.env,
  DUDEACC_E2E_APPDATA_PATH: appData,
  APPDATA: appData,
  LOCALAPPDATA: path.join(output, 'local'),
  USERPROFILE: path.join(output, 'home'),
  HOME: path.join(output, 'home'),
  DUDEACC_E2E_SUPPRESS_RELAUNCH: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const executablePath = releaseExecutable
  ? path.resolve(releaseExecutable)
  : path.join(root, 'node_modules/electron/dist/electron.exe')
const appArgs = releaseExecutable ? [] : [root]
const buildPath = releaseExecutable
  ? path.join(path.dirname(executablePath), 'resources/app.asar')
  : path.join(root, 'out/main/index.js')
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
let application, page, databasePath
let commandCount = 0
const observedProcesses = new Map()
const sourceLedgerIds = []
const timeline = []
const startedAt = Date.now()
const mainBuildHash = createHash('sha256').update(fs.readFileSync(buildPath)).digest('hex')
const write = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2))
write('config.json', {
  smoke,
  startedAt: new Date(startedAt).toISOString(),
  output,
  minimumMs: smoke ? 0 : 7_200_000,
  minimumCycles: smoke ? 3 : 50,
  vouchersPerCycle: 26,
  executablePath,
  mainBuildHash,
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  coverage: `真实${releaseExecutable ? '打包版' : '源代码'} Electron GUI IPC + 嵌入式 CLI；强制重启在完整循环边界，不冒充事务中断故障注入`
})
function record(event) {
  const row = { at: new Date().toISOString(), ...event }
  timeline.push(row)
  fs.appendFileSync(path.join(output, 'timeline.jsonl'), JSON.stringify(row) + '\n')
  console.log(JSON.stringify(row))
}
function cli(domain, action, payload = {}, expectedError = false) {
  const began = Date.now()
  const execution = spawnSync(
    executablePath,
    [...appArgs, '--cli', domain, action, '--payload-json', JSON.stringify(payload)],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024
    }
  )
  if (execution.error) throw execution.error
  commandCount++
  const result = extractCommandResult(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`)
  fs.appendFileSync(
    path.join(output, 'commands.jsonl'),
    JSON.stringify({
      at: new Date().toISOString(),
      domain,
      action,
      elapsedMs: Date.now() - began,
      exitCode: execution.status,
      signal: execution.signal,
      status: result.status,
      errorCode: result.error?.code
    }) + '\n'
  )
  assert.equal(execution.signal, null)
  if (expectedError) assert.notEqual(execution.status, 0)
  else assert.equal(execution.status, 0, `${domain} ${action}: ${execution.stderr}`)
  if (expectedError) assert.equal(result.status, 'error', JSON.stringify(result))
  else assert.equal(result.status, 'success', `${domain} ${action}: ${JSON.stringify(result)}`)
  return result
}
async function gui(domain, method, ...args) {
  const result = await page.evaluate(
    ({ domain, method, args }) => window.api[domain][method](...args),
    { domain, method, args }
  )
  commandCount++
  if (result && Object.hasOwn(result, 'success'))
    assert.equal(result.success, true, `${domain}.${method}: ${JSON.stringify(result)}`)
  return result
}
async function launch() {
  application = await electron.launch({ executablePath, args: appArgs, cwd: root, env })
  page = await application.firstWindow()
  await page.getByRole('button', { name: '登录', exact: true }).waitFor()
  const userData = await application.evaluate(({ app }) => app.getPath('userData'))
  const relative = path.relative(fs.realpathSync(appData), fs.realpathSync(userData))
  assert.ok(
    relative &&
      !path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`),
    userData
  )
  databasePath = path.join(userData, ...(releaseExecutable ? ['data'] : []), 'dude-accounting.db')
  if (releaseExecutable) {
    await page.getByPlaceholder('请输入账号').fill('admin')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await page.getByRole('button', { name: '账务处理', exact: true }).waitFor()
    await page.screenshot({ path: path.join(output, 'packaged-login.png') })
  }
  await gui('auth', 'login', 'admin', '')
  cli('auth', 'login', { username: 'admin', password: '' })
}
function invariants(cycle) {
  assert.equal(
    createHash('sha256').update(fs.readFileSync(buildPath)).digest('hex'),
    mainBuildHash,
    '长稳期间运行构建发生变化'
  )
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    assert.deepEqual(
      db
        .prepare('PRAGMA quick_check')
        .all()
        .map((row) => row.quick_check),
      ['ok']
    )
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
    assert.equal(
      db
        .prepare(
          'SELECT voucher_id FROM voucher_entries GROUP BY voucher_id HAVING SUM(debit_amount)<>SUM(credit_amount)'
        )
        .all().length,
      0
    )
    assert.equal(
      db
        .prepare(
          'SELECT ledger_id,fingerprint FROM electronic_voucher_records GROUP BY ledger_id,fingerprint HAVING COUNT(*)>1'
        )
        .all().length,
      0
    )
    assert.equal(
      db
        .prepare(
          "SELECT id FROM electronic_voucher_records r WHERE status='converted' AND NOT EXISTS (SELECT 1 FROM voucher_source_links l WHERE l.source_type='electronic_voucher' AND l.source_record_id=r.id)"
        )
        .all().length,
      0
    )
    const counts = Object.fromEntries(
      [
        'ledgers',
        'vouchers',
        'voucher_entries',
        'operation_logs',
        'electronic_voucher_records'
      ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n])
    )
    assert.equal(
      db
        .prepare(
          "SELECT l.id FROM voucher_source_links l LEFT JOIN electronic_voucher_records r ON r.id=l.source_record_id LEFT JOIN vouchers v ON v.id=l.voucher_id WHERE l.source_type='electronic_voucher' AND (r.id IS NULL OR v.id IS NULL OR r.ledger_id<>v.ledger_id)"
        )
        .all().length,
      0
    )
    assert.ok(counts.vouchers >= cycle)
    for (const [index, ledgerId] of sourceLedgerIds.entries()) {
      const expected = Math.floor((cycle + 1 - index) / 2) * 26
      assert.equal(
        db.prepare('SELECT COUNT(*) AS n FROM vouchers WHERE ledger_id=?').get(ledgerId).n,
        expected
      )
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM operation_logs WHERE ledger_id=? AND module='voucher' AND action='create'"
          )
          .get(ledgerId).n,
        expected
      )
    }
    for (const row of db.prepare('SELECT stored_path,sha256 FROM electronic_voucher_files').all()) {
      assert.ok(fs.existsSync(row.stored_path), row.stored_path)
      assert.equal(
        createHash('sha256').update(fs.readFileSync(row.stored_path)).digest('hex'),
        row.sha256
      )
    }
    const journalPath = databasePath + '.operations/journal.sqlite'
    if (fs.existsSync(journalPath)) {
      const journal = new DatabaseSync(journalPath, { readOnly: true })
      try {
        assert.equal(
          journal
            .prepare(
              "SELECT COUNT(*) AS n FROM operations WHERE state IN ('planned','running','recovery_required') OR compensation IN ('pending','failed')"
            )
            .get().n,
          0
        )
      } finally {
        journal.close()
      }
    }
    return counts
  } finally {
    db.close()
  }
}
async function resources() {
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics())
  const ids = metrics.map((item) => item.pid)
  const handles = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Get-Process | Where-Object { $_.Id -in @(${Array.from(new Set([...ids, ...observedProcesses.keys()])).join(',')}) } | Select-Object Id,HandleCount,WorkingSet64,@{Name='StartTicks';Expression={$_.StartTime.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress`
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 }
  )
  const snapshots = [].concat(JSON.parse(handles || '[]'))
  for (const item of snapshots) {
    if (ids.includes(item.Id)) observedProcesses.set(item.Id, item.StartTicks)
  }
  return {
    processes: metrics,
    handles: snapshots.filter((item) => observedProcesses.get(item.Id) === item.StartTicks),
    harnessRss: process.memoryUsage().rss
  }
}
async function assertOldProcessesExited(previous) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-Process | Where-Object { $_.Id -in @(${previous.map((item) => item.Id).join(',')}) } | Select-Object Id,@{Name='StartTicks';Expression={$_.StartTime.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress`
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 }
    )
    const alive = []
      .concat(JSON.parse(raw || '[]'))
      .filter((item) =>
        previous.some((old) => old.Id === item.Id && old.StartTicks === item.StartTicks)
      )
    if (alive.length === 0) return
    if (attempt === 19) throw new Error(`旧 Electron 进程族残留：${JSON.stringify(alive)}`)
    await delay(250)
  }
}
try {
  await launch()
  const ledgers = sourceLedgerIds
  for (const standardType of ['enterprise', 'npo']) {
    ledgers.push(
      (
        await gui('ledger', 'create', {
          name: `长稳-${standardType}`,
          standardType,
          startPeriod: '2026-01'
        })
      ).id
    )
  }
  const pdf = await application.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ show: false })
    try {
      await window.loadURL('data:text/html,<h1>Isolated Soak Receipt</h1>')
      return (await window.webContents.printToPDF({})).toString('base64')
    } finally {
      window.destroy()
    }
  })
  const lastBackups = new Map(),
    lastArchives = new Map()
  let cycles = 0
  while (cycles < (smoke ? 3 : 50) || (!smoke && Date.now() - startedAt < 7_200_000)) {
    const cycleStart = Date.now(),
      cycle = cycles + 1
    const ledgerId = ledgers[cycles % 2]
    const cycleDir = path.join(output, `cycle-${String(cycle).padStart(3, '0')}`)
    fs.mkdirSync(cycleDir)
    const sourcePath = path.join(cycleDir, 'receipt.pdf')
    fs.writeFileSync(
      sourcePath,
      Buffer.concat([Buffer.from(pdf, 'base64'), Buffer.from(`\n% cycle-${cycle}\n`)])
    )
    const imported = await gui('eVoucher', 'import', { ledgerId, sourcePath })
    const recordId = imported.recordId
    assert.ok(recordId, JSON.stringify(imported))
    cli('evoucher', 'convert', { recordId }, true)
    await gui('eVoucher', 'verify', {
      recordId,
      verificationStatus: 'verified',
      verificationMethod: 'manual-evidence-v1',
      verificationMessage: '隔离测试原件人工核验，不代表外部权威验真',
      manualConfirmation: true
    })
    await gui('eVoucher', 'parse', {
      recordId,
      sourceNumber: `SOAK-${cycle}`,
      sourceDate: '2026-01-01',
      amountCents: 100
    })
    const converted = await gui('eVoucher', 'convert', { recordId })
    const saved = await gui('voucher', 'save', {
      ...converted.draftVoucher,
      entries: [
        { summary: `循环${cycle}`, subjectCode: '1001', debitAmount: '1.00', creditAmount: '0.00' },
        { summary: `循环${cycle}`, subjectCode: '1002', debitAmount: '0.00', creditAmount: '1.00' }
      ]
    })
    assert.ok(saved.success)
    const bulkIds = []
    for (let index = 0; index < 25; index++) {
      const extra = await gui('voucher', 'save', {
        ledgerId,
        voucherDate: '2026-01-01',
        entries: [
          {
            summary: `累计循环${cycle}-${index}`,
            subjectCode: '1001',
            debitAmount: '1.00',
            creditAmount: '0.00'
          },
          {
            summary: `累计循环${cycle}-${index}`,
            subjectCode: '1002',
            debitAmount: '0.00',
            creditAmount: '1.00'
          }
        ]
      })
      assert.ok(extra.voucherId, JSON.stringify(extra))
      bulkIds.push(extra.voucherId)
    }
    const rows = cli('voucher', 'list', { ledgerId, period: '2026-01' }).data
    const source = (await gui('eVoucher', 'list', ledgerId)).find((row) => row.id === recordId)
    assert.equal(source.status, 'converted')
    const voucherIds = [source.linked_voucher_id, ...bulkIds]
    assert.ok(rows.some((row) => row.id === voucherIds[0]))
    cli('evoucher', 'convert', { recordId }, true)
    for (const action of ['audit', 'bookkeep', 'unbookkeep', 'bookkeep']) {
      const changed = await gui('voucher', 'batchAction', {
        action,
        voucherIds,
        reason: '长稳隔离紧急逆转',
        approvalTag: `SOAK-${cycle}`
      })
      assert.equal(changed.processedCount, voucherIds.length)
      assert.equal(changed.skippedCount, 0)
      const currentRows = (await gui('voucher', 'list', { ledgerId })).filter((row) =>
        voucherIds.includes(row.id)
      )
      assert.equal(currentRows.length, voucherIds.length)
      assert.ok(currentRows.every((row) => row.status === (action === 'bookkeep' ? 2 : 1)))
    }
    await gui('period', 'close', { ledgerId, period: '2026-01' })
    const current = cli('ledger', 'list').data.find((row) => row.id === ledgerId)
    assert.equal(current.current_period, '2026-02')
    const archive = cli('archive', 'export', {
      ledgerId,
      fiscalYear: '2026',
      directoryPath: path.join(output, 'archives')
    }).data
    assert.equal(cli('archive', 'validate', { exportId: archive.exportId }).data.valid, true)
    if (lastArchives.has(ledgerId))
      cli('archive', 'delete', { exportId: lastArchives.get(ledgerId) })
    lastArchives.set(ledgerId, archive.exportId)
    await gui('period', 'reopen', { ledgerId, period: '2026-01' })
    assert.equal(
      cli('ledger', 'list').data.find((row) => row.id === ledgerId).current_period,
      '2026-01'
    )
    const snapshot = cli('report', 'generate', {
      ledgerId,
      reportType: 'balance_sheet',
      month: '2026-01'
    }).data.snapshot
    cli('report', 'export', {
      snapshotId: snapshot.id,
      ledgerId,
      format: 'xlsx',
      filePath: path.join(cycleDir, 'balance.xlsx')
    })
    const prepared = cli('print', 'prepare', {
      type: 'voucher',
      ledgerId,
      voucherIds,
      layout: 'single',
      doubleGapPx: 0
    }).data
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = cli('print', 'status', { jobId: prepared.jobId }).data
      if (status.status === 'ready') break
      assert.notEqual(status.status, 'failed', JSON.stringify(status))
      if (attempt === 59) throw new Error('打印任务超时')
      await delay(250)
    }
    assert.ok(cli('print', 'model', { jobId: prepared.jobId }).data.pageCount > 1)
    cli('print', 'export-pdf', {
      jobId: prepared.jobId,
      outputPath: path.join(cycleDir, 'voucher.pdf')
    })
    assert.ok(fs.statSync(path.join(cycleDir, 'voucher.pdf')).size > 1000)
    cli('print', 'dispose', { jobId: prepared.jobId })
    const backup = cli('backup', 'create', {
      ledgerId,
      directoryPath: path.join(output, 'backups')
    }).data
    assert.equal(cli('backup', 'validate', { backupId: backup.backupId }).data.valid, true)
    const restored = await gui('backup', 'import', { backupId: backup.backupId })
    assert.ok(restored.importedLedgerId)
    await gui('auth', 'login', 'admin', '')
    cli('auth', 'login', { username: 'admin', password: '' })
    assert.equal(
      cli('voucher', 'list', { ledgerId: restored.importedLedgerId }).data.length,
      rows.length
    )
    if (lastBackups.has(ledgerId)) cli('backup', 'delete', { backupId: lastBackups.get(ledgerId) })
    lastBackups.set(ledgerId, backup.backupId)
    cli('report', 'delete', { snapshotId: snapshot.id, ledgerId })
    const counts = invariants(cycle)
    const resource = await resources()
    cycles++
    record({
      event: 'cycle-complete',
      cycle,
      elapsedMs: Date.now() - startedAt,
      cycleMs: Date.now() - cycleStart,
      commandCount,
      counts,
      resource
    })
    if (cycles % 10 === 0) {
      const previous = (await resources()).handles
      await application.close()
      await assertOldProcessesExited(previous)
      await launch()
      invariants(cycles)
      record({ event: 'graceful-restart', cycle })
    }
    if (cycles % 15 === 0) {
      const pid = application.process().pid
      const previous = (await resources()).handles
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 15_000
      })
      await assertOldProcessesExited(previous)
      await delay(500)
      await launch()
      invariants(cycles)
      record({ event: 'forced-main-process-restart-at-cycle-boundary', cycle })
    }
    if (!smoke && Date.now() - startedAt < 7_200_000)
      await delay(Math.max(0, 90_000 - (Date.now() - cycleStart)))
  }
  const summary = {
    success: true,
    soakAccepted: !smoke && cycles >= 50 && Date.now() - startedAt >= 7_200_000,
    cycles,
    durationMs: Date.now() - startedAt,
    commandCount,
    output,
    counts: invariants(cycles)
  }
  write('summary.json', summary)
  record({ event: 'complete', ...summary })
} catch (error) {
  write('failure.json', { at: new Date().toISOString(), error: error.stack, commandCount, output })
  throw error
} finally {
  if (application) await application.close().catch(() => undefined)
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { extractCommandResult } from './cliCommandResult.mjs'

const root = path.resolve(import.meta.dirname, '..')
const fixture = fs.realpathSync(process.argv[2])
const relative = path.relative(path.join(root, '.tmp'), fixture)
assert.ok(
  relative &&
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
)
const executable = path.resolve(process.argv[3])
const config = JSON.parse(fs.readFileSync(path.join(fixture, 'config.json'), 'utf8'))
assert.equal(config.smoke, true, '不允许对正式长稳目录执行账簿补测')
const completed = JSON.parse(fs.readFileSync(path.join(fixture, 'summary.json'), 'utf8'))
assert.equal(completed.success, true, '只允许已经成功结束的 smoke')
assert.equal(completed.soakAccepted, false)
assert.equal(fs.realpathSync(config.output), fixture)
assert.equal(fs.realpathSync(completed.output), fixture)
assert.equal(fs.realpathSync(config.executablePath), fs.realpathSync(executable))
const appDataRelative = path.relative(fixture, fs.realpathSync(path.join(fixture, 'appdata')))
assert.ok(
  appDataRelative &&
    !path.isAbsolute(appDataRelative) &&
    appDataRelative !== '..' &&
    !appDataRelative.startsWith(`..${path.sep}`)
)
const output = fs.mkdtempSync(path.join(fixture, 'book-smoke-'))
const env = {
  ...process.env,
  DUDEACC_E2E_APPDATA_PATH: path.join(fixture, 'appdata'),
  APPDATA: path.join(fixture, 'appdata'),
  LOCALAPPDATA: path.join(fixture, 'local'),
  USERPROFILE: path.join(fixture, 'home'),
  HOME: path.join(fixture, 'home'),
  DUDEACC_E2E_SUPPRESS_RELAUNCH: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
let calls = 0
function cli(domain, action, payload = {}) {
  const input = path.join(output, `payload-${++calls}.json`)
  fs.writeFileSync(input, JSON.stringify(payload))
  const result = spawnSync(executable, ['--cli', domain, action, '--payload-file', input], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  const parsed = extractCommandResult(`${result.stdout}\n${result.stderr}`)
  assert.equal(parsed.status, 'success', JSON.stringify(parsed))
  return parsed.data
}
async function model(jobId) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = cli('print', 'status', { jobId })
    if (status.status === 'ready') return cli('print', 'model', { jobId })
    assert.notEqual(status.status, 'failed', JSON.stringify(status))
    await delay(250)
  }
  throw new Error('账簿打印任务超时')
}

cli('auth', 'login', { username: 'admin', password: '' })
const ledger = cli('ledger', 'list').find((row) => row.name === '长稳-enterprise')
assert.ok(ledger)
const rows = cli('book', 'journal', {
  ledgerId: ledger.id,
  startDate: '2026-01-01',
  endDate: '2026-01-31'
})
assert.equal(rows.length, 104)
// 与 Journal.tsx 的打印字段和整数分显式转换一致，使用实际业务查询，不虚构账簿数据。
const payload = {
  type: 'book',
  ledgerId: ledger.id,
  bookType: 'journal',
  title: '序时账',
  ledgerName: ledger.name,
  periodLabel: '2026-01-01 至 2026-01-31',
  columns: [
    ['voucher_date', '日期'],
    ['voucher_number', '凭证号'],
    ['subject_code', '科目编码'],
    ['subject_name', '科目名称'],
    ['summary', '摘要'],
    ['debit', '借方'],
    ['credit', '贷方']
  ].map(([key, label], index) => ({ key, label, align: index < 5 ? 'left' : 'right' })),
  rows: rows.map((row, index) => ({
    key: `${row.entry_id}-${index}`,
    cells: [
      { value: row.voucher_date },
      { value: `${row.voucher_word}-${String(row.voucher_number).padStart(4, '0')}` },
      { value: row.subject_code },
      { value: row.subject_name },
      { value: row.summary },
      { value: row.debit_amount / 100, isAmount: true },
      { value: row.credit_amount / 100, isAmount: true }
    ]
  }))
}
const first = cli('print', 'prepare', payload)
const initial = await model(first.jobId)
assert.ok(initial.pageCount > 1)
const desiredScale = initial.settings.scalePercent === 95 ? 90 : 95
const desiredMargin = initial.settings.marginPreset === 'narrow' ? 'extra-narrow' : 'narrow'
cli('print', 'update-settings', {
  jobId: first.jobId,
  settings: { scalePercent: desiredScale, marginPreset: desiredMargin }
})
await model(first.jobId)
cli('print', 'dispose', { jobId: first.jobId })
const second = cli('print', 'prepare', payload)
try {
  const final = await model(second.jobId)
  assert.equal(final.settings.scalePercent, desiredScale)
  assert.equal(final.settings.marginPreset, desiredMargin)
  assert.equal(final.diagnostics.overflowDetected, false)
  assert.equal(
    final.diagnostics.pageRowCounts.reduce((a, b) => a + b, 0),
    rows.length
  )
  const pdf = path.join(output, 'journal.pdf')
  cli('print', 'export-pdf', { jobId: second.jobId, outputPath: pdf })
  fs.writeFileSync(
    path.join(output, 'evidence.json'),
    JSON.stringify(
      {
        success: true,
        rows: rows.length,
        pageCount: final.pageCount,
        settings: final.settings,
        diagnostics: final.diagnostics,
        expectedVoucherNumbers: [...new Set(rows.map((row) => row.voucher_number))],
        output,
        pdf
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({ success: true, rows: rows.length, pageCount: final.pageCount, output })
  )
} finally {
  cli('print', 'dispose', { jobId: second.jobId })
}

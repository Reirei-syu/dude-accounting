import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// 外置只读采样，不修改正在长稳运行的构建/数据库。仅在两个完整循环之间验收。
const root = fs.realpathSync(process.argv[2])
const timelinePath = path.join(root, 'timeline.jsonl')
const timeline = fs.readFileSync(timelinePath, 'utf8')
const commandsPath = path.join(root, 'commands.jsonl')
const commandsBefore = fs.readFileSync(commandsPath, 'utf8')
const events = timeline.trim().split('\n').map(JSON.parse)
const last = events.findLast((row) => row.event === 'cycle-complete')
assert.ok(last)
// 重启后的登录发生在 cycle-complete 之后，以已经完成的重启/最终事件为静止边界。
const boundary = events.at(-1)
assert.ok(
  [
    'cycle-complete',
    'graceful-restart',
    'forced-main-process-restart-at-cycle-boundary',
    'complete'
  ].includes(boundary.event)
)
assert.equal(boundary.cycle ?? boundary.cycles, last.cycle)
const lastCommand = commandsBefore.trim().split('\n').map(JSON.parse).at(-1)
if (lastCommand && Date.parse(lastCommand.at) > Date.parse(boundary.at)) {
  console.log(JSON.stringify({ skipped: true, reason: '下一轮命令已开始，等待新的完整循环' }))
  process.exit(0)
}
const userData = path.join(root, 'appdata/dude-app-dev')
const dbPath = path.join(userData, 'dude-accounting.db')
const journal = new DatabaseSync(dbPath + '.operations/journal.sqlite', { readOnly: true })
let operations
try {
  operations = journal
    .prepare(
      'SELECT operation_id, kind, state, compensation, plan_json, updated_at FROM operations'
    )
    .all()
} finally {
  journal.close()
}
const busy = operations.some(
  (row) =>
    ['planned', 'running'].includes(row.state) ||
    Date.parse(row.updated_at) > Date.parse(boundary.at)
)
if (busy) {
  console.log(JSON.stringify({ skipped: true, reason: '当前循环正在操作文件，稍后重试' }))
  process.exit(0)
}
const db = new DatabaseSync(dbPath, { readOnly: true })
let backups, archives
try {
  backups = db.prepare('SELECT backup_path FROM backup_packages').all()
  archives = db.prepare('SELECT export_path FROM archive_exports').all()
} finally {
  db.close()
}
const violations = []
for (const row of operations) {
  if (row.state === 'recovery_required' || ['pending', 'failed'].includes(row.compensation)) {
    violations.push(`未收敛操作 ${row.operation_id}`)
  }
  const plan = JSON.parse(row.plan_json)
  if (plan.artifactVersion === 1) {
    const artifact = path.resolve(plan.parent, plan.directory)
    const relative = path.relative(root, artifact)
    assert.ok(
      !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    )
    if (fs.existsSync(path.join(artifact, 'staging')))
      violations.push(`终态暂存残留 ${row.operation_id}`)
  }
}
for (const row of [...backups, ...archives]) {
  const file = row.backup_path ?? row.export_path
  if (!fs.existsSync(file)) violations.push(`已登记产物缺失 ${file}`)
}
for (const name of fs.readdirSync(userData)) {
  if (
    name.startsWith('dude-accounting.db.import-staging-') ||
    name === 'dude-accounting.db.recovery'
  ) {
    violations.push(`切换暂存未清理 ${name}`)
  }
}
for (const name of ['print-jobs', 'print-pages']) {
  const directory = path.join(userData, name)
  if (fs.existsSync(directory) && fs.readdirSync(directory).length)
    violations.push(`打印任务未清理 ${name}`)
}
const inventoryErrors = []
function inventory(directory) {
  try {
    return scanInventory(directory)
  } catch (error) {
    inventoryErrors.push(error)
    return null
  }
}
function scanInventory(directory) {
  const result = { files: 0, directories: 0, bytes: 0, ownerMarkers: 0 }
  if (!fs.existsSync(directory)) return result
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`采样目录出现链接 ${file}`)
    if (entry.isDirectory()) {
      result.directories++
      const child = scanInventory(file)
      for (const key of Object.keys(result)) result[key] += child[key]
    } else if (entry.isFile()) {
      result.files++
      result.bytes += fs.statSync(file).size
      if (entry.name === '.owner') result.ownerMarkers++
    }
  }
  return result
}
const groups = Object.fromEntries(
  [
    'backups',
    'archives',
    'appdata/dude-app-dev/import-assets',
    'appdata/dude-app-dev/electronic-vouchers'
  ].map((name) => [name, inventory(path.join(root, name))])
)
const finalJournal = new DatabaseSync(dbPath + '.operations/journal.sqlite', { readOnly: true })
let finalOperations
try {
  finalOperations = finalJournal
    .prepare(
      'SELECT operation_id, kind, state, compensation, plan_json, updated_at FROM operations'
    )
    .all()
} finally {
  finalJournal.close()
}
if (
  fs.readFileSync(timelinePath, 'utf8') !== timeline ||
  fs.readFileSync(commandsPath, 'utf8') !== commandsBefore ||
  JSON.stringify(finalOperations) !== JSON.stringify(operations)
) {
  console.log(JSON.stringify({ skipped: true, reason: '采样跨越循环边界，稍后重试' }))
  process.exit(0)
}
const sample = {
  at: new Date().toISOString(),
  cycle: last.cycle,
  operations: operations.length,
  backups: backups.length,
  archives: archives.length,
  violations,
  groups,
  note: '累计导入账套原件和审计归属标记是持久数据；不要求总文件数为零，不删除任何内容。'
}
if (inventoryErrors.length) throw new AggregateError(inventoryErrors, '稳定采样窗口中文件遍历失败')
fs.appendFileSync(path.join(root, 'file-samples.jsonl'), JSON.stringify(sample) + '\n')
console.log(JSON.stringify(sample))
assert.equal(violations.length, 0, JSON.stringify(violations))

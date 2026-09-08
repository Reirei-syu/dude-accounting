import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { createCurrentSchema, CURRENT_SCHEMA_VERSION } from './schema'
import { runDatabaseMigrations, SchemaMigrationError } from './migrations'
import { getSchemaObjects, validateSchema } from './migrationSchema'
import { createHistoricalFixture } from './migrationFixtures'
import { initializeDatabase, getDatabasePath, closeDatabase } from './init'
import {
  createNodeRuntimeContext,
  setRuntimeContext,
  clearRuntimeContext
} from '../runtime/runtimeContext'

const handles: Database.Database[] = []
const folders: string[] = []
function open(file = ':memory:'): Database.Database {
  const db = new Database(file)
  handles.push(db)
  db.pragma('foreign_keys = ON')
  return db
}
function temporary(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-migrations-'))
  folders.push(folder)
  return folder
}
function fingerprint(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}
afterEach(() => {
  closeDatabase()
  clearRuntimeContext()
  for (const db of handles.splice(0)) if (db.open) db.close()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

describe('版本化数据库迁移', () => {
  it('空库直接创建当前完整结构；再次启动只校验', () => {
    const db = open()
    expect(runDatabaseMigrations(db)).toMatchObject({
      created: true,
      applied: [],
      toVersion: CURRENT_SCHEMA_VERSION
    })
    const schema = getSchemaObjects(db)
    const changes = db.prepare('SELECT total_changes() AS count').get()
    expect(runDatabaseMigrations(db)).toMatchObject({
      created: false,
      applied: [],
      backupPath: null
    })
    expect(getSchemaObjects(db)).toEqual(schema)
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
  })

  it.each([
    'minimal',
    'subjects',
    'vouchers',
    'compliance',
    'initialBalances',
    'cashMappings',
    'reports',
    'backup',
    'all'
  ])('历史结构 %s 与新库到达相同 schema，重复启动不重复归档', (variant) => {
    const db = open()
    db.pragma('foreign_keys = OFF')
    createHistoricalFixture(db, variant)
    db.pragma('foreign_keys = ON')
    const result = runDatabaseMigrations(db)
    expect(result.applied).toEqual([1, 2, 3])
    validateSchema(db)
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    const archived = db.prepare('SELECT * FROM migration_conflicts ORDER BY id').all()
    expect(runDatabaseMigrations(db).applied).toEqual([])
    expect(db.prepare('SELECT * FROM migration_conflicts ORDER BY id').all()).toEqual(archived)
    expect(db.prepare('SELECT name FROM ledgers WHERE id=7').get()).toEqual({ name: '历史账套' })
  })

  it('历史版本2结构的版本0不是空库，保留全部关键业务和合规字段', () => {
    const db = open()
    createCurrentSchema(db, 2)
    db.exec(
      "INSERT INTO users(id,username) VALUES(1,'historical'); INSERT INTO ledgers(id,name,start_period,current_period) VALUES(7,'保留','2026-01','2026-01');"
    )
    db.exec(
      "INSERT INTO vouchers(id,ledger_id,period,voucher_date,voucher_number,status,posted_at,emergency_reversal_reason,reversal_approval_tag) VALUES(61,7,'2026-01','2026-01-01',1,2,'原记账时间','原原因','原审批');"
    )
    const before = db.prepare('SELECT * FROM vouchers').all()
    expect(runDatabaseMigrations(db).created).toBe(false)
    expect(db.prepare('SELECT * FROM vouchers').all()).toEqual(before)
  })

  it('父表重建保留分录/辅助关联、期初主键、已有合规字段及 sequence 高水位', () => {
    const db = open()
    db.pragma('foreign_keys = OFF')
    createHistoricalFixture(db)
    db.exec(
      "UPDATE sqlite_sequence SET seq=9999 WHERE name IN ('vouchers','subjects','initial_balances')"
    )
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT id,voucher_id,debit_amount FROM voucher_entries').get()).toEqual({
      id: 71,
      voucher_id: 61,
      debit_amount: 12345
    })
    expect(db.prepare('SELECT id,subject_id FROM subject_auxiliary_categories').get()).toEqual({
      id: 51,
      subject_id: 31
    })
    expect(db.prepare('SELECT id,period,debit_amount FROM initial_balances').get()).toEqual({
      id: 81,
      period: '2026-01',
      debit_amount: 23456
    })
    expect(
      db
        .prepare('SELECT posted_at,emergency_reversal_reason,reversal_approval_tag FROM vouchers')
        .get()
    ).toEqual({
      posted_at: '2026-02-04',
      emergency_reversal_reason: '历史审批原因',
      reversal_approval_tag: '审批-001'
    })
    expect(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='vouchers'").get()).toEqual({
      seq: 9999
    })
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('报表去重保留最大id且完整归档原内容，旧现金流映射不静默消失', () => {
    const db = open()
    createHistoricalFixture(db)
    const originalCash = db.prepare('SELECT * FROM cash_flow_mappings').get()
    runDatabaseMigrations(db)
    expect(db.prepare('SELECT id,content_json FROM report_snapshots').all()).toEqual([
      { id: 112, content_json: '{"amount":200}' }
    ])
    const report = db
      .prepare(
        "SELECT row_json FROM migration_conflicts WHERE table_name='report_snapshots' AND source_key='111' AND reason LIKE '重复%'"
      )
      .get() as { row_json: string }
    expect(JSON.parse(report.row_json)).toMatchObject({
      id: 111,
      content_json: '{"amount":100}',
      report_name: '旧快照'
    })
    const cash = db
      .prepare("SELECT row_json FROM migration_conflicts WHERE table_name='cash_flow_mappings'")
      .get() as { row_json: string }
    expect(JSON.parse(cash.row_json)).toEqual(originalCash)
    expect(db.prepare('SELECT * FROM cash_flow_mappings').all()).toEqual([])
  })

  it('步骤内异常回滚 DDL、数据、归档与版本；恢复连接设置', () => {
    const db = open()
    createHistoricalFixture(db, 'reports')
    const schema = getSchemaObjects(db)
    expect(() =>
      runDatabaseMigrations(db, {
        checkpoint(point, version) {
          if (point === 'beforeCommit' && version === 1) throw new Error('模拟断电')
        }
      })
    ).toThrow('模拟断电')
    expect(db.pragma('user_version', { simple: true })).toBe(0)
    expect(getSchemaObjects(db)).toEqual(schema)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('locking_mode', { simple: true })).toBe('normal')
    expect(runDatabaseMigrations(db).applied).toEqual([1, 2, 3])
  })

  it('第一步提交后中断从版本1续跑；第二步失败不留下半份归档', () => {
    const db = open()
    createHistoricalFixture(db, 'reports')
    expect(() =>
      runDatabaseMigrations(db, {
        checkpoint(point, version) {
          if (point === 'afterCommit' && version === 1) throw new Error('步骤间中断')
        }
      })
    ).toThrow('步骤间中断')
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(() =>
      runDatabaseMigrations(db, {
        checkpoint(point) {
          if (point === 'beforeCommit') throw new Error('第二步中断')
        }
      })
    ).toThrow('第二步中断')
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM report_snapshots').get()).toEqual({ count: 2 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM migration_conflicts').get()).toEqual({
      count: 0
    })
    expect(runDatabaseMigrations(db).applied).toEqual([2, 3])
  })

  it('文件库升级前快照包含 WAL 已提交记录，副本可独立恢复演练', () => {
    const folder = temporary()
    const db = open(path.join(folder, 'legacy.sqlite'))
    db.pragma('journal_mode = WAL')
    createHistoricalFixture(db, 'reports')
    const result = runDatabaseMigrations(db)
    expect(result.backupPath).toBeTruthy()
    const restored = open(result.backupPath!)
    expect(restored.pragma('user_version', { simple: true })).toBe(0)
    expect(restored.prepare('SELECT COUNT(*) AS count FROM report_snapshots').get()).toEqual({
      count: 2
    })
    expect(runDatabaseMigrations(restored).applied).toEqual([1, 2, 3])
    validateSchema(restored)
  })

  it('备份失败在迁移之前拒绝，源文件和版本保持不变', () => {
    const folder = temporary(),
      file = path.join(folder, 'legacy.sqlite')
    const db = open(file)
    createHistoricalFixture(db, 'minimal')
    const before = fingerprint(file)
    const blocker = path.join(folder, 'not-a-directory')
    fs.writeFileSync(blocker, '占位')
    expect(() => runDatabaseMigrations(db, { backupDirectory: blocker })).toThrow(
      SchemaMigrationError
    )
    expect(fingerprint(file)).toBe(before)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })

  it('未知高版本安全拒绝且不改主文件', () => {
    const file = path.join(temporary(), 'future.sqlite')
    const db = open(file)
    createCurrentSchema(db)
    db.pragma('user_version=99')
    const before = fingerprint(file)
    expect(() => runDatabaseMigrations(db)).toThrow('禁止降级写入')
    expect(fingerprint(file)).toBe(before)
  })

  it('孤儿关联、未知列和坏索引均不能被 ensure 静默吞掉', () => {
    const orphan = open()
    createHistoricalFixture(orphan, 'subjects')
    orphan.pragma('foreign_keys=OFF')
    orphan.exec('UPDATE subjects SET ledger_id=999 WHERE id=31')
    expect(() => runDatabaseMigrations(orphan)).toThrow('外键')
    expect(orphan.prepare('SELECT ledger_id FROM subjects WHERE id=31').get()).toEqual({
      ledger_id: 999
    })
    const unknown = open()
    createHistoricalFixture(unknown, 'minimal')
    unknown.exec('ALTER TABLE users ADD COLUMN private_extension TEXT')
    expect(() => runDatabaseMigrations(unknown)).toThrow('未知列')
    const latest = open()
    runDatabaseMigrations(latest)
    latest.exec(
      'DROP INDEX idx_vouchers_unique_active_number; CREATE UNIQUE INDEX idx_vouchers_unique_active_number ON vouchers(id)'
    )
    expect(() => runDatabaseMigrations(latest)).toThrow('schema 校验失败')
  })

  it('启动拒绝 WAL 内的未来版本，关闭后主文件和辅助文件均不改变', () => {
    const directory = temporary()
    setRuntimeContext(
      createNodeRuntimeContext({
        userDataPath: directory,
        appDataPath: directory,
        isDevelopment: false
      })
    )
    const file = getDatabasePath()
    const program = `const D=require('better-sqlite3');const d=new D(${JSON.stringify(file)});d.pragma('journal_mode=WAL');d.exec('CREATE TABLE future_data(id INTEGER); INSERT INTO future_data VALUES(1); PRAGMA user_version=99;');process.exit(0)`
    const result = spawnSync(process.execPath, ['-e', program], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
    expect(fs.statSync(file + '-wal').size).toBeGreaterThan(0)
    const snapshot = (): Array<string | null> =>
      ['', '-wal', '-shm'].map((suffix) =>
        fs.existsSync(file + suffix) ? fingerprint(file + suffix) : null
      )
    const before = snapshot()
    expect(() => initializeDatabase()).toThrow('禁止降级写入')
    closeDatabase()
    expect(snapshot()).toEqual(before)
  })

  it('未知生成列安全拒绝，原 schema 和版本保持不变', () => {
    const db = open()
    createHistoricalFixture(db, 'minimal')
    db.exec(
      "ALTER TABLE users ADD COLUMN hidden_extra TEXT GENERATED ALWAYS AS (username || '-extra') VIRTUAL"
    )
    const before = getSchemaObjects(db)
    expect(() => runDatabaseMigrations(db)).toThrow('未知列：hidden_extra')
    expect(getSchemaObjects(db)).toEqual(before)
    expect(db.pragma('user_version', { simple: true })).toBe(0)
  })

  it('进程在事务中直接终止后 SQLite 回滚，下一次启动能升级', () => {
    const file = path.join(temporary(), 'crash.sqlite')
    const db = open(file)
    createHistoricalFixture(db, 'reports')
    db.close()
    const modulePath = path.resolve(__dirname, '../../../out/cli/main/database/migrations.js')
    const program = `const D=require('better-sqlite3');const {runDatabaseMigrations}=require(${JSON.stringify(modulePath)});const d=new D(${JSON.stringify(file)});runDatabaseMigrations(d,{checkpoint(p,v){if(p==='beforeCommit'&&v===1)process.exit(73)}});`
    const result = spawnSync(process.execPath, ['-e', program], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 20000,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(73)
    const recovered = open(file)
    expect(recovered.pragma('user_version', { simple: true })).toBe(0)
    expect(recovered.prepare('SELECT COUNT(*) AS count FROM report_snapshots').get()).toEqual({
      count: 2
    })
    expect(runDatabaseMigrations(recovered).applied).toEqual([1, 2, 3])
  })
})

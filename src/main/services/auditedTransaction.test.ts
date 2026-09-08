import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditedTransaction } from './auditedTransaction'

describe('审计事务原子性', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys=ON')
    db.exec(
      'CREATE TABLE business(id INTEGER PRIMARY KEY); CREATE TABLE operation_logs(id INTEGER PRIMARY KEY, target INTEGER REFERENCES business(id) DEFERRABLE INITIALLY DEFERRED)'
    )
  })
  afterEach(() => db.close())
  function rows(table: 'business' | 'operation_logs'): unknown[] {
    return db.prepare(`SELECT * FROM ${table}`).all()
  }

  it('同一连接一次提交业务和日志', () => {
    auditedTransaction(db, () => {
      expect(db.inTransaction).toBe(true)
      db.prepare('INSERT INTO business VALUES(1)').run()
      db.prepare('INSERT INTO operation_logs VALUES(1,1)').run()
    })
    expect(rows('business')).toHaveLength(1)
    expect(rows('operation_logs')).toHaveLength(1)
  })
  it('日志失败回滚已执行的嵌套业务事务', () => {
    db.exec(
      "CREATE TRIGGER fail_log BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END"
    )
    expect(() =>
      auditedTransaction(db, () => {
        db.transaction(() => db.prepare('INSERT INTO business VALUES(1)').run())()
        db.prepare('INSERT INTO operation_logs VALUES(1,1)').run()
      })
    ).toThrow('audit failed')
    expect(rows('business')).toHaveLength(0)
    expect(rows('operation_logs')).toHaveLength(0)
  })
  it('提交时延迟约束失败同时撤销业务和日志', () => {
    expect(() =>
      auditedTransaction(db, () => {
        db.prepare('INSERT INTO business VALUES(1)').run()
        db.prepare('INSERT INTO operation_logs VALUES(1,999)').run()
      })
    ).toThrow('FOREIGN KEY')
    expect(rows('business')).toHaveLength(0)
    expect(rows('operation_logs')).toHaveLength(0)
  })
  it('业务中途失败不会留下成功日志', () => {
    expect(() =>
      auditedTransaction(db, () => {
        db.prepare('INSERT INTO business VALUES(1)').run()
        db.prepare('INSERT INTO operation_logs VALUES(1,1)').run()
        db.prepare('INSERT INTO business VALUES(1)').run()
      })
    ).toThrow('UNIQUE')
    expect(rows('business')).toHaveLength(0)
    expect(rows('operation_logs')).toHaveLength(0)
  })
  it('拒绝异步回调和 Promise 返回值', () => {
    expect(() =>
      // @ts-expect-error 验证非 TypeScript 调用方的运行时保护
      auditedTransaction(db, async () => db.prepare('INSERT INTO business VALUES(1)').run())
    ).toThrow('异步回调')
    expect(() =>
      // @ts-expect-error 验证非 TypeScript 调用方的运行时保护
      auditedTransaction(db, () => {
        db.prepare('INSERT INTO business VALUES(1)').run()
        return Promise.resolve()
      })
    ).toThrow('Promise')
    expect(rows('business')).toHaveLength(0)
  })
})

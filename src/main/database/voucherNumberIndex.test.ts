import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { createCurrentSchema } from './schema'
import { runDatabaseMigrations } from './migrations'

describe('有效凭证编号迁移', () => {
  for (const duplicateStatus of [0, 2, 3]) it('重复状态 ' + duplicateStatus + ' 不得误删凭证', () => {
    const db = new Database(':memory:')
    try {
      createCurrentSchema(db)
      db.exec("INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'账套','2026-01','2026-01'); DROP INDEX idx_vouchers_unique_active_number;")
      const insert = db.prepare("INSERT INTO vouchers(ledger_id,period,voucher_date,voucher_number,status) VALUES(1,'2026-01','2026-01-01',1,?)")
      insert.run(0)
      insert.run(duplicateStatus)
      if (duplicateStatus === 3) {
        runDatabaseMigrations(db)
        expect(() => insert.run(0)).toThrow()
        insert.run(3)
        expect(db.prepare('SELECT COUNT(*) AS count FROM vouchers').get()).toEqual({ count: 3 })
      } else {
        expect(() => runDatabaseMigrations(db)).toThrow('有效凭证存在重复编号')
        expect(db.prepare('SELECT COUNT(*) AS count FROM vouchers').get()).toEqual({ count: 2 })
        expect(db.pragma('user_version', { simple: true })).toBe(1)
      }
    } finally { db.close() }
  })
})

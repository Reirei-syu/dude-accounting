import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import { createNodeRuntimeContext } from '../runtime/runtimeContext'
import { getLedgerYearOverviewCommand } from './ledgerCommands'
import { closePeriodCommand, reopenPeriodCommand } from './periodCommands'
import type { CommandContext } from './types'
import type { LedgerYearOverviewQuery } from '../../shared/contracts/ledgerOverview'

describe('首页年度概览（真实 SQLite 与会话）', () => {
  let db: Database.Database
  let context: CommandContext
  beforeEach(() => {
    db = new Database(':memory:')
    runDatabaseMigrations(db)
    db.pragma('foreign_keys = ON')
    db.exec(`
      INSERT INTO users(id, username, is_admin) VALUES (1, 'admin', 1), (2, 'reader', 0);
      INSERT INTO ledgers(id, name, standard_type, start_period, current_period) VALUES
        (1, '首页企业账套', 'enterprise', '2025-03', '2025-12'),
        (2, '首页民非账套', 'npo', '2026-01', '2026-01');
      INSERT INTO user_ledger_permissions(user_id, ledger_id) VALUES (2, 1);
      INSERT INTO periods(ledger_id, period, is_closed) VALUES (1, '2025-03', 1), (1, '2025-12', 0);
      INSERT INTO vouchers(id, ledger_id, period, voucher_date, voucher_number, voucher_word, status) VALUES
        (1, 1, '2025-03', '2025-03-01', 1, '记', 0),
        (2, 1, '2025-03', '2025-03-02', 2, '记', 1),
        (3, 1, '2025-03', '2025-03-03', 3, '记', 2),
        (4, 1, '2025-03', '2025-03-04', 1, '结', 2),
        (5, 1, '2025-03', '2025-03-05', 4, '记', 3),
        (6, 1, '2026-01', '2026-01-01', 1, '记', 0),
        (7, 2, '2026-01', '2026-01-01', 1, '记', 0);
      INSERT INTO voucher_entries(voucher_id, row_order, subject_code, debit_amount, credit_amount) VALUES
        (1, 0, '1001', 500, 0), (1, 1, '1002', 500, 0), (1, 2, '3001', 0, 1000);
    `)
    context = {
      db,
      actor: resolveSessionActor(db, issueSession(db, 1), 'ipc'),
      runtime: createNodeRuntimeContext(),
      outputMode: 'json',
      now: new Date('2026-09-09T00:00:00Z')
    }
  })
  afterEach(() => db.close())

  it.each([
    {
      source: 'ipc' as const,
      executablePath: 'D:\\隔离环境\\dude-app.exe',
      userDataPath: 'D:\\隔离环境\\账务数据'
    },
    {
      source: 'cli' as const,
      executablePath: '/usr/bin/hermes',
      userDataPath: '/mnt/d/隔离环境/账务数据'
    }
  ])('$source 使用显式连接和账套，不依赖 Windows 或 WSL/Hermes 环境路径', async (runtime) => {
    context.actor!.source = runtime.source
    context.runtime = createNodeRuntimeContext(runtime)
    const before = db.prepare('SELECT total_changes() AS count').get()
    const result = await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })
    expect(result.status).toBe('success')
    expect(result.data?.months).toHaveLength(12)
    expect(result.data?.months[0]).toEqual({
      period: '2025-01',
      status: 'not_started',
      voucherCount: 0
    })
    expect(result.data?.months[2]).toEqual({ period: '2025-03', status: 'closed', voucherCount: 4 })
    expect(result.data?.months[3]).toEqual({ period: '2025-04', status: 'open', voucherCount: 0 })
    expect(result.data?.months[11]).toEqual({ period: '2025-12', status: 'open', voucherCount: 0 })
    expect(result.data?.months.reduce((sum, month) => sum + month.voucherCount, 0)).toBe(4)
    expect(db.prepare('SELECT total_changes() AS count').get()).toEqual(before)
    expect(db.prepare('SELECT current_period FROM ledgers WHERE id = 1').get()).toEqual({
      current_period: '2025-12'
    })
  })

  it('跨年和民非账套独立统计，空年份补齐 12 个月', async () => {
    const next = await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2026 })
    expect(next.data?.months[0].voucherCount).toBe(1)
    const other = await getLedgerYearOverviewCommand(context, { ledgerId: 2, year: 2026 })
    expect(other.data?.ledger.standard_type).toBe('npo')
    expect(other.data?.months[0].voucherCount).toBe(1)
    const empty = await getLedgerYearOverviewCommand(context, { ledgerId: 2, year: 2027 })
    expect(empty.data?.months).toHaveLength(12)
    expect(
      empty.data?.months.every((month) => month.status === 'open' && month.voucherCount === 0)
    ).toBe(true)
  })

  it('结账和反结账后读取实时状态，删除与恢复改变有效张数', async () => {
    expect((await closePeriodCommand(context, { ledgerId: 1, period: '2025-04' })).status).toBe(
      'success'
    )
    expect(
      (await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).data?.months[3]
        .status
    ).toBe('closed')
    expect((await reopenPeriodCommand(context, { ledgerId: 1, period: '2025-04' })).status).toBe(
      'success'
    )
    expect(
      (await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).data?.months[3]
        .status
    ).toBe('open')
    // 构造删除/恢复后的持久化状态，年度查询不应保留旧计数。
    db.prepare('UPDATE vouchers SET status = 3, deleted_from_status = 0 WHERE id = 1').run()
    expect(
      (await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).data?.months[2]
        .voucherCount
    ).toBe(3)
    db.prepare('UPDATE vouchers SET status = 0, deleted_from_status = NULL WHERE id = 1').run()
    expect(
      (await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).data?.months[2]
        .voucherCount
    ).toBe(4)
  })

  it('普通用户可读授权账套，无授权、撤权和失效会话均被拒绝', async () => {
    context.actor = resolveSessionActor(db, issueSession(db, 2), 'ipc')
    expect((await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).status).toBe(
      'success'
    )
    expect((await getLedgerYearOverviewCommand(context, { ledgerId: 2, year: 2026 })).status).toBe(
      'error'
    )
    db.prepare('DELETE FROM user_ledger_permissions WHERE user_id = 2').run()
    expect((await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).status).toBe(
      'error'
    )
    db.prepare('UPDATE users SET auth_revision = auth_revision + 1 WHERE id = 2').run()
    expect((await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).status).toBe(
      'error'
    )
  })

  it.each([
    null,
    {},
    { ledgerId: 0, year: 2025 },
    { ledgerId: '0', year: 2025 },
    { ledgerId: 1, year: '0' },
    { ledgerId: 1, year: 0 },
    { ledgerId: 1, year: 10000 },
    { ledgerId: 1, year: 2025.5 },
    { ledgerId: 1, year: '2025 OR 1=1' }
  ])('拒绝非法参数 %j', async (payload) => {
    expect(
      (await getLedgerYearOverviewCommand(context, payload as LedgerYearOverviewQuery)).error?.code
    ).toBe('VALIDATION_ERROR')
  })

  it('拒绝未登录请求，不存在的账套返回明确错误', async () => {
    expect(
      (await getLedgerYearOverviewCommand(context, { ledgerId: 999, year: 2025 })).error?.code
    ).toBe('NOT_FOUND')
    context.actor = null
    expect((await getLedgerYearOverviewCommand(context, { ledgerId: 1, year: 2025 })).status).toBe(
      'error'
    )
  })
})

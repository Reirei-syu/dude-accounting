import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import {
  createUserCommand,
  updateUserCommand,
  deleteUserCommand,
  logoutCommand
} from './authCommands'
import { createLedgerCommand, updateLedgerCommand, deleteLedgerCommand } from './ledgerCommands'
import { closePeriodCommand, reopenPeriodCommand } from './periodCommands'
import {
  voucherBatchActionCommand,
  createVoucherCommand,
  updateVoucherCommand,
  swapVoucherPositionsCommand,
  renumberVoucherNumbersCommand
} from './voucherCommands'
import { setUserPreferencesCommand, setSystemParamCommand } from './settingsCommands'
import {
  createSubjectCommand,
  updateSubjectCommand,
  deleteSubjectCommand,
  createAuxiliaryItemCommand,
  updateAuxiliaryItemCommand,
  deleteAuxiliaryItemCommand,
  createCashFlowMappingCommand,
  updateCashFlowMappingCommand,
  deleteCashFlowMappingCommand
} from './accountCommands'
import { saveInitialBalancesCommand } from './initialBalanceCommands'
import type { CommandContext, CommandResult } from './types'
import type { VoucherBatchAction } from '../services/voucherBatchLifecycle'
import { withAuditedCommandResult } from './auditedResult'
import {
  listCarryForwardRulesCommand,
  previewCarryForwardCommand,
  saveCarryForwardRulesCommand,
  executeCarryForwardCommand
} from './periodCommands'
import { loginCommand } from './authCommands'
import { hashPassword } from '../security/password'
import { generateReportCommand, deleteReportCommand } from './reportingCommands'
import { generateReportSnapshot } from '../services/reporting'
import {
  verifyElectronicVoucherCommand,
  parseElectronicVoucherCommand,
  convertElectronicVoucherCommand
} from './electronicVoucherCommands'
import {
  saveSubjectTemplateCommand,
  clearSubjectTemplateCommand,
  saveCustomTemplateCommand,
  clearCustomTemplateEntriesCommand,
  deleteCustomTemplateCommand
} from './settingsCommands'
import {
  saveIndependentCustomSubjectTemplate,
  saveCustomTopLevelSubjectTemplate
} from '../services/subjectTemplate'

describe('关键命令与真实审计表同事务', () => {
  let db: Database.Database
  let context: CommandContext
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys=ON')
    runDatabaseMigrations(db)
    db.exec(`
      INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1),(2,'operator',0);
      INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'隔离账套','2026-01','2026-01');
      INSERT INTO periods(ledger_id,period) VALUES(1,'2026-01');
    `)
    context = {
      db,
      actor: resolveSessionActor(db, issueSession(db, 1), 'cli'),
      runtime: { userDataPath: 'D:/isolated-audit-test' } as CommandContext['runtime'],
      outputMode: 'json',
      now: new Date('2026-09-08T00:00:00Z')
    }
  })
  afterEach(() => db.close())

  function snapshot(): unknown {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    return tables.map(({ name }) => [
      name,
      db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()
    ])
  }

  async function assertAtomic(
    run: () => Promise<CommandResult<unknown>>,
    module: string,
    action: string
  ): Promise<void> {
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'injected audit failure'); END"
    )
    const before = snapshot()
    const failed = await run()
    expect(failed.status, JSON.stringify(failed)).toBe('error')
    expect(failed.error?.message).toContain('injected audit failure')
    expect(snapshot()).toEqual(before)
    db.exec('DROP TRIGGER fail_audit')
    const succeeded = await run()
    expect(succeeded.status, JSON.stringify(succeeded)).toBe('success')
    const logs = db.prepare('SELECT * FROM operation_logs').all()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ module, action, user_id: 1, username: 'admin' })
  }

  it('创建用户与账套授权一起回滚', async () => {
    await assertAtomic(
      () =>
        createUserCommand(context, {
          username: 'new',
          realName: '新用户',
          password: 'Password123!',
          permissions: { audit: true },
          ledgerIds: [1]
        }),
      'auth',
      'create_user'
    )
  })
  it('登录失败不签发会话或修改登录偏好', async () => {
    db.prepare('UPDATE users SET password_hash=? WHERE id=1').run(hashPassword('Password123!'))
    context.actor = null
    await assertAtomic(
      () => loginCommand(context, { username: 'admin', password: 'Password123!' }),
      'auth',
      'login'
    )
  })
  it('权限变更及会话撤销版本一起回滚', async () => {
    issueSession(db, 2)
    await assertAtomic(
      () => updateUserCommand(context, { id: 2, permissions: { audit: true }, ledgerIds: [1] }),
      'auth',
      'update_permissions'
    )
  })
  it('删除用户与级联数据一起回滚', async () => {
    issueSession(db, 2)
    await assertAtomic(() => deleteUserCommand(context, { userId: 2 }), 'auth', 'delete_user')
  })
  it('注销失败保持原会话有效', async () => {
    await assertAtomic(() => logoutCommand(context), 'auth', 'logout')
  })
  it('命令在提交阶段失败也回滚业务和已经写入的日志', async () => {
    db.exec(`CREATE TABLE commit_failure(user_id INTEGER REFERENCES users(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER fail_commit AFTER INSERT ON operation_logs BEGIN INSERT INTO commit_failure VALUES(99999); END`)
    const before = snapshot()
    const result = await setUserPreferencesCommand(context, {
      preferences: { mustRollback: 'yes' }
    })
    expect(result.status).toBe('error')
    expect(result.error?.message).toContain('FOREIGN KEY')
    expect(snapshot()).toEqual(before)
  })
  it('创建账套与初始化数据一起回滚', async () => {
    await assertAtomic(
      () =>
        createLedgerCommand(context, {
          name: '新账套',
          standardType: 'npo',
          startPeriod: '2026-01'
        }),
      'ledger',
      'create'
    )
  })
  it('修改账套失败不留下新名称', async () => {
    await assertAtomic(
      () => updateLedgerCommand(context, { id: 1, name: '新名称' }),
      'ledger',
      'update'
    )
  })
  it('用户和账套的重复空更新不写成功日志', async () => {
    const before = snapshot()
    for (let i = 0; i < 2; i++) {
      expect((await updateUserCommand(context, { id: 2 })).status).toBe('success')
      expect((await updateLedgerCommand(context, { id: 1 })).status).toBe('success')
    }
    expect(snapshot()).toEqual(before)
  })
  it('密码重置与税号更新不能被公开摘要相同误判为无变更', async () => {
    expect((await updateUserCommand(context, { id: 2, password: 'reset-pass' })).status).toBe(
      'success'
    )
    expect(
      (
        await updateLedgerCommand(context, {
          id: 1,
          taxpayerIdentificationNumber: '91330000123456789X'
        })
      ).status
    ).toBe('success')
    expect(db.prepare('SELECT module,action FROM operation_logs ORDER BY id').all()).toEqual([
      { module: 'auth', action: 'update_user' },
      { module: 'ledger', action: 'update' }
    ])
    const logs = JSON.stringify(db.prepare('SELECT * FROM operation_logs').all())
    expect(logs).not.toContain('reset-pass')
    expect(logs).not.toContain('password_hash')
  })
  it('删除账套失败恢复级联数据', async () => {
    await assertAtomic(
      () => deleteLedgerCommand(context, { ledgerId: 1, riskAcknowledged: true }),
      'ledger',
      'delete'
    )
  })
  it('结账失败恢复期间与指针，重复结账不重复留成功日志', async () => {
    const run = (): Promise<CommandResult<unknown>> =>
      closePeriodCommand(context, { ledgerId: 1, period: '2026-01' })
    await assertAtomic(run, 'period', 'close')
    expect((await run()).status).toBe('success')
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('反结账失败恢复期间与指针', async () => {
    db.exec("UPDATE periods SET is_closed=1; UPDATE ledgers SET current_period='2026-02'")
    await assertAtomic(
      () => reopenPeriodCommand(context, { ledgerId: 1, period: '2026-01' }),
      'period',
      'reopen'
    )
  })
  it('偏好批量保存失败不留下部分键值', async () => {
    await assertAtomic(
      () => setUserPreferencesCommand(context, { preferences: { a: '1', b: '2' } }),
      'settings',
      'set_user_preferences'
    )
  })

  it('空偏好重复请求不写成功日志', async () => {
    for (let i = 0; i < 2; i++)
      expect((await setUserPreferencesCommand(context, { preferences: {} })).status).toBe('success')
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(0)
  })

  it('相同偏好重试不写成功日志，也不更新时间', async () => {
    const run = (): Promise<CommandResult<unknown>> =>
      setUserPreferencesCommand(context, { preferences: { key: 'same' } })
    expect((await run()).data).toEqual({ updatedKeys: ['key'] })
    const before = snapshot()
    expect((await run()).data).toEqual({ updatedKeys: [] })
    expect(snapshot()).toEqual(before)
  })
  it('已不存在的基础模板重复清空不写日志', async () => {
    const before = snapshot()
    for (let i = 0; i < 2; i++)
      expect((await clearSubjectTemplateCommand(context, { standardType: 'npo' })).status).toBe(
        'success'
      )
    expect(snapshot()).toEqual(before)
  })

  it('拒绝原始异步回调后不会继续异步写入', async () => {
    // @ts-expect-error 验证绕过 TypeScript 的调用也在执行前被拒绝
    const result = await withAuditedCommandResult(context, async () => {
      await Promise.resolve()
      db.prepare("UPDATE ledgers SET name='不应写入'").run()
    })
    expect(result.error?.message).toContain('异步回调')
    await Promise.resolve()
    expect(db.prepare('SELECT name FROM ledgers').get()).toEqual({ name: '隔离账套' })
  })

  function vouchers(status: number): void {
    db.prepare(
      `INSERT INTO vouchers(id,ledger_id,period,voucher_date,voucher_number,status,deleted_from_status) VALUES(?,1,'2026-01','2026-01-01',?,?,?)`
    ).run(1, 1, status, status === 3 ? 0 : null)
    db.prepare(
      `INSERT INTO vouchers(id,ledger_id,period,voucher_date,voucher_number,status,deleted_from_status) VALUES(?,1,'2026-01','2026-01-01',?,?,?)`
    ).run(2, 2, status, status === 3 ? 0 : null)
  }

  function subjects(): void {
    db.exec(`INSERT INTO subjects(id,ledger_id,code,name,category,is_system,is_cash_flow) VALUES
      (1,1,'1001','现金','asset',0,1),(2,1,'3001','权益','equity',0,0);
      INSERT INTO cash_flow_items(id,ledger_id,code,name,category,direction) VALUES(1,1,'CF01','测试流入','operating','inflow')`)
  }
  const entries = [
    {
      summary: '测试',
      subjectCode: '1001',
      debitAmount: '1.00',
      creditAmount: '0',
      cashFlowItemId: 1
    },
    {
      summary: '测试',
      subjectCode: '3001',
      debitAmount: '0',
      creditAmount: '1.00',
      cashFlowItemId: null
    }
  ]
  it('新增凭证和分录与审计一起回滚', async () => {
    subjects()
    await assertAtomic(
      () => createVoucherCommand(context, { ledgerId: 1, voucherDate: '2026-01-01', entries }),
      'voucher',
      'create'
    )
  })
  it('修改凭证和替换分录与审计一起回滚', async () => {
    subjects()
    vouchers(0)
    await assertAtomic(
      () =>
        updateVoucherCommand(context, {
          ledgerId: 1,
          voucherId: 1,
          voucherDate: '2026-01-02',
          entries
        }),
      'voucher',
      'update'
    )
  })
  it('交换凭证失败恢复两张凭证', async () => {
    vouchers(0)
    await assertAtomic(
      () => swapVoucherPositionsCommand(context, { voucherIds: [1, 2] }),
      'voucher',
      'swap_positions'
    )
  })
  it('重排失败恢复编号，重复整理不增加成功日志', async () => {
    vouchers(0)
    db.exec('UPDATE vouchers SET voucher_number=5 WHERE id=2')
    const run = (): Promise<CommandResult<unknown>> =>
      renumberVoucherNumbersCommand(context, { ledgerId: 1, period: '2026-01' })
    await assertAtomic(run, 'voucher', 'renumber_voucher_numbers')
    expect((await run()).data).toMatchObject({ updatedCount: 0 })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('科目新增失败恢复父子科目关系', async () => {
    subjects()
    await assertAtomic(
      () =>
        createSubjectCommand(context, {
          ledgerId: 1,
          parentCode: '1001',
          code: '100101',
          name: '子科目',
          auxiliaryCategories: [],
          isCashFlow: false
        }),
      'subject',
      'create'
    )
  })
  it('科目修改失败恢复名称', async () => {
    subjects()
    await assertAtomic(
      () => updateSubjectCommand(context, { subjectId: 1, name: '新科目名' }),
      'subject',
      'update'
    )
  })
  it('科目删除失败恢复记录', async () => {
    subjects()
    await assertAtomic(() => deleteSubjectCommand(context, { subjectId: 1 }), 'subject', 'delete')
  })
  it.each(['create', 'update', 'delete'] as const)('辅助项目 %s 与日志原子', async (action) => {
    if (action !== 'create')
      db.exec(
        "INSERT INTO auxiliary_items(id,ledger_id,category,code,name) VALUES(1,1,'customer','A','客户')"
      )
    const run = (): Promise<CommandResult<unknown>> =>
      action === 'create'
        ? createAuxiliaryItemCommand(context, {
            ledgerId: 1,
            category: 'customer',
            code: 'A',
            name: '客户'
          })
        : action === 'update'
          ? updateAuxiliaryItemCommand(context, { id: 1, name: '新客户' })
          : deleteAuxiliaryItemCommand(context, { id: 1 })
    await assertAtomic(run, 'auxiliary', action)
  })
  it.each(['create', 'update', 'delete'] as const)('现金流映射 %s 与日志原子', async (action) => {
    subjects()
    if (action !== 'create')
      db.exec(
        "INSERT INTO cash_flow_mappings(id,ledger_id,subject_code,counterpart_subject_code,entry_direction,cash_flow_item_id) VALUES(1,1,'1001','3001','inflow',1)"
      )
    const payload = {
      subjectCode: '1001',
      counterpartSubjectCode: '3001',
      entryDirection: 'outflow',
      cashFlowItemId: 1
    }
    const run = (): Promise<CommandResult<unknown>> =>
      action === 'create'
        ? createCashFlowMappingCommand(context, { ledgerId: 1, ...payload })
        : action === 'update'
          ? updateCashFlowMappingCommand(context, { id: 1, ...payload })
          : deleteCashFlowMappingCommand(context, { id: 1 })
    await assertAtomic(run, 'cashflow', `${action}_mapping`)
  })
  it('期初余额替换失败保持旧余额', async () => {
    subjects()
    await assertAtomic(
      () => saveInitialBalancesCommand(context, { ledgerId: 1, period: '2026-01', entries }),
      'initial_balance',
      'save'
    )
  })
  it('系统参数更新失败回滚，重复值不增加成功日志', async () => {
    const run = (): Promise<CommandResult<unknown>> =>
      setSystemParamCommand(context, { key: 'default_voucher_word', value: '转' })
    await assertAtomic(run, 'settings', 'set_system_param')
    expect((await run()).data).toMatchObject({ changed: false })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('报表快照生成与成功日志一起回滚', async () => {
    await assertAtomic(
      () =>
        generateReportCommand(context, {
          ledgerId: 1,
          reportType: 'balance_sheet',
          month: '2026-01'
        }),
      'reporting',
      'generate_snapshot'
    )
  })
  it('报表快照删除与成功日志一起回滚', async () => {
    const report = generateReportSnapshot(db, {
      ledgerId: 1,
      reportType: 'balance_sheet',
      month: '2026-01'
    })
    await assertAtomic(
      () => deleteReportCommand(context, { ledgerId: 1, snapshotId: report.id }),
      'reporting',
      'delete_snapshot'
    )
  })
  it.each(['verify', 'parse', 'convert'] as const)(
    '电子凭证 %s 纯DB阶段与日志原子',
    async (action) => {
      fs.mkdirSync('.tmp', { recursive: true })
      const folder = fs.mkdtempSync(path.resolve('.tmp', 'electronic-atomic-'))
      const file = path.join(folder, 'invoice.pdf')
      const bytes = Buffer.from('%PDF-1.4\n%%EOF\n')
      fs.writeFileSync(file, bytes)
      db.prepare(
        `INSERT INTO electronic_voucher_files(id,ledger_id,original_name,stored_name,stored_path,sha256) VALUES(1,1,'invoice.pdf','invoice.pdf',?,?)`
      ).run(file, createHash('sha256').update(bytes).digest('hex'))
      db.exec(`INSERT INTO electronic_voucher_records(id,ledger_id,file_id,voucher_type,fingerprint,status,source_number,source_date,amount_cents) VALUES(1,1,1,'digital_invoice','initial-fingerprint','${action === 'convert' ? 'parsed' : 'verified'}','A','2026-01-01',100);
      INSERT INTO electronic_voucher_verifications(record_id,verification_status,verification_method,verification_message) VALUES(1,'verified','manual-evidence-v1','已通过原件人工核验')`)
      const run = (): Promise<CommandResult<unknown>> =>
        action === 'verify'
          ? verifyElectronicVoucherCommand(context, { recordId: 1 })
          : action === 'parse'
            ? parseElectronicVoucherCommand(context, { recordId: 1, sourceNumber: 'A' })
            : convertElectronicVoucherCommand(context, { recordId: 1 })
      try {
        await assertAtomic(run, 'electronic_voucher', action)
      } finally {
        fs.rmSync(folder, { recursive: true, force: true })
      }
    }
  )
  it.each(['save', 'clear'] as const)('基础科目模板 %s 与日志原子', async (action) => {
    const payload = {
      standardType: 'npo' as const,
      templateName: '隔离模板',
      entries: [
        { code: '1001', name: '现金', category: 'asset' as const, balanceDirection: 1 as const }
      ]
    }
    if (action === 'clear') saveCustomTopLevelSubjectTemplate(db, payload)
    await assertAtomic(
      () =>
        action === 'save'
          ? saveSubjectTemplateCommand(context, payload)
          : clearSubjectTemplateCommand(context, { standardType: 'npo' }),
      'settings',
      `${action}_subject_template`
    )
  })
  it.each(['save', 'clear', 'delete'] as const)('独立模板 %s 与日志原子', async (action) => {
    const payload = {
      baseStandardType: 'npo' as const,
      templateName: '隔离模板',
      entries: [
        { code: '1001', name: '现金', category: 'asset' as const, balanceDirection: 1 as const }
      ]
    }
    const templateId = action === 'save' ? '' : saveIndependentCustomSubjectTemplate(db, payload).id
    const run = (): Promise<CommandResult<unknown>> =>
      action === 'save'
        ? saveCustomTemplateCommand(context, payload)
        : action === 'clear'
          ? clearCustomTemplateEntriesCommand(context, { templateId })
          : deleteCustomTemplateCommand(context, { templateId })
    await assertAtomic(
      run,
      'settings',
      action === 'save'
        ? 'create_independent_custom_subject_template'
        : action === 'clear'
          ? 'clear_independent_custom_subject_template_entries'
          : 'delete_independent_custom_subject_template'
    )
  })
  it.each<[VoucherBatchAction, number]>([
    ['audit', 0],
    ['bookkeep', 1],
    ['unbookkeep', 2],
    ['unaudit', 1],
    ['delete', 0],
    ['restoreDelete', 3],
    ['purgeDelete', 3]
  ])('批量 %s 整批回滚并只留一条成功日志', async (action, status) => {
    vouchers(status)
    const run = (): Promise<CommandResult<unknown>> =>
      voucherBatchActionCommand(context, {
        action,
        voucherIds: [1, 2],
        reason: '隔离回归',
        approvalTag: 'APPROVED-TEST'
      })
    await assertAtomic(run, 'voucher', action)
    if (action !== 'purgeDelete') expect((await run()).data).toMatchObject({ processedCount: 0 })
    else expect((await run()).status).toBe('error')
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('批处理中第二条 SQL 失败回滚第一条，不写成功日志', async () => {
    vouchers(0)
    db.exec(
      "CREATE TRIGGER fail_second BEFORE UPDATE ON vouchers WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'second failed'); END"
    )
    const before = snapshot()
    const result = await voucherBatchActionCommand(context, { action: 'audit', voucherIds: [1, 2] })
    expect(result.error?.message).toContain('second failed')
    expect(snapshot()).toEqual(before)
  })

  it('跨账套批次按账套留痕，第二账套日志失败回滚整批', async () => {
    vouchers(0)
    db.exec(
      `INSERT INTO ledgers(id,name,start_period,current_period) VALUES(2,'第二账套','2026-01','2026-01'); UPDATE vouchers SET ledger_id=2 WHERE id=2`
    )
    const run = (): Promise<CommandResult<unknown>> =>
      voucherBatchActionCommand(context, { action: 'audit', voucherIds: [1, 2] })
    db.exec(
      "CREATE TRIGGER fail_second_log BEFORE INSERT ON operation_logs WHEN NEW.ledger_id=2 BEGIN SELECT RAISE(ABORT,'second log failed'); END"
    )
    const before = snapshot()
    expect((await run()).error?.message).toContain('second log failed')
    expect(snapshot()).toEqual(before)
    db.exec('DROP TRIGGER fail_second_log')
    expect((await run()).data).toMatchObject({ processedCount: 2 })
    expect(
      db.prepare('SELECT ledger_id,target_id FROM operation_logs ORDER BY ledger_id').all()
    ).toEqual([
      { ledger_id: 1, target_id: '1' },
      { ledger_id: 2, target_id: '2' }
    ])
    expect((await run()).data).toMatchObject({ processedCount: 0 })
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(2)
  })

  function inheritedRules(): void {
    db.exec(`INSERT INTO subjects(ledger_id,code,name,category,balance_direction) VALUES
      (1,'6001','收入父级','profit_loss',-1),(1,'600101','收入甲','profit_loss',-1),
      (1,'600102','收入乙','profit_loss',-1),(1,'4103','本年利润','equity',-1);
      INSERT INTO pl_carry_forward_rules(ledger_id,from_subject_code,to_subject_code) VALUES(1,'600101','4103')`)
  }
  it.each(['list', 'preview'] as const)('规则 %s 隐式补齐必须与日志原子', async (action) => {
    inheritedRules()
    const run = (): Promise<CommandResult<unknown>> =>
      action === 'list'
        ? listCarryForwardRulesCommand(context, { ledgerId: 1 })
        : previewCarryForwardCommand(context, { ledgerId: 1, period: '2026-01' })
    await assertAtomic(run, 'plCarryForward', 'auto_attach_rules')
    expect((await run()).status).toBe('success')
    expect(db.prepare('SELECT * FROM operation_logs').all()).toHaveLength(1)
  })
  it('规则预览后续校验失败撤销前面的继承补齐', async () => {
    inheritedRules()
    db.exec(
      "INSERT INTO subjects(ledger_id,code,name,category) VALUES(1,'6401','未配置费用','profit_loss')"
    )
    const before = snapshot()
    const result = await previewCarryForwardCommand(context, { ledgerId: 1, period: '2026-01' })
    expect(result.status).toBe('error')
    expect(snapshot()).toEqual(before)
  })
  it('普通账套访问用户的确定性继承补齐留真实操作者', async () => {
    inheritedRules()
    db.exec('INSERT INTO user_ledger_permissions(user_id,ledger_id) VALUES(2,1)')
    context.actor = resolveSessionActor(db, issueSession(db, 2), 'ipc')
    expect((await listCarryForwardRulesCommand(context, { ledgerId: 1 })).status).toBe('success')
    expect(db.prepare('SELECT user_id,username,action FROM operation_logs').all()).toEqual([
      { user_id: 2, username: 'operator', action: 'auto_attach_rules' }
    ])
  })
  it('规则替换失败恢复旧规则', async () => {
    inheritedRules()
    await assertAtomic(
      () =>
        saveCarryForwardRulesCommand(context, {
          ledgerId: 1,
          rules: [
            { fromSubjectCode: '600101', toSubjectCode: '4103' },
            { fromSubjectCode: '600102', toSubjectCode: '4103' }
          ]
        }),
      'plCarryForward',
      'saveRules'
    )
  })
  it('执行损益结转失败回滚派生规则、凭证和分录', async () => {
    inheritedRules()
    vouchers(2)
    db.exec(
      "INSERT INTO voucher_entries(voucher_id,row_order,summary,subject_code,debit_amount,credit_amount) VALUES(1,1,'收入','600101',0,1000)"
    )
    await assertAtomic(
      () => executeCarryForwardCommand(context, { ledgerId: 1, period: '2026-01' }),
      'plCarryForward',
      'execute'
    )
  })
})

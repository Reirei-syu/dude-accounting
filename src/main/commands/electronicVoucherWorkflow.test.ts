import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { createCurrentSchema } from '../database/schema'
import { validateSchema } from '../database/migrationSchema'
import { listAuditableOperations } from '../services/fileOperationAudit'
import { issueSession, resolveSessionActor } from '../security/sessionAuthority'
import { createNodeRuntimeContext } from '../runtime/runtimeContext'
import { createVoucherCommand } from './voucherCommands'
import {
  convertElectronicVoucherCommand,
  importElectronicVoucherCommand,
  linkElectronicVoucherCommand,
  listElectronicVouchersCommand,
  parseElectronicVoucherCommand,
  verifyElectronicVoucherCommand
} from './electronicVoucherCommands'
import type { CommandContext, CommandResult } from './types'

describe('电子凭证离线闭环（真实 SQLite 与文件）', () => {
  let folder: string
  let db: Database.Database
  let context: CommandContext
  beforeEach(() => {
    fs.mkdirSync('.tmp', { recursive: true })
    folder = fs.mkdtempSync(path.resolve('.tmp', 'electronic-workflow-'))
    db = new Database(path.join(folder, 'app.db'))
    db.pragma('foreign_keys = ON')
    runDatabaseMigrations(db)
    db.exec(`INSERT INTO users(id,username,is_admin) VALUES(1,'admin',1),(2,'denied',0);
      INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'隔离账套','2026-01','2026-01'),(2,'其他账套','2026-01','2026-01');
      INSERT INTO periods(ledger_id,period) VALUES(1,'2026-01'),(2,'2026-01');
      INSERT INTO subjects(ledger_id,code,name,category,balance_direction) VALUES(1,'1001','现金','asset',1),(1,'3001','资本','equity',-1);
    `)
    context = {
      db,
      actor: resolveSessionActor(db, issueSession(db, 1), 'cli'),
      runtime: createNodeRuntimeContext({ userDataPath: folder }),
      outputMode: 'json',
      now: new Date('2026-09-09')
    }
  })
  afterEach(() => {
    db.close()
    fs.rmSync(folder, { recursive: true, force: true })
  })
  function success<T>(result: CommandResult<T>): T {
    expect(result.status, JSON.stringify(result)).toBe('success')
    return result.data!
  }
  function source(name = 'invoice.pdf', content = '%PDF-1.4\n%%EOF\n'): number {
    const file = path.join(folder, `${randomUUID()}-${name}`)
    fs.writeFileSync(file, content)
    const fileId = db
      .prepare(
        `INSERT INTO electronic_voucher_files(ledger_id,original_name,stored_name,stored_path,sha256,file_size)
      VALUES(1,?,?,?,?,?)`
      )
      .run(
        name,
        path.basename(file),
        file,
        createHash('sha256').update(content).digest('hex'),
        Buffer.byteLength(content)
      ).lastInsertRowid
    return Number(
      db
        .prepare(
          `INSERT INTO electronic_voucher_records(ledger_id,file_id,voucher_type,fingerprint)
      VALUES(1,?,'digital_invoice',?)`
        )
        .run(fileId, randomUUID()).lastInsertRowid
    )
  }
  async function verified(recordId: number): Promise<void> {
    expect(
      success(
        await verifyElectronicVoucherCommand(context, {
          recordId,
          verificationStatus: 'verified',
          manualConfirmation: true,
          verificationMessage: '已通过原件渠道核验并人工复核'
        })
      ).verificationStatus
    ).toBe('verified')
  }
  async function parsed(recordId: number, sourceNumber = 'INV-1'): Promise<void> {
    await verified(recordId)
    success(
      await parseElectronicVoucherCommand(context, {
        recordId,
        sourceNumber,
        sourceDate: '2026-01-02',
        amountCents: 10000
      })
    )
  }
  function record(recordId: number): Record<string, unknown> {
    return db
      .prepare('SELECT * FROM electronic_voucher_records WHERE id = ?')
      .get(recordId) as Record<string, unknown>
  }
  const entries = [
    {
      summary: '来源复核',
      subjectCode: '1001',
      debitAmount: '100',
      creditAmount: '',
      cashFlowItemId: null
    },
    {
      summary: '来源复核',
      subjectCode: '3001',
      debitAmount: '',
      creditAmount: '100',
      cashFlowItemId: null
    }
  ]

  it.each(['cli', 'ipc'] as const)('%s 默认只检查完整性，不根据文件名假装验真', async (surface) => {
    context.actor!.source = surface
    const id = source()
    expect(
      success(await verifyElectronicVoucherCommand(context, { recordId: id })).verificationStatus
    ).toBe('pending')
    expect(record(id).status).toBe('imported')
    expect((await parseElectronicVoucherCommand(context, { recordId: id })).status).toBe('error')
    expect((await convertElectronicVoucherCommand(context, { recordId: id })).status).toBe('error')
    expect(String(record(id).last_error)).toContain('核验')
    expect(
      listAuditableOperations(db, { status: 'failed' }).some((row) => row.action === 'parse_failed')
    ).toBe(true)
  })
  it.each([
    { verificationMethod: 'qa' },
    { manualConfirmation: true },
    { verificationMessage: '有依据' }
  ])('不得绕过明确人工确认和依据 %j', async (extra) => {
    const id = source()
    expect(
      (
        await verifyElectronicVoucherCommand(context, {
          recordId: id,
          verificationStatus: 'verified',
          ...extra
        })
      ).status
    ).toBe('error')
    expect(record(id).status).toBe('imported')
  })
  it.each(['invoice.ofd', 'receipt.xml', 'invoice.zip'])(
    '不支持格式 %s 始终待核验',
    async (name) => {
      const id = source(name)
      expect(
        success(
          await verifyElectronicVoucherCommand(context, {
            recordId: id,
            verificationStatus: 'verified',
            manualConfirmation: true,
            verificationMessage: '人工依据'
          })
        ).verificationStatus
      ).toBe('pending')
      expect(record(id).status).toBe('imported')
    }
  )
  it.each(['missing', 'tampered', 'malformed'])('异常原件 %s 被拒绝', async (mode) => {
    const id = source('invoice.pdf', mode === 'malformed' ? 'not PDF' : undefined)
    const file = (
      db
        .prepare('SELECT stored_path FROM electronic_voucher_files WHERE id = ?')
        .get(record(id).file_id) as { stored_path: string }
    ).stored_path
    if (mode === 'missing') fs.unlinkSync(file)
    if (mode === 'tampered') fs.appendFileSync(file, 'changed')
    expect(
      success(
        await verifyElectronicVoucherCommand(context, {
          recordId: id,
          verificationStatus: 'verified',
          manualConfirmation: true,
          verificationMessage: '不能绕过文件'
        })
      ).verificationStatus
    ).toBe('failed')
    expect(record(id).status).toBe('rejected')
  })
  it('历史无依据 verified 和伪 converted 不能直接复用，但可重新核验', async () => {
    const id = source()
    db.prepare("UPDATE electronic_voucher_records SET status='converted' WHERE id=?").run(id)
    db.prepare(
      "INSERT INTO electronic_voucher_verifications(record_id,verification_status,verification_method) VALUES(?,'verified','manual')"
    ).run(id)
    expect((await parseElectronicVoucherCommand(context, { recordId: id })).status).toBe('error')
    await parsed(id)
    expect(record(id).status).toBe('parsed')
  })
  it.each([
    { sourceNumber: '' },
    { sourceDate: '2026-02-30' },
    { amountCents: 1.5 },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 }
  ])('结构化数据拒绝无效值 %j', async (invalid) => {
    const id = source()
    await verified(id)
    expect(
      (
        await parseElectronicVoucherCommand(context, {
          recordId: id,
          sourceNumber: 'INV',
          sourceDate: '2026-01-02',
          amountCents: 100,
          ...invalid
        })
      ).status
    ).toBe('error')
    expect(record(id).status).toBe('verified')
  })
  it('同类型同号即使日期金额不同仍阻止，省略字段保留已有复核数据', async () => {
    const first = source()
    await parsed(first)
    success(
      await parseElectronicVoucherCommand(context, { recordId: first, counterpartName: '客户' })
    )
    expect(record(first)).toMatchObject({
      source_number: 'INV-1',
      amount_cents: 10000,
      counterpart_name: '客户'
    })
    const second = source('invoice2.pdf', '%PDF-1.4\nsecond\n%%EOF')
    await verified(second)
    expect(
      (
        await parseElectronicVoucherCommand(context, {
          recordId: second,
          sourceNumber: ' INV-1 ',
          sourceDate: '2026-01-03',
          amountCents: 1
        })
      ).error?.code
    ).toBe('CONFLICT')
  })
  it('预填可重复获取但不入账；保存原子关联且重复保存失败', async () => {
    const id = source()
    await parsed(id)
    const draft = success(
      await convertElectronicVoucherCommand(context, { recordId: id })
    ).draftVoucher
    success(await convertElectronicVoucherCommand(context, { recordId: id }))
    expect(record(id).status).toBe('parsed')
    expect(db.prepare('SELECT * FROM vouchers').all()).toHaveLength(0)
    const payload = { ...draft, entries }
    const saved = success(await createVoucherCommand(context, payload))
    expect(record(id).status).toBe('converted')
    expect(db.prepare('SELECT voucher_id FROM voucher_source_links').get()).toEqual({
      voucher_id: saved.voucherId
    })
    expect((await createVoucherCommand(context, payload)).error?.code).toBe('CONFLICT')
    expect(db.prepare('SELECT * FROM vouchers').all()).toHaveLength(1)
    expect(
      success(await listElectronicVouchersCommand(context, { ledgerId: 1 }))[0].linked_voucher_id
    ).toBe(saved.voucherId)
    expect((await verifyElectronicVoucherCommand(context, { recordId: id })).error?.code).toBe(
      'CONFLICT'
    )
  })
  it('过期指纹与跨账套来源不允许保存', async () => {
    const id = source()
    await parsed(id)
    const draft = success(
      await convertElectronicVoucherCommand(context, { recordId: id })
    ).draftVoucher
    expect(
      (await createVoucherCommand(context, { ...draft, entries, sourceFingerprint: 'old' })).error
        ?.code
    ).toBe('CONFLICT')
    expect((await createVoucherCommand(context, { ...draft, entries, ledgerId: 2 })).status).toBe(
      'error'
    )
    expect(db.prepare('SELECT * FROM vouchers').all()).toHaveLength(0)
  })
  it('保存中日志故障回滚分录、来源关联与状态，恢复后可重试', async () => {
    const id = source()
    await parsed(id)
    const draft = success(
      await convertElectronicVoucherCommand(context, { recordId: id })
    ).draftVoucher
    db.exec(
      "CREATE TRIGGER fail_log BEFORE INSERT ON operation_logs BEGIN SELECT RAISE(ABORT,'audit failure'); END"
    )
    expect((await createVoucherCommand(context, { ...draft, entries })).status).toBe('error')
    expect(record(id)).toMatchObject({ status: 'parsed', last_error: null })
    expect(db.prepare('SELECT * FROM vouchers').all()).toHaveLength(0)
    expect(db.prepare('SELECT * FROM voucher_source_links').all()).toHaveLength(0)
    db.exec('DROP TRIGGER fail_log')
    success(await createVoucherCommand(context, { ...draft, entries }))
  })
  it('仅同账套已记账凭证可补充来源，不修改原凭证内容', async () => {
    const id = source()
    await parsed(id)
    const saved = success(
      await createVoucherCommand(context, { ledgerId: 1, voucherDate: '2026-01-02', entries })
    )
    const payload = {
      recordId: id,
      voucherId: saved.voucherId,
      sourceFingerprint: String(record(id).fingerprint)
    }
    expect((await linkElectronicVoucherCommand(context, payload)).status).toBe('error')
    db.prepare('UPDATE vouchers SET status=2 WHERE id=?').run(saved.voucherId)
    const before = db.prepare('SELECT * FROM vouchers').all()
    success(await linkElectronicVoucherCommand(context, payload))
    expect(db.prepare('SELECT * FROM vouchers').all()).toEqual(before)
    expect((await linkElectronicVoucherCommand(context, payload)).error?.code).toBe('CONFLICT')
  })
  it('撤权后任何处理和失败记录均不得改写', async () => {
    const id = source()
    context.actor = resolveSessionActor(db, issueSession(db, 2), 'ipc')
    const before = record(id)
    expect((await verifyElectronicVoucherCommand(context, { recordId: id })).status).toBe('error')
    expect(record(id)).toEqual(before)
  })
  it.each(['native', 'wsl'] as const)(
    '%s 显式路径导入同一存档目录，改名同文件不能再次导入',
    async (surface) => {
      const file = path.join(folder, 'receipt.pdf')
      fs.writeFileSync(file, '%PDF-1.4\nreceipt\n%%EOF')
      const sourcePath =
        surface === 'wsl' && process.platform === 'win32'
          ? `/mnt/${file[0].toLowerCase()}${file.slice(2).replaceAll('\\', '/')}`
          : file
      const imported = success(
        await importElectronicVoucherCommand(context, {
          ledgerId: 1,
          sourcePath,
          operationId: randomUUID()
        })
      )
      const row = success(await listElectronicVouchersCommand(context, { ledgerId: 1 }))[0]
      expect(row.id).toBe(imported.recordId)
      expect(row.stored_path.startsWith(path.join(folder, 'electronic-vouchers', 'ledger-1'))).toBe(
        true
      )
      const copy = path.join(folder, 'renamed.pdf')
      fs.copyFileSync(file, copy)
      expect(
        (
          await importElectronicVoucherCommand(context, {
            ledgerId: 1,
            sourcePath: copy,
            operationId: randomUUID()
          })
        ).status
      ).toBe('error')
      expect(db.prepare('SELECT * FROM electronic_voucher_records').all()).toHaveLength(1)
    }
  )
  it('隐式相对路径不允许导入', async () => {
    expect(
      (
        await importElectronicVoucherCommand(context, {
          ledgerId: 1,
          sourcePath: 'invoice.pdf',
          operationId: randomUUID()
        })
      ).error?.code
    ).toBe('VALIDATION_ERROR')
  })
  it('版本5保留原件及状态升级到6，重复来源迁移失败且不删除历史关联', () => {
    const old = new Database(path.join(folder, 'old.db'))
    try {
      createCurrentSchema(old, 5)
      old.pragma('user_version = 5')
      old.exec(
        "INSERT INTO electronic_voucher_files(id,ledger_id,original_name,stored_name,stored_path,sha256) VALUES(1,1,'legacy.pdf','legacy.pdf','legacy.pdf','legacy-hash')"
      )
      old.exec(
        "INSERT INTO electronic_voucher_records(ledger_id,file_id,voucher_type,fingerprint) VALUES(1,1,'unknown','legacy')"
      )
      expect(runDatabaseMigrations(old).applied).toEqual([6])
      expect(
        old.prepare('SELECT fingerprint,last_error FROM electronic_voucher_records').get()
      ).toEqual({ fingerprint: 'legacy', last_error: null })
      validateSchema(old)
    } finally {
      old.close()
    }
    const conflict = new Database(path.join(folder, 'conflict.db'))
    try {
      createCurrentSchema(conflict, 5)
      conflict.pragma('user_version = 5')
      conflict.exec(
        "INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'历史账套','2026-01','2026-01'); INSERT INTO vouchers(id,ledger_id,period,voucher_date,voucher_number) VALUES(1,1,'2026-01','2026-01-01',1),(2,1,'2026-01','2026-01-01',2)"
      )
      conflict.exec(
        "INSERT INTO voucher_source_links(voucher_id,source_type,source_record_id) VALUES(1,'electronic_voucher',1),(2,'electronic_voucher',1)"
      )
      expect(() => runDatabaseMigrations(conflict)).toThrow('迁移失败')
      expect(conflict.pragma('user_version', { simple: true })).toBe(5)
      expect(conflict.prepare('SELECT * FROM voucher_source_links').all()).toHaveLength(2)
    } finally {
      conflict.close()
    }
  })
})

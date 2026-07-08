import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const voucherCommandMocks = vi.hoisted(() => ({
  assertPeriodWritable: vi.fn(),
  createVoucherWithEntries: vi.fn(),
  updateVoucherWithEntries: vi.fn(),
  renumberVoucherNumbers: vi.fn(),
  appendActorOperationLog: vi.fn(),
  requireCommandPermission: vi.fn((actor) => actor),
  requireCommandLedgerAccess: vi.fn()
}))

vi.mock('../services/periodState', async () => {
  const actual = await vi.importActual('../services/periodState')
  return {
    ...(actual as object),
    assertPeriodWritable: voucherCommandMocks.assertPeriodWritable
  }
})

vi.mock('../services/voucherLifecycle', async () => {
  const actual = await vi.importActual('../services/voucherLifecycle')
  return {
    ...(actual as object),
    createVoucherWithEntries: voucherCommandMocks.createVoucherWithEntries,
    updateVoucherWithEntries: voucherCommandMocks.updateVoucherWithEntries
  }
})

vi.mock('../services/voucherNumberLifecycle', async () => {
  const actual = await vi.importActual('../services/voucherNumberLifecycle')
  return {
    ...(actual as object),
    renumberVoucherNumbers: voucherCommandMocks.renumberVoucherNumbers
  }
})

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandPermission: voucherCommandMocks.requireCommandPermission,
    requireCommandLedgerAccess: voucherCommandMocks.requireCommandLedgerAccess
  }
})

vi.mock('./operationLog', () => ({
  appendActorOperationLog: voucherCommandMocks.appendActorOperationLog
}))

import {
  createVoucherCommand,
  exportVoucherEditPayloadCommand,
  listVouchersCommand,
  renumberVoucherNumbersCommand,
  updateVoucherCommand
} from './voucherCommands'
import { CommandError } from './types'
import { VoucherNumberRenumberValidationError } from '../services/voucherNumberLifecycle'

describe('voucherCommands', () => {
  const currentPeriodQuery = {
    get: vi.fn(() => ({ current_period: '2026-01' }))
  }
  const systemSettingsQuery = {
    get: vi.fn(() => undefined)
  }
  const cashFlowItemQuery = {
    get: vi.fn((_ledgerId, code) => (String(code) === 'CF01' ? { id: 161 } : undefined))
  }
  const voucherQuery = {
    get: vi.fn(() => ({
      id: 43,
      ledger_id: 8,
      voucher_number: 1,
      status: 0
    }))
  }
  const voucherEditQuery = {
    get: vi.fn(() => ({
      id: 43,
      ledger_id: 8,
      period: '2026-01',
      voucher_date: '2026-01-03',
      status: 0
    }))
  }
  const voucherEntriesQuery = {
    all: vi.fn(() => [
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '1002',
        debit_amount: 300000,
        credit_amount: 0,
        cash_flow_item_id: 161
      },
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '2206',
        debit_amount: 0,
        credit_amount: 2000,
        cash_flow_item_id: null
      },
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '430101',
        debit_amount: 0,
        credit_amount: 298000,
        cash_flow_item_id: null
      }
    ])
  }
  const voucherListQuery = {
    all: vi.fn(() => [])
  }

  const context = {
    db: {
      prepare: vi.fn((sql: string) => {
        if (sql === 'SELECT current_period FROM ledgers WHERE id = ?') {
          return currentPeriodQuery
        }
        if (sql === 'SELECT value FROM system_settings WHERE key = ?') {
          return systemSettingsQuery
        }
        if (sql === 'SELECT id FROM cash_flow_items WHERE ledger_id = ? AND code = ?') {
          return cashFlowItemQuery
        }
        if (
          sql.includes('SELECT id, ledger_id, voucher_number, status') &&
          sql.includes('FROM vouchers')
        ) {
          return voucherQuery
        }
        if (
          sql.includes('SELECT id, ledger_id, period, voucher_date, status') &&
          sql.includes('FROM vouchers')
        ) {
          return voucherEditQuery
        }
        if (sql.includes('FROM voucher_entries ve') && sql.includes('ORDER BY ve.row_order ASC')) {
          return voucherEntriesQuery
        }
        if (
          sql.includes('SELECT') &&
          sql.includes('FROM vouchers v') &&
          sql.includes('INNER JOIN voucher_entries ve')
        ) {
          return voucherListQuery
        }
        throw new Error(`unexpected sql: ${sql}`)
      })
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {
        voucher_entry: true
      },
      isAdmin: true,
      source: 'cli' as const
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-23T08:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    currentPeriodQuery.get.mockReturnValue({ current_period: '2026-01' })
    systemSettingsQuery.get.mockReturnValue(undefined)
    cashFlowItemQuery.get.mockImplementation((_ledgerId, code) =>
      String(code) === 'CF01' ? { id: 161 } : undefined
    )
    voucherQuery.get.mockReturnValue({
      id: 43,
      ledger_id: 8,
      voucher_number: 1,
      status: 0
    })
    voucherEditQuery.get.mockReturnValue({
      id: 43,
      ledger_id: 8,
      period: '2026-01',
      voucher_date: '2026-01-03',
      status: 0
    })
    voucherEntriesQuery.all.mockReturnValue([
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '1002',
        debit_amount: 300000,
        credit_amount: 0,
        cash_flow_item_id: 161
      },
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '2206',
        debit_amount: 0,
        credit_amount: 2000,
        cash_flow_item_id: null
      },
      {
        summary: '收到客户付款活动款（张三）',
        subject_code: '430101',
        debit_amount: 0,
        credit_amount: 298000,
        cash_flow_item_id: null
      }
    ])
    voucherListQuery.all.mockReturnValue([])
    voucherCommandMocks.createVoucherWithEntries.mockReturnValue({
      voucherId: 43,
      voucherNumber: 1,
      status: 0
    })
    voucherCommandMocks.updateVoucherWithEntries.mockReturnValue(undefined)
    voucherCommandMocks.renumberVoucherNumbers.mockReturnValue({
      ledgerId: 8,
      period: '2026-01',
      totalCount: 2,
      updatedCount: 1,
      groups: [
        {
          voucherWord: '记',
          totalCount: 2,
          activeCount: 2,
          deletedCount: 0,
          updatedCount: 1,
          firstNumber: 1,
          lastNumber: 2
        }
      ],
      changes: [
        {
          voucherId: 44,
          voucherWord: '记',
          status: 1,
          deletedFromStatus: null,
          oldNumber: 3,
          newNumber: 2
        }
      ]
    })
  })

  it('normalizes agent-style voucher save payload aliases before invoking lifecycle', async () => {
    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      period: '2026-01',
      date: '2026-01-03',
      number: 1,
      description: '收到客户付款活动款（张三）',
      entries: [
        {
          subjectCode: 1002,
          debit: 3000,
          credit: 0,
          cashflowItemCode: 'CF01',
          auxiliaries: []
        },
        {
          subjectCode: '2206',
          debit: 0,
          credit: 20,
          auxiliaries: []
        },
        {
          subjectCode: '430101',
          debit: 0,
          credit: 2980,
          auxiliaries: []
        }
      ]
    } as never)

    expect(result.status).toBe('success')
    expect(voucherCommandMocks.createVoucherWithEntries).toHaveBeenCalledWith(
      context.db,
      expect.objectContaining({
        ledgerId: 8,
        period: '2026-01',
        voucherDate: '2026-01-03',
        creatorId: 1,
        entries: [
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '1002',
            debitAmount: '3000',
            creditAmount: '0',
            cashFlowItemId: 161
          },
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '2206',
            debitAmount: '0',
            creditAmount: '20',
            cashFlowItemId: null
          },
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '430101',
            debitAmount: '0',
            creditAmount: '2980',
            cashFlowItemId: null
          }
        ]
      })
    )
  })

  it('recovers classic mojibake voucher descriptions before invoking lifecycle', async () => {
    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      period: '2026-01',
      date: '2026-01-03',
      description: '鏀粯瀵硅处鍗曟墜缁垂',
      entries: [
        {
          subjectCode: 1002,
          debit: 3.8,
          credit: 0,
          cashflowItemCode: 'CF01'
        },
        {
          subjectCode: '430101',
          debit: 0,
          credit: 3.8
        }
      ]
    } as never)

    expect(result.status).toBe('success')
    expect(voucherCommandMocks.createVoucherWithEntries).toHaveBeenCalledWith(
      context.db,
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            summary: '支付对账单手续费',
            subjectCode: '1002'
          }),
          expect.objectContaining({
            summary: '支付对账单手续费',
            subjectCode: '430101'
          })
        ]
      })
    )
  })

  it('rejects unrecoverable corrupted voucher summaries before invoking lifecycle', async () => {
    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      period: '2026-01',
      date: '2026-01-03',
      entries: [
        {
          summary: '�յ���������Ϣ',
          subjectCode: 1002,
          debit: 3.8,
          credit: 0
        },
        {
          summary: '�յ���������Ϣ',
          subjectCode: '430101',
          debit: 0,
          credit: 3.8
        }
      ]
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('疑似包含中文乱码')
    })
    expect(voucherCommandMocks.createVoucherWithEntries).not.toHaveBeenCalled()
  })

  it('returns a clear validation error when voucherDate/date is missing', async () => {
    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      entries: []
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '缺少凭证日期字段 voucherDate（兼容别名 date）',
      details: {
        field: 'voucherDate'
      }
    })
  })

  it('returns a clear validation error when voucher date is outside current period', async () => {
    currentPeriodQuery.get.mockReturnValueOnce({ current_period: '2026-02' })

    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      voucherDate: '2026-01-03',
      entries: []
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '凭证日期所属期间（2026-01）与当前会计期间（2026-02）不一致',
      details: {
        ledgerId: 8,
        currentPeriod: '2026-02',
        requestedPeriod: '2026-01',
        voucherDate: '2026-01-03'
      }
    })
    expect(voucherCommandMocks.createVoucherWithEntries).not.toHaveBeenCalled()
  })

  it('returns a clear validation error when ledger current period is missing', async () => {
    currentPeriodQuery.get.mockReturnValueOnce({ current_period: '' })

    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      voucherDate: '2026-01-03',
      entries: []
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '账套当前会计期间未设置，无法保存或整理凭证',
      details: {
        ledgerId: 8,
        currentPeriod: null,
        requestedPeriod: '2026-01',
        voucherDate: '2026-01-03'
      }
    })
    expect(voucherCommandMocks.createVoucherWithEntries).not.toHaveBeenCalled()
  })

  it('keeps closed period validation details for voucher save', async () => {
    voucherCommandMocks.assertPeriodWritable.mockImplementationOnce(() => {
      throw new Error('当前会计期间（2026-01）已结账，本期凭证不能新增或编辑')
    })

    const result = await createVoucherCommand(context as never, {
      ledgerId: 8,
      voucherDate: '2026-01-03',
      entries: []
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '当前会计期间（2026-01）已结账，本期凭证不能新增或编辑',
      details: {
        ledgerId: 8,
        currentPeriod: '2026-01',
        requestedPeriod: '2026-01',
        voucherDate: '2026-01-03'
      }
    })
    expect(voucherCommandMocks.createVoucherWithEntries).not.toHaveBeenCalled()
  })

  it('normalizes voucher list status filters before querying summaries', async () => {
    const result = await listVouchersCommand(context as never, {
      ledgerId: 8,
      status: '3'
    } as never)

    expect(result.status).toBe('success')
    expect(voucherListQuery.all).toHaveBeenCalledWith(8, 3)
  })

  it('passes voucher list status=all through as an explicit all-states query', async () => {
    const result = await listVouchersCommand(context as never, {
      ledgerId: 8,
      status: 'all'
    } as never)

    expect(result.status).toBe('success')
    expect(voucherListQuery.all).toHaveBeenCalledWith(8)
  })

  it('rejects invalid voucher list status filters', async () => {
    const result = await listVouchersCommand(context as never, {
      ledgerId: 8,
      status: 'deleted'
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'status 仅支持 0、1、2、3 或 all；默认不返回已删除凭证，status=all 可包含已删除凭证',
      details: {
        field: 'status',
        received: 'deleted',
        allowed: [0, 1, 2, 3, 'all']
      }
    })
    expect(voucherListQuery.all).not.toHaveBeenCalled()
  })

  it('normalizes update payload aliases before invoking lifecycle', async () => {
    const result = await updateVoucherCommand(context as never, {
      voucherId: 43,
      ledgerId: 8,
      date: '2026-01-05',
      description: '更新后的摘要',
      entries: [
        {
          subjectCode: '1002',
          debit: 500,
          credit: 0,
          cashflowItemCode: 'CF01'
        },
        {
          subjectCode: '430101',
          debit: 0,
          credit: 500
        }
      ]
    } as never)

    expect(result.status).toBe('success')
    expect(voucherCommandMocks.updateVoucherWithEntries).toHaveBeenCalledWith(
      context.db,
      expect.objectContaining({
        voucherId: 43,
        ledgerId: 8,
        period: '2026-01',
        voucherDate: '2026-01-05',
        entries: [
          {
            summary: '更新后的摘要',
            subjectCode: '1002',
            debitAmount: '500',
            creditAmount: '0',
            cashFlowItemId: 161
          },
          {
            summary: '更新后的摘要',
            subjectCode: '430101',
            debitAmount: '0',
            creditAmount: '500',
            cashFlowItemId: null
          }
        ]
      })
    )
  })

  it('exports editable voucher update payload and writes a payload file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-voucher-edit-'))
    const filePath = path.join(tempDir, 'voucher-update.json')

    try {
      const result = await exportVoucherEditPayloadCommand(context as never, {
        voucherId: 43,
        filePath
      })

      const expectedPayload = {
        voucherId: 43,
        ledgerId: 8,
        period: '2026-01',
        voucherDate: '2026-01-03',
        entries: [
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '1002',
            debitAmount: '3000',
            creditAmount: '0',
            cashFlowItemId: 161
          },
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '2206',
            debitAmount: '0',
            creditAmount: '20',
            cashFlowItemId: null
          },
          {
            summary: '收到客户付款活动款（张三）',
            subjectCode: '430101',
            debitAmount: '0',
            creditAmount: '2980',
            cashFlowItemId: null
          }
        ]
      }

      expect(result.status).toBe('success')
      expect(result.data).toEqual({
        payload: expectedPayload,
        filePath
      })
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(expectedPayload)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('does not export an edit payload for missing vouchers', async () => {
    voucherEditQuery.get.mockReturnValueOnce(undefined as never)

    const result = await exportVoucherEditPayloadCommand(context as never, {
      voucherId: 404
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'NOT_FOUND',
      message: '凭证不存在'
    })
  })

  it('does not export an edit payload without ledger access', async () => {
    voucherCommandMocks.requireCommandLedgerAccess.mockImplementationOnce(() => {
      throw new CommandError('LEDGER_ACCESS_DENIED', '无权访问账套', null, 4)
    })

    const result = await exportVoucherEditPayloadCommand(context as never, {
      voucherId: 43
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'LEDGER_ACCESS_DENIED',
      message: '无权访问账套'
    })
  })

  it('does not export an edit payload for non-draft vouchers', async () => {
    voucherEditQuery.get.mockReturnValueOnce({
      id: 43,
      ledger_id: 8,
      period: '2026-01',
      voucher_date: '2026-01-03',
      status: 1
    })

    const result = await exportVoucherEditPayloadCommand(context as never, {
      voucherId: 43
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '仅未审核凭证可导出编辑载荷'
    })
  })

  it('keeps voucher update blocked for non-draft vouchers', async () => {
    voucherQuery.get.mockReturnValueOnce({
      id: 43,
      ledger_id: 8,
      voucher_number: 1,
      status: 1
    })

    const result = await updateVoucherCommand(context as never, {
      voucherId: 43,
      ledgerId: 8,
      date: '2026-01-05',
      description: '更新后的摘要',
      entries: [
        {
          subjectCode: '1002',
          debit: 500,
          credit: 0
        },
        {
          subjectCode: '430101',
          debit: 0,
          credit: 500
        }
      ]
    } as never)

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '仅未审核凭证可修改'
    })
  })

  it('renumbers voucher numbers for the current writable period', async () => {
    const result = await renumberVoucherNumbersCommand(context as never, {
      ledgerId: 8,
      period: '2026-01'
    })

    expect(result.status).toBe('success')
    expect(voucherCommandMocks.requireCommandPermission).toHaveBeenCalledWith(
      context.actor,
      'voucher_entry'
    )
    expect(voucherCommandMocks.requireCommandLedgerAccess).toHaveBeenCalledWith(
      context.db,
      context.actor,
      8
    )
    expect(voucherCommandMocks.renumberVoucherNumbers).toHaveBeenCalledWith(
      context.db,
      8,
      '2026-01'
    )
    expect(result.data).toMatchObject({
      ledgerId: 8,
      period: '2026-01',
      totalCount: 2,
      updatedCount: 1
    })
    expect(voucherCommandMocks.appendActorOperationLog).toHaveBeenCalledWith(
      expect.objectContaining({ actor: context.actor }),
      expect.objectContaining({
        ledgerId: 8,
        module: 'voucher',
        action: 'renumber_voucher_numbers',
        targetType: 'voucher_period',
        targetId: '8:2026-01'
      })
    )
  })

  it('does not renumber voucher numbers without voucher entry permission', async () => {
    voucherCommandMocks.requireCommandPermission.mockImplementationOnce(() => {
      throw new CommandError('FORBIDDEN', '无权限执行该操作', { permission: 'voucher_entry' }, 4)
    })

    const result = await renumberVoucherNumbersCommand(context as never, {
      ledgerId: 8,
      period: '2026-01'
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'FORBIDDEN',
      message: '无权限执行该操作'
    })
    expect(voucherCommandMocks.renumberVoucherNumbers).not.toHaveBeenCalled()
  })

  it('does not renumber voucher numbers without ledger access', async () => {
    voucherCommandMocks.requireCommandLedgerAccess.mockImplementationOnce(() => {
      throw new CommandError('LEDGER_ACCESS_DENIED', '无权访问该账套', { ledgerId: 8 }, 4)
    })

    const result = await renumberVoucherNumbersCommand(context as never, {
      ledgerId: 8,
      period: '2026-01'
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'LEDGER_ACCESS_DENIED',
      message: '无权访问该账套'
    })
    expect(voucherCommandMocks.renumberVoucherNumbers).not.toHaveBeenCalled()
  })

  it('does not renumber voucher numbers for a closed period', async () => {
    voucherCommandMocks.assertPeriodWritable.mockImplementationOnce(() => {
      throw new Error('当前期间已结账，不能整理凭证号')
    })

    const result = await renumberVoucherNumbersCommand(context as never, {
      ledgerId: 8,
      period: '2026-01'
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '当前期间已结账，不能整理凭证号'
    })
    expect(voucherCommandMocks.renumberVoucherNumbers).not.toHaveBeenCalled()
  })

  it('does not renumber voucher numbers when the period contains posted vouchers', async () => {
    voucherCommandMocks.renumberVoucherNumbers.mockImplementationOnce(() => {
      throw new VoucherNumberRenumberValidationError('存在已记账凭证，不允许整理凭证号', {
        voucherId: 45
      })
    })

    const result = await renumberVoucherNumbersCommand(context as never, {
      ledgerId: 8,
      period: '2026-01'
    })

    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '存在已记账凭证，不允许整理凭证号',
      details: {
        voucherId: 45
      }
    })
  })
})

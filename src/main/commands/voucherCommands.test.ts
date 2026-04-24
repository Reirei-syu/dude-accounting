import { beforeEach, describe, expect, it, vi } from 'vitest'

const voucherCommandMocks = vi.hoisted(() => ({
  assertPeriodWritable: vi.fn(),
  createVoucherWithEntries: vi.fn(),
  updateVoucherWithEntries: vi.fn(),
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

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandPermission: voucherCommandMocks.requireCommandPermission,
    requireCommandLedgerAccess: voucherCommandMocks.requireCommandLedgerAccess
  }
})

import { createVoucherCommand, updateVoucherCommand } from './voucherCommands'

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
    voucherCommandMocks.createVoucherWithEntries.mockReturnValue({
      voucherId: 43,
      voucherNumber: 1,
      status: 0
    })
    voucherCommandMocks.updateVoucherWithEntries.mockReturnValue(undefined)
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
})

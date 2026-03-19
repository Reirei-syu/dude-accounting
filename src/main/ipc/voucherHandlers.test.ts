import { beforeEach, describe, expect, it, vi } from 'vitest'

const voucherHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn(() => 'D:/UserData'),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(),
    appendOperationLog: vi.fn(),
    assertPeriodWritable: vi.fn(),
    applyVoucherBatchAction: vi.fn(),
    listVoucherBatchTargets: vi.fn(),
    getNextVoucherNumber: vi.fn(),
    getVoucherLedgerId: vi.fn(),
    listVoucherEntries: vi.fn(),
    listVoucherSummaries: vi.fn(),
    createVoucherWithEntries: vi.fn(),
    isVoucherNumberConflictError: vi.fn(),
    resolveVoucherCashFlowEntries: vi.fn(),
    updateVoucherWithEntries: vi.fn(),
    withIpcTelemetry: vi.fn(async (_options: unknown, operation: () => unknown) => await operation()),
    assertVoucherSwapAllowed: vi.fn(),
    normalizeEmergencyReversalPayload: vi.fn(),
    requireAuth: vi.fn(),
    requireLedgerAccess: vi.fn(),
    requirePermission: vi.fn(),
    applyVoucherSwapPlan: vi.fn(),
    buildVoucherSwapPlan: vi.fn(),
    listVoucherSwapEntriesByVoucherId: vi.fn(),
    listVoucherSwapVouchers: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: voucherHandlerMocks.appGetPath },
  ipcMain: {
    handle: voucherHandlerMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: voucherHandlerMocks.getDatabase
}))

vi.mock('../services/auditLog', () => ({
  appendOperationLog: voucherHandlerMocks.appendOperationLog
}))

vi.mock('../services/periodState', () => ({
  assertPeriodWritable: voucherHandlerMocks.assertPeriodWritable
}))

vi.mock('../services/voucherBatchLifecycle', () => ({
  applyVoucherBatchAction: voucherHandlerMocks.applyVoucherBatchAction,
  listVoucherBatchTargets: voucherHandlerMocks.listVoucherBatchTargets
}))

vi.mock('../services/voucherCatalog', () => ({
  getNextVoucherNumber: voucherHandlerMocks.getNextVoucherNumber,
  getVoucherLedgerId: voucherHandlerMocks.getVoucherLedgerId,
  listVoucherEntries: voucherHandlerMocks.listVoucherEntries,
  listVoucherSummaries: voucherHandlerMocks.listVoucherSummaries
}))

vi.mock('../services/voucherLifecycle', () => ({
  createVoucherWithEntries: voucherHandlerMocks.createVoucherWithEntries,
  isVoucherNumberConflictError: voucherHandlerMocks.isVoucherNumberConflictError,
  resolveVoucherCashFlowEntries: voucherHandlerMocks.resolveVoucherCashFlowEntries,
  updateVoucherWithEntries: voucherHandlerMocks.updateVoucherWithEntries
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: voucherHandlerMocks.withIpcTelemetry
}))

vi.mock('../services/voucherControl', () => ({
  assertVoucherSwapAllowed: voucherHandlerMocks.assertVoucherSwapAllowed,
  normalizeEmergencyReversalPayload: voucherHandlerMocks.normalizeEmergencyReversalPayload
}))

vi.mock('./session', () => ({
  requireAuth: voucherHandlerMocks.requireAuth,
  requireLedgerAccess: voucherHandlerMocks.requireLedgerAccess,
  requirePermission: voucherHandlerMocks.requirePermission
}))

vi.mock('../services/voucherSwapLifecycle', () => ({
  applyVoucherSwapPlan: voucherHandlerMocks.applyVoucherSwapPlan,
  buildVoucherSwapPlan: voucherHandlerMocks.buildVoucherSwapPlan,
  listVoucherSwapEntriesByVoucherId: voucherHandlerMocks.listVoucherSwapEntriesByVoucherId,
  listVoucherSwapVouchers: voucherHandlerMocks.listVoucherSwapVouchers
}))

import { registerVoucherHandlers } from './voucher'

describe('voucher IPC handlers', () => {
  const db = {
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ current_period: '2026-03' }))
    }))
  }
  const user = { id: 5, username: 'tester' }

  beforeEach(() => {
    voucherHandlerMocks.handlers.clear()
    vi.clearAllMocks()
    voucherHandlerMocks.getDatabase.mockReturnValue(db)
    voucherHandlerMocks.requirePermission.mockReturnValue(user)
    voucherHandlerMocks.requireAuth.mockReturnValue(user)
    voucherHandlerMocks.requireLedgerAccess.mockImplementation(() => user)

    registerVoucherHandlers()
  })

  it('returns a validation error when swap payload voucherIds is malformed', async () => {
    const handler = voucherHandlerMocks.handlers.get('voucher:swapPositions')

    const result = await handler?.(
      { sender: { id: 1 } },
      {
        voucherIds: undefined
      }
    )

    expect(result).toEqual({
      success: false,
      error: '仅选择 2 张凭证时才可交换位置'
    })
    expect(voucherHandlerMocks.listVoucherSwapVouchers).not.toHaveBeenCalled()
  })

  it('returns a validation error when batch payload voucherIds is malformed', async () => {
    const handler = voucherHandlerMocks.handlers.get('voucher:batchAction')

    const result = await handler?.(
      { sender: { id: 1 } },
      {
        action: 'audit',
        voucherIds: undefined
      }
    )

    expect(result).toEqual({
      success: false,
      error: '请选择凭证'
    })
    expect(voucherHandlerMocks.listVoucherBatchTargets).not.toHaveBeenCalled()
  })
})

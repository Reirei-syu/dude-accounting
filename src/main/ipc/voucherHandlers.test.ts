import { beforeEach, describe, expect, it, vi } from 'vitest'

const voucherHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn(() => 'D:/UserData'),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    withIpcTelemetry: vi.fn(async (_options: unknown, operation: () => unknown) => await operation()),
    getNextVoucherNumberCommand: vi.fn(),
    createVoucherCommand: vi.fn(),
    updateVoucherCommand: vi.fn(),
    listVouchersCommand: vi.fn(),
    getVoucherEntriesCommand: vi.fn(),
    swapVoucherPositionsCommand: vi.fn(),
    voucherBatchActionCommand: vi.fn(),
    resolveVoucherCashFlowEntries: vi.fn()
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

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: voucherHandlerMocks.withIpcTelemetry
}))

vi.mock('../commands/voucherCommands', () => ({
  getNextVoucherNumberCommand: voucherHandlerMocks.getNextVoucherNumberCommand,
  createVoucherCommand: voucherHandlerMocks.createVoucherCommand,
  updateVoucherCommand: voucherHandlerMocks.updateVoucherCommand,
  listVouchersCommand: voucherHandlerMocks.listVouchersCommand,
  getVoucherEntriesCommand: voucherHandlerMocks.getVoucherEntriesCommand,
  swapVoucherPositionsCommand: voucherHandlerMocks.swapVoucherPositionsCommand,
  voucherBatchActionCommand: voucherHandlerMocks.voucherBatchActionCommand
}))

vi.mock('../services/voucherLifecycle', () => ({
  resolveVoucherCashFlowEntries: voucherHandlerMocks.resolveVoucherCashFlowEntries
}))

import { registerVoucherHandlers } from './voucher'

describe('voucher IPC handlers', () => {
  beforeEach(() => {
    voucherHandlerMocks.handlers.clear()
    vi.clearAllMocks()
    registerVoucherHandlers()
  })

  it('returns a validation error when swap payload voucherIds is malformed', async () => {
    voucherHandlerMocks.swapVoucherPositionsCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: { code: 'VALIDATION_ERROR', message: '仅选择 2 张凭证时才可交换位置', details: null }
    })
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
  })

  it('returns a validation error when batch payload voucherIds is malformed', async () => {
    voucherHandlerMocks.voucherBatchActionCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: { code: 'VALIDATION_ERROR', message: '请选择凭证', details: null }
    })
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
  })
})

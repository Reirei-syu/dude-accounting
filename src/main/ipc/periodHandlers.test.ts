import { beforeEach, describe, expect, it, vi } from 'vitest'

const periodMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    getPeriodStatusCommand: vi.fn(),
    closePeriodCommand: vi.fn(),
    reopenPeriodCommand: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: periodMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: periodMocks.getDatabase
}))

vi.mock('../commands/periodCommands', () => ({
  getPeriodStatusCommand: periodMocks.getPeriodStatusCommand,
  closePeriodCommand: periodMocks.closePeriodCommand,
  reopenPeriodCommand: periodMocks.reopenPeriodCommand
}))

import { registerPeriodHandlers } from './period'

describe('period IPC handlers', () => {
  beforeEach(() => {
    periodMocks.handlers.clear()
    vi.clearAllMocks()
    registerPeriodHandlers()
  })

  it('delegates period status queries to the command layer without fabricating a default payload', async () => {
    periodMocks.getPeriodStatusCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: '请先选择账套',
        details: null
      }
    })
    const handler = periodMocks.handlers.get('period:getStatus')

    await expect(handler?.({ sender: { id: 1 } }, undefined, '')).rejects.toThrow('请先选择账套')
    expect(periodMocks.getPeriodStatusCommand).toHaveBeenCalledWith(expect.anything(), {
      ledgerId: undefined,
      period: ''
    })
  })
})

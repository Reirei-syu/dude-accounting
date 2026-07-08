import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeContext } from '../main/runtime/runtimeContext'

const cliMocks = vi.hoisted(() => ({
  executeCliCommand: vi.fn(),
  listCommands: vi.fn(() => ['report export-tax-template'])
}))

vi.mock('./executor', () => ({
  executeCliCommand: cliMocks.executeCliCommand,
  listCommands: cliMocks.listCommands
}))

import { runCliBatch } from './runner'

describe('runCliBatch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cliMocks.executeCliCommand.mockReset()
    cliMocks.listCommands.mockClear()
  })

  it('normalizes Chinese command aliases before parsing batch CLI arguments', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    cliMocks.executeCliCommand.mockResolvedValue({
      status: 'success',
      data: { ok: true },
      error: null
    })

    const exitCode = await runCliBatch({} as RuntimeContext, [
      '税务模板导出',
      '--ledger-id',
      '1',
      '--declaration-type',
      'monthly',
      '--year',
      '2026',
      '--month',
      '7',
      '--output',
      'D:/tax-template.xlsx'
    ])

    expect(exitCode).toBe(0)
    expect(cliMocks.executeCliCommand).toHaveBeenCalledWith({} as RuntimeContext, {
      outputMode: 'json',
      token: undefined,
      domain: 'report',
      action: 'export-tax-template',
      payload: {
        'ledger-id': '1',
        'declaration-type': 'monthly',
        year: '2026',
        month: '7',
        output: 'D:/tax-template.xlsx'
      }
    })
    expect(logSpy).toHaveBeenCalled()
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandContext } from './types'

const commandMocks = vi.hoisted(() => ({
  exportNpoTaxTemplate: vi.fn(),
  appendOperationLog: vi.fn()
}))

vi.mock('../services/npoTaxTemplateExport', async () => {
  const actual = await vi.importActual<typeof import('../services/npoTaxTemplateExport')>(
    '../services/npoTaxTemplateExport'
  )
  return {
    ...actual,
    exportNpoTaxTemplate: commandMocks.exportNpoTaxTemplate
  }
})

vi.mock('../services/auditLog', () => ({
  appendOperationLog: commandMocks.appendOperationLog
}))

import { exportTaxTemplateCommand } from './reportingCommands'

describe('exportTaxTemplateCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createContext(): CommandContext {
    return {
      db: {} as never,
      runtime: {} as never,
      actor: {
        id: 7,
        username: 'cli-user',
        permissions: {},
        isAdmin: true,
        source: 'cli'
      },
      outputMode: 'json',
      now: new Date('2026-07-07T00:00:00.000Z')
    }
  }

  it('accepts CLI kebab-case payload flags and returns the tax template contract', async () => {
    commandMocks.exportNpoTaxTemplate.mockImplementation(async (_db, input) => ({
      filePath: input.outputPath,
      ledgerId: input.ledgerId,
      declarationType: input.declarationType,
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      templateVersion: 'npo-tax-template-v1'
    }))

    const context = createContext()
    const rawOutputPath = '/mnt/d/exports/tax-template.xlsx'

    const result = await exportTaxTemplateCommand(context, {
      'ledger-id': '1',
      'declaration-type': 'monthly',
      year: '2026',
      month: '7',
      output: rawOutputPath
    })

    const expectedOutputPath =
      process.platform === 'win32' ? 'D:\\exports\\tax-template.xlsx' : rawOutputPath

    expect(result).toEqual({
      status: 'success',
      data: {
        filePath: expectedOutputPath,
        ledgerId: 1,
        declarationType: 'monthly',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
        templateVersion: 'npo-tax-template-v1'
      },
      error: null
    })
    expect(commandMocks.exportNpoTaxTemplate).toHaveBeenCalledWith(expect.anything(), {
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026,
      month: 7,
      quarter: undefined,
      outputPath: expectedOutputPath,
      overwrite: false,
      now: context.now
    })
    expect(commandMocks.appendOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'export_tax_template',
        targetType: 'tax_template',
        targetId: expectedOutputPath
      })
    )
  })

  it('returns CONFLICT when the explicit output file already exists', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-tax-template-command-'))
    const existingPath = path.join(tempDir, 'existing-tax-template.xlsx')
    fs.writeFileSync(existingPath, 'occupied')

    try {
      const result = await exportTaxTemplateCommand(createContext(), {
        ledgerId: 1,
        declarationType: 'monthly',
        year: 2026,
        month: 7,
        output: existingPath
      })

      expect(result).toMatchObject({
        status: 'error',
        error: {
          code: 'CONFLICT',
          message: expect.stringContaining('输出文件已存在'),
          details: {
            outputPath: existingPath
          }
        }
      })
      expect(commandMocks.exportNpoTaxTemplate).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('maps service-level file race conflicts to CONFLICT', async () => {
    commandMocks.exportNpoTaxTemplate.mockRejectedValueOnce(
      new Error('输出文件已存在，请更换文件名或启用覆盖')
    )
    const outputPath = path.join(os.tmpdir(), `tax-template-race-${Date.now()}.xlsx`)

    const result = await exportTaxTemplateCommand(createContext(), {
      ledgerId: 1,
      declarationType: 'monthly',
      year: 2026,
      month: 7,
      output: outputPath
    })

    expect(result).toMatchObject({
      status: 'error',
      error: {
        code: 'CONFLICT',
        message: expect.stringContaining('输出文件已存在'),
        details: {
          outputPath
        }
      }
    })
  })
})

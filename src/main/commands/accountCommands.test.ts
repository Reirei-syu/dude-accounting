import { beforeEach, describe, expect, it, vi } from 'vitest'

const accountCommandMocks = vi.hoisted(() => ({
  searchSubjects: vi.fn(),
  createCashFlowMapping: vi.fn(),
  requireCommandActor: vi.fn((actor) => actor),
  requireCommandLedgerAccess: vi.fn((...args) => args[1]),
  requireCommandPermission: vi.fn((actor) => actor),
  appendActorOperationLog: vi.fn()
}))

vi.mock('../services/accountSetup', async () => {
  const actual = await vi.importActual('../services/accountSetup')
  return {
    ...(actual as object),
    searchSubjects: accountCommandMocks.searchSubjects
  }
})

vi.mock('../services/cashFlowMapping', async () => {
  const actual = await vi.importActual('../services/cashFlowMapping')
  return {
    ...(actual as object),
    createCashFlowMapping: accountCommandMocks.createCashFlowMapping
  }
})

vi.mock('./authz', async () => {
  const actual = await vi.importActual('./authz')
  return {
    ...(actual as object),
    requireCommandActor: accountCommandMocks.requireCommandActor,
    requireCommandLedgerAccess: accountCommandMocks.requireCommandLedgerAccess,
    requireCommandPermission: accountCommandMocks.requireCommandPermission
  }
})

vi.mock('./operationLog', async () => {
  const actual = await vi.importActual('./operationLog')
  return {
    ...(actual as object),
    appendActorOperationLog: accountCommandMocks.appendActorOperationLog
  }
})

import { createCashFlowMappingCommand, searchSubjectsCommand } from './accountCommands'

describe('accountCommands payload normalization', () => {
  const context = {
    db: {
      prepare: vi.fn()
    },
    runtime: {
      userDataPath: 'D:/tmp/userData'
    },
    actor: {
      id: 1,
      username: 'admin',
      permissions: {},
      isAdmin: true,
      source: 'cli' as const
    },
    outputMode: 'json' as const,
    now: new Date('2026-04-24T10:00:00.000Z')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    accountCommandMocks.searchSubjects.mockReturnValue([{ code: '1002', name: '银行存款' }])
    accountCommandMocks.createCashFlowMapping.mockReturnValue(18)
  })

  it('keeps subject search keyword as a string-like code', async () => {
    const result = await searchSubjectsCommand(context as never, {
      ledgerId: '12' as never,
      keyword: '1002'
    })

    expect(result.status).toBe('success')
    expect(accountCommandMocks.searchSubjects).toHaveBeenCalledWith(
      expect.anything(),
      12,
      '1002'
    )
  })

  it('normalizes cashflow mapping code fields separately from numeric ids', async () => {
    const result = await createCashFlowMappingCommand(context as never, {
      ledgerId: '12' as never,
      subjectCode: 1002 as never,
      counterpartSubjectCode: '2206',
      entryDirection: 'inflow',
      cashFlowItemId: '16' as never
    })

    expect(result.status).toBe('success')
    expect(accountCommandMocks.createCashFlowMapping).toHaveBeenCalledWith(expect.anything(), {
      ledgerId: 12,
      subjectCode: '1002',
      counterpartSubjectCode: '2206',
      entryDirection: 'inflow',
      cashFlowItemId: 16
    })
  })
})

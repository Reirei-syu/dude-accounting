import { beforeEach, describe, expect, it, vi } from 'vitest'

const archiveHandlerMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handlers,
    appGetPath: vi.fn((name: string) => (name === 'documents' ? 'D:/Documents' : 'D:/UserData')),
    ipcHandle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    getDatabase: vi.fn(() => ({ tag: 'db' })),
    withIpcTelemetry: vi.fn(
      async (_options: unknown, operation: () => unknown) => await operation()
    ),
    deleteArchiveCommand: vi.fn(),
    validateArchiveCommand: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: { getPath: archiveHandlerMocks.appGetPath },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: archiveHandlerMocks.ipcHandle
  }
}))

vi.mock('../database/init', () => ({
  getDatabase: archiveHandlerMocks.getDatabase
}))

vi.mock('../services/pathPreference', () => ({
  getPathPreference: vi.fn(),
  rememberPathPreference: vi.fn()
}))

vi.mock('../services/runtimeLogger', () => ({
  withIpcTelemetry: archiveHandlerMocks.withIpcTelemetry
}))

vi.mock('../commands/archiveCommands', () => ({
  deleteArchiveCommand: archiveHandlerMocks.deleteArchiveCommand,
  exportArchiveCommand: vi.fn(),
  getArchiveManifestCommand: vi.fn(),
  listArchivesCommand: vi.fn(),
  validateArchiveCommand: archiveHandlerMocks.validateArchiveCommand
}))

vi.mock('./session', () => ({
  getSessionByEvent: vi.fn(() => ({
    id: 1,
    username: 'admin',
    permissions: {},
    isAdmin: true,
    source: 'ipc'
  })),
  requireAuth: vi.fn(() => ({
    id: 1,
    username: 'admin',
    permissions: {},
    isAdmin: true,
    source: 'ipc'
  })),
  requireLedgerAccess: vi.fn()
}))

import { registerArchiveHandlers } from './archive'

describe('archive IPC handlers', () => {
  beforeEach(() => {
    archiveHandlerMocks.handlers.clear()
    vi.clearAllMocks()
    registerArchiveHandlers()
  })

  it('surfaces record-only deletion guidance when the archive package is already missing', async () => {
    archiveHandlerMocks.deleteArchiveCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: {
        code: 'RISK_CONFIRMATION_REQUIRED',
        message: '路径下档案包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
        details: {
          packagePath: 'D:/exports/missing-archive',
          missingPhysicalPackage: true
        }
      }
    })

    const handler = archiveHandlerMocks.handlers.get('archive:delete')
    const result = await handler?.({ sender: { id: 1 } }, { exportId: 8 })

    expect(result).toEqual({
      success: false,
      error: '路径下档案包已不存在，若只删除数据库记录请显式传入 deleteRecordOnly=true。',
      errorCode: 'RISK_CONFIRMATION_REQUIRED',
      errorDetails: {
        packagePath: 'D:/exports/missing-archive',
        missingPhysicalPackage: true
      },
      requiresRecordDeletionConfirmation: true,
      missingPhysicalPackage: true,
      packagePath: 'D:/exports/missing-archive'
    })
  })

  it('returns structured errors when archive validation fails before checksum comparison', async () => {
    archiveHandlerMocks.validateArchiveCommand.mockResolvedValue({
      status: 'error',
      data: null,
      error: {
        code: 'NOT_FOUND',
        message: '电子档案导出记录不存在',
        details: { exportId: 9 }
      }
    })

    const handler = archiveHandlerMocks.handlers.get('archive:validate')
    const result = await handler?.({ sender: { id: 1 } }, 9)

    expect(result).toEqual({
      success: false,
      error: '电子档案导出记录不存在',
      errorCode: 'NOT_FOUND',
      errorDetails: { exportId: 9 }
    })
  })
})

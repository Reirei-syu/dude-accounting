import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  ready: null as (() => void) | null,
  code: 0,
  windows: 0,
  keepAlive: true,
  exit: vi.fn(),
  close: vi.fn(),
  flush: vi.fn(async () => undefined)
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => 'D:/isolated-shutdown-test',
    setPath: vi.fn(),
    on: vi.fn(),
    whenReady: () => ({
      then: (callback: () => void) => {
        fixture.ready = callback
      }
    }),
    exit: fixture.exit,
    quit: vi.fn(),
    relaunch: vi.fn(),
    isPackaged: false
  },
  BrowserWindow: { getAllWindows: () => Array.from({ length: fixture.windows }, () => ({})) },
  dialog: { showErrorBox: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: true }
}))
vi.mock('./database/init', () => ({
  initializeDatabase: vi.fn(),
  closeDatabase: fixture.close,
  getDatabase: vi.fn()
}))
vi.mock('./services/auditLog', () => ({ appendOperationLog: vi.fn() }))
vi.mock('./services/pendingRestoreLog', () => ({
  clearPendingRestoreLog: vi.fn(),
  getPendingRestoreLogPath: vi.fn(),
  readPendingRestoreLog: () => null
}))
vi.mock('./ipc/register', () => ({ registerIpcHandlers: vi.fn() }))
vi.mock('./services/errorLog', () => ({ installGlobalErrorLogging: vi.fn() }))
vi.mock('./services/runtimeAppPaths', () => ({
  getRuntimeUserDataPath: () => 'D:/isolated-shutdown-test'
}))
vi.mock('./runtime/runtimeContext', () => ({ setRuntimeContext: vi.fn() }))
vi.mock('./runtime/embeddedCliState', () => ({
  consumeEmbeddedCliState: () => ({
    keepAliveUntilWindowClose: fixture.keepAlive,
    relaunchRequested: false
  })
}))
vi.mock('../cli/embedded', () => ({
  runEmbeddedCli: async () => {
    process.exitCode = fixture.code
  },
  flushEmbeddedCliOutput: fixture.flush
}))
vi.mock('./services/windowSecurity', () => ({ secureWindowContents: vi.fn() }))
vi.mock('../../resources/icon.png?asset', () => ({ default: 'icon.png' }))

describe('嵌入式 CLI 预览失败后的退出边界', () => {
  const argv = process.argv
  const exitCode = process.exitCode
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    fixture.ready = null
    fixture.keepAlive = true
    process.argv = ['electron', 'app', '--cli', 'print', 'open-preview']
  })
  afterEach(() => {
    process.argv = argv
    process.exitCode = exitCode
  })
  it.each([
    [10, 0],
    [4, 1],
    [0, 0]
  ])('退出码%s、剩余窗口%s不能因旧keepAlive标记挂起', async (code, windows) => {
    fixture.code = code
    fixture.windows = windows
    await import('./index')
    fixture.ready!()
    await vi.waitFor(() => expect(fixture.exit).toHaveBeenCalledWith(code))
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.flush).toHaveBeenCalledOnce()
  })
  it('成功且确有预览窗口时保持常驻，不提前释放数据库', async () => {
    fixture.code = 0
    fixture.windows = 1
    await import('./index')
    fixture.ready!()
    await new Promise((resolve) => setImmediate(resolve))
    expect(fixture.exit).not.toHaveBeenCalled()
    expect(fixture.close).not.toHaveBeenCalled()
  })
})

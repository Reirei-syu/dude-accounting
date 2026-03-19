import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const preloadMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  electronAPI: { ping: 'pong' }
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: preloadMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: preloadMocks.invoke,
    send: preloadMocks.send
  }
}))

vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: preloadMocks.electronAPI
}))

describe('preload diagnostics bridge', () => {
  type RendererErrorEvent = {
    message: string
    error?: Error
    filename?: string
    lineno?: number
    colno?: number
  }
  type RendererRejectionEvent = {
    reason: unknown
  }
  type RendererListener = (event: unknown) => void
  type GlobalTestState = {
    window?: unknown
    __listeners?: Map<string, RendererListener>
  }
  const globalWithWindow = globalThis as unknown as GlobalTestState
  const originalWindow = globalWithWindow.window
  const originalContextIsolated = (process as { contextIsolated?: boolean }).contextIsolated

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    const listeners = new Map<string, RendererListener>()
    globalWithWindow.window = {
      location: { href: 'app://index.html' },
      addEventListener: (type: string, listener: RendererListener) => {
        listeners.set(type, listener)
      }
    }

    ;(process as { contextIsolated?: boolean }).contextIsolated = true

    await import('./index')

    globalWithWindow.__listeners = listeners
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete globalWithWindow.window
    } else {
      globalWithWindow.window = originalWindow
    }
    ;(process as { contextIsolated?: boolean }).contextIsolated = originalContextIsolated
    delete globalWithWindow.__listeners
  })

  it('exposes the new settings diagnostics APIs through contextBridge', async () => {
    const apiExposeCall = preloadMocks.exposeInMainWorld.mock.calls.find(
      ([name]) => name === 'api'
    )
    expect(apiExposeCall).toBeTruthy()

    const api = apiExposeCall?.[1] as {
      settings: {
        getErrorLogStatus: () => Promise<unknown>
        openErrorLogDirectory: () => Promise<unknown>
      }
    }

    await api.settings.getErrorLogStatus()
    await api.settings.openErrorLogDirectory()

    expect(preloadMocks.invoke).toHaveBeenNthCalledWith(1, 'settings:getErrorLogStatus')
    expect(preloadMocks.invoke).toHaveBeenNthCalledWith(2, 'settings:openErrorLogDirectory')
  })

  it('forwards window error events to diagnostics:rendererError', () => {
    const listeners = globalWithWindow.__listeners as Map<string, RendererListener>

    const event: RendererErrorEvent = {
      message: 'renderer boom',
      error: new Error('renderer boom'),
      filename: 'app://index.html',
      lineno: 12,
      colno: 34
    }
    listeners.get('error')?.(event)

    expect(preloadMocks.send).toHaveBeenCalledWith('diagnostics:rendererError', {
      type: 'error',
      message: 'renderer boom',
      stack: expect.stringContaining('renderer boom'),
      filename: 'app://index.html',
      lineno: 12,
      colno: 34,
      href: 'app://index.html'
    })
  })

  it('forwards unhandled rejections to diagnostics:rendererError', () => {
    const listeners = globalWithWindow.__listeners as Map<string, RendererListener>
    const error = new Error('promise boom')

    const event: RendererRejectionEvent = {
      reason: error
    }
    listeners.get('unhandledrejection')?.(event)

    expect(preloadMocks.send).toHaveBeenCalledWith('diagnostics:rendererError', {
      type: 'unhandledrejection',
      message: 'promise boom',
      stack: error.stack,
      reason: 'promise boom',
      href: 'app://index.html'
    })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'

const runtime = vi.hoisted(() => ({
  handle: vi.fn(),
  expose: vi.fn(),
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<undefined>>(async () => undefined)
}))
vi.mock('electron', () => ({
  app: { getPath: () => '.tmp/ipc-contract-test', isPackaged: false },
  BrowserWindow: class {},
  dialog: {},
  shell: {},
  ipcMain: { handle: runtime.handle, on: vi.fn() },
  ipcRenderer: { invoke: runtime.invoke, send: vi.fn() },
  contextBridge: { exposeInMainWorld: runtime.expose }
}))
vi.mock('../database/init', () => ({ getDatabase: () => ({}) }))

describe('真实 IPC 注册与 preload 契约完整性', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('主程序实际注册全部共享通道，且不存在重复或额外通道', async () => {
    const { registerIpcHandlers } = await import('./register')
    registerIpcHandlers()
    const registered = runtime.handle.mock.calls.map(([channel]) => channel)
    expect(registered.toSorted()).toEqual(Object.keys(IPC_CHANNELS).toSorted())
    expect(new Set(registered).size).toBe(registered.length)
  })

  it('主 preload 的每个实际方法调用对应共享通道，打印 preload 仅暴露四个任务操作', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
    try {
      await import('../../preload/index')
      const api = runtime.expose.mock.calls.find(([name]) => name === 'api')?.[1]
      expect(api).toBeDefined()
      const channels: string[] = []
      for (const [domain, methods] of Object.entries(api)) {
        for (const [method, invokeMethod] of Object.entries(methods as object)) {
          runtime.invoke.mockClear()
          await (invokeMethod as (...args: unknown[]) => unknown)({}, {}, {}, {})
          const channel = `${domain}:${method}`
          expect(runtime.invoke.mock.calls[0]?.[0], channel).toBe(channel)
          expect(runtime.invoke).toHaveBeenCalledTimes(1)
          channels.push(channel)
        }
      }
      expect(channels.toSorted()).toEqual(Object.keys(IPC_CHANNELS).toSorted())
      runtime.expose.mockClear()
      await import('../../preload/print')
      const printApi = runtime.expose.mock.calls.find(([name]) => name === 'api')?.[1]
      expect(Object.keys(printApi)).toEqual(['print'])
      expect(Object.keys(printApi.print).toSorted()).toEqual([
        'exportPdf',
        'getPreviewModel',
        'print',
        'updatePreviewSettings'
      ])
    } finally {
      if (original) Object.defineProperty(process, 'contextIsolated', original)
      else Reflect.deleteProperty(process, 'contextIsolated')
    }
  })
})

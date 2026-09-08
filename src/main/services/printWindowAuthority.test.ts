import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { authorizePrintWindow, bindPrintWindow } from './printWindowAuthority'

function fixture(): {
  event: IpcMainInvokeEvent
  handlers: Map<string, () => void>
  sender: {
    getURL: ReturnType<typeof vi.fn<() => string>>
    isDestroyed: ReturnType<typeof vi.fn<() => boolean>>
  }
} {
  const url = 'file:///print-pages/page-123/index.html'
  const mainFrame = { url }
  const handlers = new Map<string, () => void>()
  const sender = {
    mainFrame,
    getURL: vi.fn(() => url),
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, callback: () => void) => handlers.set(event, callback))
  }
  const event = { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent
  bindPrintWindow(sender as unknown as WebContents, 'job-1', url)
  return { sender, event, handlers }
}

describe('打印任务窗口授权', () => {
  it('只接受绑定窗口的当前主框架和任务', () => {
    const { event } = fixture()
    expect(authorizePrintWindow(event, 'job-1')).toBe(true)
    expect(() => authorizePrintWindow(event, 'job-2')).toThrow('授权已失效')
    expect(() =>
      authorizePrintWindow({ ...event, senderFrame: {} } as IpcMainInvokeEvent, 'job-1')
    ).toThrow('授权已失效')
  })

  it.each(['destroyed', 'render-process-gone'])('在 %s 后立即撤销且不回退普通鉴权', (name) => {
    const { event, handlers } = fixture()
    handlers.get(name)!()
    expect(() => authorizePrintWindow(event, 'job-1')).toThrow('授权已失效')
  })

  it('拒绝导航后或已销毁的窗口', () => {
    const { event, sender } = fixture()
    sender.getURL.mockReturnValue('https://attacker.test')
    expect(() => authorizePrintWindow(event, 'job-1')).toThrow('授权已失效')
    sender.getURL.mockReturnValue(event.senderFrame!.url)
    sender.isDestroyed.mockReturnValue(true)
    expect(() => authorizePrintWindow(event, 'job-1')).toThrow('授权已失效')
  })
})

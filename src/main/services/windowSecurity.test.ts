import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { isAllowedExternalUrl, secureWindowContents } from './windowSecurity'

describe('窗口安全边界', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///C:/Windows/system.ini',
    'http://example.com',
    'https://example.com',
    'https://example.com.evil.test',
    'https://user:password@example.com',
    'mailto:test@example.com',
    'not a URL'
  ])('拒绝未获批外链 %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })

  it('阻止页面、子框架、重定向、新窗口及 webview，并拒绝权限', () => {
    const handlers = new Map<string, (event: { preventDefault: () => void }) => void>()
    const session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn()
    }
    const contents = {
      on: vi.fn((name, handler) => handlers.set(name, handler)),
      setWindowOpenHandler: vi.fn(),
      session
    }
    secureWindowContents(contents as unknown as WebContents)
    for (const name of [
      'will-navigate',
      'will-frame-navigate',
      'will-redirect',
      'will-attach-webview'
    ]) {
      const preventDefault = vi.fn()
      handlers.get(name)!({ preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    expect(contents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://example.com' })).toEqual({
      action: 'deny'
    })
    const callback = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](contents, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    expect(session.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)
  })
})

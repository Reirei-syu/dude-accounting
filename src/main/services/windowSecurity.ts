import type { Session, WebContents } from 'electron'

// 当前产品没有需要打开的外部业务站点；新增域名须经过业务与安全审查。
const businessHttpsHosts: ReadonlySet<string> = new Set()

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      businessHttpsHosts.has(url.hostname)
    )
  } catch {
    return false
  }
}

export function denySessionPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler(() => false)
}

export function secureWindowContents(contents: WebContents): void {
  // 主进程 loadFile/loadURL 不受这些页面发起的导航事件影响。
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-frame-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  denySessionPermissions(contents.session)
}

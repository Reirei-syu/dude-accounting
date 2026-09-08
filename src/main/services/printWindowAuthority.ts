import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { CommandError } from '../commands/types'

const printWindows = new WeakSet<WebContents>()
const grants = new WeakMap<WebContents, { jobId: string; url: string; assertAccess?: () => void }>()

export function bindPrintWindow(
  contents: WebContents,
  jobId: string,
  url: string,
  assertAccess?: () => void
): void {
  printWindows.add(contents)
  grants.set(contents, { jobId, url, assertAccess })
  const revoke = (): void => {
    grants.delete(contents)
  }
  contents.once('destroyed', revoke)
  contents.once('render-process-gone', revoke)
}

/** 返回 false 表示非打印窗口，由正常登录鉴权继续处理。 */
export function authorizePrintWindow(event: IpcMainInvokeEvent, jobId: string): boolean {
  if (!printWindows.has(event.sender)) return false
  const grant = grants.get(event.sender)
  if (
    !grant ||
    grant.jobId !== jobId ||
    event.sender.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== grant.url ||
    event.sender.getURL() !== grant.url
  ) {
    throw new CommandError('FORBIDDEN', '打印窗口授权已失效或任务不匹配', { jobId }, 4)
  }
  grant.assertAccess?.()
  return true
}

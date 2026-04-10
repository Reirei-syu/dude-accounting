let keepAliveUntilWindowClose = false
let relaunchRequested = false

export function requestEmbeddedCliKeepAlive(): void {
  keepAliveUntilWindowClose = true
}

export function requestEmbeddedCliRelaunch(): void {
  relaunchRequested = true
}

export function consumeEmbeddedCliState(): {
  keepAliveUntilWindowClose: boolean
  relaunchRequested: boolean
} {
  const currentValue = keepAliveUntilWindowClose
  const currentRelaunchValue = relaunchRequested
  keepAliveUntilWindowClose = false
  relaunchRequested = false
  return {
    keepAliveUntilWindowClose: currentValue,
    relaunchRequested: currentRelaunchValue
  }
}

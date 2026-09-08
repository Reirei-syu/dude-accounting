import type { IpcArgs, IpcChannel, IpcResult } from '../shared/contracts/ipc'

/** 只共享类型，避免沙箱 preload 被打包成需要额外 require 的共享 chunk。 */
export type TypedInvoke = <C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
) => Promise<IpcResult<C>>

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { DudeAPI } from './desktopApi'
import type { PrintPreviewAPI } from './printPreviewApi'
import { IPC_CHANNELS, type IpcArgs, type IpcChannel, type IpcResult } from './ipc'

// 仅供编译器检查，不执行 IPC；移除类型约束会使 expect-error 变为错误。
export function verifyRejectedContractInputs(
  invoke: <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>) => Promise<IpcResult<C>>
): void {
  // @ts-expect-error 未声明的通道不能越过共享边界。
  void invoke('auth:missing')
  // @ts-expect-error 登录参数必须是字符串。
  void invoke('auth:login', 123, 'password')
  // @ts-expect-error 必填参数不可遗漏。
  void invoke('auth:login', 'username')
}

export function verifyRejectedMainHandlers(
  register: typeof import('../../main/ipc/typedInvoke').handleInvoke
): void {
  // @ts-expect-error 主进程不能注册未声明的接口。
  register('auth:missing', () => undefined)
  // @ts-expect-error 主进程处理器不能返回与共享契约不符的结果。
  register('auth:logout', () => 'invalid response')
  // @ts-expect-error 固定 DTO 不能用缺少 id 等字段的任意字典替代。
  register('eVoucher:list', () => [{ wrongColumn: 'missing voucher fields' }])
}

export function verifyRejectedVoucherStatus(row: IpcResult<'eVoucher:list'>[number]): void {
  // @ts-expect-error 电子凭证状态只能使用现有数据库定义的状态。
  row.status = 'invalid-status'
}

describe('共享 IPC 契约', () => {
  it('调用参数与返回值来自同一桌面 API', () => {
    expectTypeOf<IpcArgs<'auth:login'>>().toEqualTypeOf<Parameters<DudeAPI['auth']['login']>>()
    expectTypeOf<IpcResult<'auth:login'>>().toEqualTypeOf<
      Awaited<ReturnType<DudeAPI['auth']['login']>>
    >()
    expect(IPC_CHANNELS['auth:login']).toBe(true)
    expect(IPC_CHANNELS['print:print']).toBe(true)
  })
  it('打印窗口能力严格限制为四个任务操作', () => {
    expectTypeOf<keyof PrintPreviewAPI>().toEqualTypeOf<'print'>()
    expectTypeOf<keyof PrintPreviewAPI['print']>().toEqualTypeOf<
      'getPreviewModel' | 'updatePreviewSettings' | 'print' | 'exportPdf'
    >()
  })
})

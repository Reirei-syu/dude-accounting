import { describe, expect, it } from 'vitest'

interface InteractiveModule {
  formatInteractivePrompt?: (state: {
    outputMode: 'json' | 'pretty'
    ledgerId?: number
    period?: string
  }) => string
  shouldEnterInteractiveShell?: (
    argv: string[],
    terminal: { stdinIsTTY: boolean; stdoutIsTTY: boolean; forceInteractive?: boolean }
  ) => boolean
  resolveInteractiveCommand?: (line: string) => {
    kind: 'builtin' | 'command'
    name?: string
    domain?: string
    action?: string
    payload?: Record<string, unknown>
  }
  applyInteractiveContext?: (
    input: {
      domain: string
      action: string
      payload: Record<string, unknown>
    },
    state: { outputMode: 'json' | 'pretty'; ledgerId?: number; period?: string }
  ) => {
    domain: string
    action: string
    payload: Record<string, unknown>
  }
  getInteractivePromptPlan?: (
    input: {
      domain: string
      action: string
      payload: Record<string, unknown>
    },
    state: { outputMode: 'json' | 'pretty'; ledgerId?: number; period?: string }
  ) => Array<{ key: string }>
  executeShellBuiltin?: (
    tokens: string[],
    state: { outputMode: 'json' | 'pretty'; ledgerId?: number; period?: string }
  ) => {
    handled: boolean
    shouldExit?: boolean
    nextState: { outputMode: 'json' | 'pretty'; ledgerId?: number; period?: string }
    text?: string
    result?: {
      status: string
      data: unknown
      error: unknown
    }
  }
}

async function loadInteractiveModule(): Promise<InteractiveModule | null> {
  try {
    return (await import('./interactive')) as InteractiveModule
  } catch {
    return null
  }
}

describe('interactive cli helpers', () => {
  it('formats dudeacc prompt with optional ledger and period context', async () => {
    const interactive = await loadInteractiveModule()

    expect(interactive?.formatInteractivePrompt?.({ outputMode: 'pretty' })).toBe('dudeacc>')
    expect(
      interactive?.formatInteractivePrompt?.({
        outputMode: 'pretty',
        ledgerId: 3,
        period: '2026-04'
      })
    ).toBe('dudeacc[ledger:3|period:2026-04]>')
  })

  it('enters interactive shell only when argv is empty and terminal is interactive', async () => {
    const interactive = await loadInteractiveModule()

    expect(
      interactive?.shouldEnterInteractiveShell?.([], {
        stdinIsTTY: true,
        stdoutIsTTY: true
      })
    ).toBe(true)

    expect(
      interactive?.shouldEnterInteractiveShell?.([], {
        stdinIsTTY: false,
        stdoutIsTTY: false
      })
    ).toBe(false)

    expect(
      interactive?.shouldEnterInteractiveShell?.(['auth', 'login'], {
        stdinIsTTY: true,
        stdoutIsTTY: true
      })
    ).toBe(false)
  })

  it('resolves bilingual aliases into builtin or business command definitions', async () => {
    const interactive = await loadInteractiveModule()

    expect(interactive?.resolveInteractiveCommand?.('登录')).toMatchObject({
      kind: 'command',
      domain: 'auth',
      action: 'login'
    })

    expect(interactive?.resolveInteractiveCommand?.('账套列表')).toMatchObject({
      kind: 'command',
      domain: 'ledger',
      action: 'list'
    })

    expect(interactive?.resolveInteractiveCommand?.('帮助')).toMatchObject({
      kind: 'builtin',
      name: 'help'
    })

    expect(interactive?.resolveInteractiveCommand?.('创建用户')).toMatchObject({
      kind: 'command',
      domain: 'auth',
      action: 'create-user'
    })
  })

  it('returns complete command catalog for help all', async () => {
    const interactive = await loadInteractiveModule()

    expect(
      interactive?.executeShellBuiltin?.(['help', 'all'], {
        outputMode: 'pretty'
      })
    ).toMatchObject({
      handled: true,
      result: {
        status: 'success',
        data: {
          domains: expect.arrayContaining(['auth', 'ledger', 'print']),
          allCommands: expect.arrayContaining([
            expect.objectContaining({
              command: 'auth create-user',
              aliasZh: '创建用户'
            }),
            expect.objectContaining({
              command: 'print open-preview'
            })
          ])
        }
      }
    })
  })

  it('injects current ledger and period context without overriding explicit payload', async () => {
    const interactive = await loadInteractiveModule()

    expect(
      interactive?.applyInteractiveContext?.(
        {
          domain: 'book',
          action: 'subject-balances',
          payload: {}
        },
        {
          outputMode: 'pretty',
          ledgerId: 5,
          period: '2026-04'
        }
      )
    ).toEqual({
      domain: 'book',
      action: 'subject-balances',
      payload: {
        ledgerId: 5,
        startDate: '2026-04-01',
        endDate: '2026-04-30'
      }
    })

    expect(
      interactive?.applyInteractiveContext?.(
        {
          domain: 'voucher',
          action: 'list',
          payload: {
            ledgerId: 9,
            period: '2026-05'
          }
        },
        {
          outputMode: 'pretty',
          ledgerId: 5,
          period: '2026-04'
        }
      )
    ).toEqual({
      domain: 'voucher',
      action: 'list',
      payload: {
        ledgerId: 9,
        period: '2026-05'
      }
    })
  })

  it('builds prompt plan for login and period-sensitive commands', async () => {
    const interactive = await loadInteractiveModule()

    expect(
      interactive?.getInteractivePromptPlan?.(
        {
          domain: 'auth',
          action: 'login',
          payload: {}
        },
        {
          outputMode: 'pretty'
        }
      )
    ).toEqual([{ key: 'username' }, { key: 'password' }])

    expect(
      interactive?.getInteractivePromptPlan?.(
        {
          domain: 'period',
          action: 'status',
          payload: {}
        },
        {
          outputMode: 'pretty',
          ledgerId: 1
        }
      )
    ).toEqual([{ key: 'period' }])
  })

  it('handles shell builtins for mode, context and scoped selections', async () => {
    const interactive = await loadInteractiveModule()

    expect(
      interactive?.executeShellBuiltin?.(['mode', 'json'], {
        outputMode: 'pretty'
      })
    ).toMatchObject({
      handled: true,
      nextState: {
        outputMode: 'json'
      }
    })

    expect(
      interactive?.executeShellBuiltin?.(['选择账套', '8'], {
        outputMode: 'pretty'
      })
    ).toMatchObject({
      handled: true,
      nextState: {
        outputMode: 'pretty',
        ledgerId: 8
      }
    })

    expect(
      interactive?.executeShellBuiltin?.(['清除期间'], {
        outputMode: 'pretty',
        ledgerId: 8,
        period: '2026-04'
      })
    ).toMatchObject({
      handled: true,
      nextState: {
        outputMode: 'pretty',
        ledgerId: 8
      }
    })
  })
})

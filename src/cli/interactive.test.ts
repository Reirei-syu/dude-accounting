import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeRuntimeContext } from '../main/runtime/runtimeContext'
import { saveCliSession } from './sessionStore'

interface InteractiveModule {
  createInitialInteractiveShellState?: (runtime: unknown) => {
    outputMode: 'json' | 'pretty'
    accountName?: string
    ledgerId?: number
    ledgerName?: string
    period?: string
  }
  formatInteractiveStatusBar?: (state: {
    outputMode: 'json' | 'pretty'
    accountName?: string
    ledgerId?: number
    ledgerName?: string
    period?: string
  }) => string
  formatInteractivePrompt?: (state: {
    outputMode: 'json' | 'pretty'
    accountName?: string
    ledgerId?: number
    ledgerName?: string
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
    state: {
      outputMode: 'json' | 'pretty'
      accountName?: string
      ledgerId?: number
      ledgerName?: string
      period?: string
    }
  ) => {
    handled: boolean
    shouldExit?: boolean
    nextState: {
      outputMode: 'json' | 'pretty'
      accountName?: string
      ledgerId?: number
      ledgerName?: string
      period?: string
    }
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
    return (await import('./interactive')) as unknown as InteractiveModule
  } catch {
    return null
  }
}

describe('interactive cli helpers', () => {
  it('formats fixed dudeacc prompt and status bar', async () => {
    const interactive = await loadInteractiveModule()

    expect(interactive?.formatInteractivePrompt?.({ outputMode: 'pretty' })).toBe('dudeacc>')
    expect(
      interactive?.formatInteractiveStatusBar?.({
        outputMode: 'pretty'
      })
    ).toBe('账号：未登录 | 账套：未选择 | 会计期间：未选择')
    expect(
      interactive?.formatInteractiveStatusBar?.({
        outputMode: 'pretty',
        accountName: 'admin',
        ledgerId: 3,
        ledgerName: '测试账套',
        period: '2026-04'
      })
    ).toBe('账号：admin | 账套：测试账套 | 会计期间：2026-04')
    expect(
      interactive?.formatInteractivePrompt?.({
        outputMode: 'pretty',
        accountName: 'admin',
        ledgerId: 3,
        ledgerName: '测试账套',
        period: '2026-04'
      })
    ).toBe('dudeacc>')
  })

  it('hydrates initial shell state from persisted cli session', async () => {
    const interactive = await loadInteractiveModule()
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-cli-state-'))
    const runtime = createNodeRuntimeContext({
      isDevelopment: false,
      isPackaged: false,
      userDataPath: tempDir
    })

    try {
      saveCliSession(runtime, {
        id: 1,
        username: 'admin',
        permissions: {},
        isAdmin: true,
        source: 'cli'
      })

      expect(interactive?.createInitialInteractiveShellState?.(runtime)).toMatchObject({
        outputMode: 'pretty',
        accountName: 'admin'
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
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

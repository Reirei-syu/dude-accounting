import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createNodeRuntimeContext } from '../main/runtime/runtimeContext'
import { runInteractiveCli, type InteractiveCommandExecutor } from './interactive'
import type { CliCommandInvocation } from './executor'
import type { CommandResult } from '../main/commands/types'

interface FakeLedger {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  current_period: string
}

function success<T>(data: T): CommandResult<T> {
  return {
    status: 'success',
    data,
    error: null
  }
}

function failure(message: string): CommandResult<null> {
  return {
    status: 'error',
    data: null,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: null
    }
  }
}

function createFakeExecutor(): InteractiveCommandExecutor {
  let loggedIn = false
  const ledgers: FakeLedger[] = []

  return async (_runtime, invocation: CliCommandInvocation) => {
    switch (`${invocation.domain} ${invocation.action}`) {
      case 'auth login': {
        const payload = invocation.payload as { username?: string; password?: string }
        if (payload.username === 'admin' && payload.password === '') {
          loggedIn = true
          return success({
            token: 'fake-token',
            user: {
              username: 'admin',
              isAdmin: true
            }
          })
        }
        return failure('登录失败')
      }
      case 'auth whoami':
        return loggedIn
          ? success({
              token: 'fake-token',
              actor: {
                username: 'admin',
                isAdmin: true
              }
            })
          : failure('未登录')
      case 'ledger create': {
        const payload = invocation.payload as { name: string; standardType: 'enterprise' | 'npo'; startPeriod: string }
        const ledger: FakeLedger = {
          id: ledgers.length + 1,
          name: payload.name,
          standard_type: payload.standardType,
          current_period: payload.startPeriod
        }
        ledgers.push(ledger)
        return success({ id: ledger.id })
      }
      case 'ledger list':
        return success(ledgers)
      case 'ledger periods': {
        const payload = invocation.payload as { ledgerId: number }
        const ledger = ledgers.find((item) => item.id === payload.ledgerId)
        if (!ledger) {
          return failure('账套不存在')
        }
        return success([
          {
            ledger_id: ledger.id,
            period: ledger.current_period,
            is_closed: 0,
            closed_at: null
          }
        ])
      }
      case 'period status': {
        const payload = invocation.payload as { ledgerId: number; period: string }
        return success({
          ledgerId: payload.ledgerId,
          period: payload.period,
          isClosed: false
        })
      }
      default:
        return failure(`未实现的测试命令: ${invocation.domain} ${invocation.action}`)
    }
  }
}

async function runSession(steps: Array<{ waitFor: string; input: string }>): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let buffer = ''
  let stepIndex = 0
  let settled = false

  const maybeAdvance = () => {
    while (stepIndex < steps.length && buffer.includes(steps[stepIndex].waitFor)) {
      const nextInput = steps[stepIndex].input
      stepIndex += 1
      setTimeout(() => {
        input.write(nextInput)
      }, 0)
    }

    if (stepIndex === steps.length) {
      setTimeout(() => {
        input.end()
      }, 0)
    }
  }

  output.on('data', (chunk) => {
    buffer += chunk.toString()
    maybeAdvance()
  })

  const runtime = createNodeRuntimeContext({
    isDevelopment: false,
    isPackaged: false
  })
  const executor = createFakeExecutor()
  const sessionPromise = runInteractiveCli(runtime, { input, output, executeCommand: executor })

  maybeAdvance()

  const exitCode = await Promise.race([
    sessionPromise,
    new Promise<number>((_, reject) => {
      setTimeout(() => {
        if (!settled) {
          reject(new Error(`交互式 CLI 会话超时\n当前输出:\n${buffer}`))
        }
      }, 10_000)
    })
  ])

  settled = true
  expect(exitCode).toBe(0)
  return buffer
}

describe('interactive shell integration', () => {
  it(
    'supports help, guided login, context selection and contextual commands',
    async () => {
      const output = await runSession([
        { waitFor: 'dudeacc>', input: 'help\n' },
        { waitFor: 'DudeAcc 交互式 CLI', input: '登录\n' },
        { waitFor: '用户名: ', input: 'admin\n' },
        { waitFor: '密码: ', input: '\n' },
        { waitFor: '"user": {', input: '我是谁\n' },
        {
          waitFor: '"actor": {',
          input: 'ledger create --name 交互测试账套 --standardType enterprise --startPeriod 2026-04\n'
        },
        { waitFor: '"id": 1', input: '选择账套\n' },
        { waitFor: '请输入账套ID: ', input: '1\n' },
        { waitFor: '已选择当前账套：1', input: '选择期间\n' },
        { waitFor: '请输入期间', input: '2026-04\n' },
        { waitFor: '已选择当前期间：2026-04', input: '期间状态\n' },
        { waitFor: '"period": "2026-04"', input: 'exit\n' }
      ])

      expect(output).toContain('dudeacc>')
      expect(output).toContain('账套列表')
      expect(output).toContain('"username": "admin"')
      expect(output).toContain('已选择当前账套：1')
      expect(output).toContain('已选择当前期间：2026-04')
      expect(output).toContain('"period": "2026-04"')
    },
    15_000
  )
})

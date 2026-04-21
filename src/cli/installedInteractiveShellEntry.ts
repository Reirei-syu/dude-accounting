import { spawn } from 'node:child_process'
import { closeDatabase, initializeDatabase } from '../main/database/init'
import {
  createNodeRuntimeContext,
  setRuntimeContext,
  type RuntimeContext
} from '../main/runtime/runtimeContext'
import { runInteractiveCli } from './interactive'
import type { CliCommandInvocation } from './executor'
import type { CommandResult } from '../main/commands/types'

function extractCommandResult(output: string): CommandResult<unknown> {
  const matches: CommandResult<unknown>[] = []

  for (let startIndex = 0; startIndex < output.length; startIndex += 1) {
    if (output[startIndex] !== '{') {
      continue
    }

    let depth = 0
    for (let index = startIndex; index < output.length; index += 1) {
      const current = output[index]
      if (current === '{') depth += 1
      if (current === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(output.slice(startIndex, index + 1)) as CommandResult<unknown>
            if (
              parsed &&
              typeof parsed === 'object' &&
              typeof parsed.status === 'string' &&
              Object.prototype.hasOwnProperty.call(parsed, 'data') &&
              Object.prototype.hasOwnProperty.call(parsed, 'error')
            ) {
              matches.push(parsed)
            }
          } catch {
            // ignore non-command json fragments
          }
          break
        }
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`鏈壘鍒?CLI JSON 杈撳嚭锛歕n${output}`)
  }

  return matches[matches.length - 1]
}

function executeInstalledBatchCommand(
  runtime: RuntimeContext,
  invocation: CliCommandInvocation
): Promise<CommandResult<unknown>> {
  return new Promise((resolve, reject) => {
    const args = ['--cli', invocation.domain, invocation.action]
    if (invocation.token) {
      args.push('--token', invocation.token)
    }

    const payload =
      invocation.payload && typeof invocation.payload === 'object'
        ? (invocation.payload as Record<string, unknown>)
        : {}
    if (Object.keys(payload).length > 0) {
      args.push('--payload-json', JSON.stringify(payload))
    }

    const child = spawn(runtime.executablePath, args, {
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE')
      ),
      windowsHide: false
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.once('error', reject)
    child.once('close', (code) => {
      if ((code ?? 0) !== 0 && !stdout && !stderr) {
        reject(new Error(`CLI 瀛愬懡浠ゆ墽琛屽け璐ワ紝閫€鍑虹爜 ${code ?? 0}`))
        return
      }

      try {
        resolve(extractCommandResult(`${stdout}\n${stderr}`))
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function main(): Promise<void> {
  const runtime = createNodeRuntimeContext({
    isDevelopment: false,
    isPackaged: true,
    executablePath: process.execPath
  })
  setRuntimeContext(runtime)
  initializeDatabase()

  try {
    const exitCode = await runInteractiveCli(runtime, {
      executeCommand: async (_runtime, invocation) => executeInstalledBatchCommand(runtime, invocation)
    })
    process.exitCode = exitCode
  } finally {
    closeDatabase()
  }
}

void main()

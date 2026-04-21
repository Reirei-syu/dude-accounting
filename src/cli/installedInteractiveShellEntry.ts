import { closeDatabase, initializeDatabase } from '../main/database/init'
import {
  createNodeRuntimeContext,
  setRuntimeContext
} from '../main/runtime/runtimeContext'
import { runInteractiveCli } from './interactive'
import { executeInstalledBatchCommand } from './installedBatchBridge'

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

import { createNodeRuntimeContext, setRuntimeContext } from '../main/runtime/runtimeContext'
import { runCli } from './runner'

async function main(): Promise<void> {
  const runtime = createNodeRuntimeContext({
    isDevelopment: true,
    isPackaged: false
  })
  setRuntimeContext(runtime)
  const exitCode = await runCli(runtime, process.argv.slice(2))
  process.exitCode = exitCode
}

void main()

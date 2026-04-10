import { getRuntimeContext } from '../main/runtime/runtimeContext'
import { runCli } from './runner'

export async function runEmbeddedCli(argv: string[]): Promise<void> {
  const exitCode = await runCli(getRuntimeContext(), argv)
  process.exitCode = exitCode
}


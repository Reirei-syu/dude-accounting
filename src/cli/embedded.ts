import { getRuntimeContext } from '../main/runtime/runtimeContext'
import { runCli } from './runner'

export async function runEmbeddedCli(argv: string[]): Promise<void> {
  const exitCode = await runCli(getRuntimeContext(), argv)
  process.exitCode = exitCode
}

export async function flushEmbeddedCliOutput(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise<void>((resolve) => stream.write('', () => resolve()))
    )
  )
}

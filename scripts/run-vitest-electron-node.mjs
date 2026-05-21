import { spawn } from 'node:child_process'
import path from 'node:path'
import electronPath from 'electron'

const vitestCliPath = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const args = process.argv.slice(2)

const child = spawn(electronPath, [vitestCliPath, 'run', ...args], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  },
  stdio: 'inherit',
  windowsHide: false
})

child.once('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

child.once('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

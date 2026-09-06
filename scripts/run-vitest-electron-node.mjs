import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import electronPath from 'electron'

const vitestCliPath = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const args = process.argv.slice(2)

// 构建在所有 worker 启动前完成，集成测试不得并发覆盖共享 out 目录。
for (const buildArgs of [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.cli.json'],
  ['node_modules/electron-vite/bin/electron-vite.js', 'build']
]) {
  execFileSync(process.execPath, buildArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
    timeout: 240_000
  })
}

const child = spawn(electronPath, [vitestCliPath, 'run', ...args], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DUDEACC_TEST_BUILD_READY: '1',
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

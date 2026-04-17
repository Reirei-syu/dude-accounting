import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const POSIX_LAUNCHER_MODE = 0o755

const POSIX_LAUNCHER_CONTENT = `#!/usr/bin/env sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
"$SCRIPT_DIR/dude-app" --cli "$@"
`

const WINDOWS_LAUNCHER_CONTENT = `@echo off
setlocal
"%~dp0dude-app.exe" --cli %*
exit /b %ERRORLEVEL%
`

export function ensureCliLaunchers(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : path.resolve(__dirname, '..')
  const buildCliDir = path.join(rootDir, 'build', 'cli')

  fs.mkdirSync(buildCliDir, { recursive: true })

  for (const launcherName of ['dude-accounting', 'dudeacc']) {
    const launcherPath = path.join(buildCliDir, launcherName)
    fs.writeFileSync(launcherPath, POSIX_LAUNCHER_CONTENT, 'utf8')
    fs.chmodSync(launcherPath, POSIX_LAUNCHER_MODE)
  }

  for (const launcherName of ['dude-accounting.cmd', 'dudeacc.cmd']) {
    const launcherPath = path.join(buildCliDir, launcherName)
    fs.writeFileSync(launcherPath, WINDOWS_LAUNCHER_CONTENT, 'utf8')
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  ensureCliLaunchers()
}

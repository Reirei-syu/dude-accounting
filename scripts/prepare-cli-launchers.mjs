import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const POSIX_LAUNCHER_MODE = 0o755

const POSIX_LAUNCHER_CONTENT = `#!/usr/bin/env bash
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_EXE="$SCRIPT_DIR/dude-app.exe"
if [ ! -f "$APP_EXE" ]; then
  APP_EXE="$SCRIPT_DIR/dude-app"
fi
ARGS=()
CONVERT_NEXT=0
PAYLOAD_STDIN=0
for ARG in "$@"; do
  if [ "$CONVERT_NEXT" -eq 1 ]; then
    if command -v wslpath >/dev/null 2>&1; then
      CONVERTED="$(wslpath -w "$ARG" 2>/dev/null || printf '%s' "$ARG")"
      ARGS+=("$CONVERTED")
    else
      ARGS+=("$ARG")
    fi
    CONVERT_NEXT=0
    continue
  fi

  ARGS+=("$ARG")
  if [ "$ARG" = "--payload-file" ]; then
    CONVERT_NEXT=1
  fi
  if [ "$ARG" = "--payload-stdin" ]; then
    PAYLOAD_STDIN=1
  fi
done
if [ "$PAYLOAD_STDIN" -eq 1 ]; then
  if [ -t 0 ]; then
    DUDEACC_PAYLOAD_STDIN_JSON=""
  else
    DUDEACC_PAYLOAD_STDIN_JSON="$(cat)"
  fi
  export DUDEACC_PAYLOAD_STDIN_JSON
fi
"$APP_EXE" --cli "\${ARGS[@]}"
`

const WINDOWS_BATCH_LAUNCHER_CONTENT = `@echo off
setlocal
set "DUDEACC_HOST=%~dp0dudeacc-host.exe"
set "DUDEACC_ARGS=%*"
if not "%~1"=="" goto checkPayloadStdin
"%DUDEACC_HOST%"
exit /b %ERRORLEVEL%

:checkPayloadStdin
echo.%DUDEACC_ARGS% | findstr /C:"--payload-stdin" >nul
if not errorlevel 1 goto payloadStdin
"%DUDEACC_HOST%" %*
exit /b %ERRORLEVEL%

:payloadStdin
powershell -NoProfile -ExecutionPolicy Bypass -Command "$payload = if ([Console]::IsInputRedirected) { [Console]::In.ReadToEnd() } else { '' }; $env:DUDEACC_PAYLOAD_STDIN_JSON = $payload; & $env:DUDEACC_HOST @args; exit $LASTEXITCODE" -- %*
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

  fs.writeFileSync(
    path.join(buildCliDir, 'dude-accounting.cmd'),
    WINDOWS_BATCH_LAUNCHER_CONTENT,
    'utf8'
  )
  fs.writeFileSync(
    path.join(buildCliDir, 'dudeacc.cmd'),
    WINDOWS_BATCH_LAUNCHER_CONTENT,
    'utf8'
  )
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  ensureCliLaunchers()
}

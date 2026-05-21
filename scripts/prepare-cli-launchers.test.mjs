import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  POSIX_LAUNCHER_MODE,
  ensureCliLaunchers
} from './prepare-cli-launchers.mjs'

describe('prepare-cli-launchers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rewrites POSIX launchers and marks them executable', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-cli-launchers-'))
    const chmodSpy = vi.spyOn(fs, 'chmodSync')

    ensureCliLaunchers({ rootDir })

    const buildCliDir = path.join(rootDir, 'build', 'cli')
    expect(fs.readFileSync(path.join(buildCliDir, 'dudeacc'), 'utf8')).toContain(
      'APP_EXE="$SCRIPT_DIR/dude-app.exe"'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dudeacc'), 'utf8')).toContain(
      'wslpath -w "$ARG"'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dudeacc'), 'utf8')).toContain(
      'DUDEACC_PAYLOAD_STDIN_JSON="$(cat)"'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dudeacc'), 'utf8')).toContain(
      '"$APP_EXE" --cli "${ARGS[@]}"'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dude-accounting'), 'utf8')).toContain(
      '"$APP_EXE" --cli "${ARGS[@]}"'
    )
    expect(chmodSpy).toHaveBeenCalledWith(path.join(buildCliDir, 'dudeacc'), POSIX_LAUNCHER_MODE)
    expect(chmodSpy).toHaveBeenCalledWith(
      path.join(buildCliDir, 'dude-accounting'),
      POSIX_LAUNCHER_MODE
    )

    const dudeaccCmd = fs.readFileSync(path.join(buildCliDir, 'dudeacc.cmd'), 'utf8')
    const dudeAccountingCmd = fs.readFileSync(
      path.join(buildCliDir, 'dude-accounting.cmd'),
      'utf8'
    )
    expect(dudeaccCmd).toBe(dudeAccountingCmd)
    expect(dudeaccCmd).toContain('dudeacc-host.exe')
    expect(dudeaccCmd).toContain('DUDEACC_PAYLOAD_STDIN_JSON')
    expect(dudeaccCmd).toContain(':checkPayloadStdin')
    expect(dudeaccCmd).toContain('"%DUDEACC_HOST%" %*')
    expect(dudeaccCmd).toContain(':payloadStdin')
    expect(dudeaccCmd).not.toContain('if errorlevel 1 (')
    expect(dudeaccCmd).not.toContain('"%DUDEACC_APP%" --cli %*')
  })
})

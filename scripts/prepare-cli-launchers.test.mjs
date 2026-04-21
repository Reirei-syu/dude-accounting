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
      '"$SCRIPT_DIR/dude-app" --cli "$@"'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dude-accounting'), 'utf8')).toContain(
      '"$SCRIPT_DIR/dude-app" --cli "$@"'
    )
    expect(chmodSpy).toHaveBeenCalledWith(path.join(buildCliDir, 'dudeacc'), POSIX_LAUNCHER_MODE)
    expect(chmodSpy).toHaveBeenCalledWith(
      path.join(buildCliDir, 'dude-accounting'),
      POSIX_LAUNCHER_MODE
    )

    expect(fs.readFileSync(path.join(buildCliDir, 'dudeacc.cmd'), 'utf8')).toContain(
      'dudeacc-host.exe'
    )
    expect(fs.readFileSync(path.join(buildCliDir, 'dude-accounting.cmd'), 'utf8')).toContain(
      'dude-app.exe" --cli %*'
    )
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const installerPath = path.join(process.cwd(), 'build', 'installer.nsh')
const dudeaccCmdPath = path.join(process.cwd(), 'build', 'cli', 'dudeacc.cmd')
const dudeaccShPath = path.join(process.cwd(), 'build', 'cli', 'dudeacc')

describe('installer PATH integration', () => {
  it('wires install and uninstall hooks to the native CLI host', () => {
    const installerScript = fs.readFileSync(installerPath, 'utf8')

    expect(installerScript).toContain('Var PreviousInstallDir')
    expect(installerScript).toContain('StrCpy $PreviousInstallDir $0')
    expect(installerScript).toContain('!macro customInstall')
    expect(installerScript).toContain('!macro customUnInstall')
    expect(installerScript).not.toContain('update-user-path.ps1')
    expect(installerScript).toContain('"$INSTDIR\\dudeacc-host.exe" path add --install-dir "$INSTDIR" --old-install-dir "$PreviousInstallDir"')
    expect(installerScript).toContain('"$INSTDIR\\dudeacc-host.exe" path remove --install-dir "$INSTDIR"')
  })

  it('uses the native CLI host for the installed dudeacc wrapper while keeping POSIX shell entry unchanged', () => {
    const dudeaccCmd = fs.readFileSync(dudeaccCmdPath, 'utf8')
    const dudeaccSh = fs.readFileSync(dudeaccShPath, 'utf8')

    expect(dudeaccCmd).toContain('dudeacc-host.exe')
    expect(dudeaccCmd).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(dudeaccCmd).not.toContain('installedShellEntry.js')
    expect(dudeaccSh).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(dudeaccSh).toContain('"$SCRIPT_DIR/dude-app" --cli "$@"')
  })
})

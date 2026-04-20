import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const installerPath = path.join(process.cwd(), 'build', 'installer.nsh')
const updatePathScriptPath = path.join(process.cwd(), 'build', 'update-user-path.ps1')

describe('installer PATH integration', () => {
  it('wires install and uninstall hooks to the user PATH helper script', () => {
    const installerScript = fs.readFileSync(installerPath, 'utf8')

    expect(installerScript).toContain('Var PreviousInstallDir')
    expect(installerScript).toContain('StrCpy $PreviousInstallDir $0')
    expect(installerScript).toContain('!macro customInstall')
    expect(installerScript).toContain('!macro customUnInstall')
    expect(installerScript).toContain('update-user-path.ps1')
    expect(installerScript).toContain('-Action Add -InstallDir "$INSTDIR" -OldInstallDir "$PreviousInstallDir"')
    expect(installerScript).toContain('-Action Remove -InstallDir "$INSTDIR"')
  })

  it('keeps PATH updates user-scoped, deduplicated, and broadcasts environment changes', () => {
    const updatePathScript = fs.readFileSync(updatePathScriptPath, 'utf8')

    expect(updatePathScript).toContain("GetEnvironmentVariable('Path', 'User')")
    expect(updatePathScript).toContain("SetEnvironmentVariable('Path', ($entries -join ';'), 'User')")
    expect(updatePathScript).toContain('HashSet[string]')
    expect(updatePathScript).toContain('$OldInstallDir')
    expect(updatePathScript).toContain('ExpandEnvironmentVariables')
    expect(updatePathScript).toContain('entries.Add($entryText)')
    expect(updatePathScript).toContain('SendMessageTimeout')
    expect(updatePathScript).toContain("'Environment'")
  })
})

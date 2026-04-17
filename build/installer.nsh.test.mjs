import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('installer.nsh', () => {
  it('adds install directory to user PATH on install and removes it on uninstall', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'build', 'installer.nsh'), 'utf8')
    const helperScript = fs.readFileSync(
      path.join(process.cwd(), 'build', 'update-user-path.ps1'),
      'utf8'
    )

    expect(script).toContain('!macro customInstall')
    expect(script).toContain('!macro customUnInstall')
    expect(script).toContain('update-user-path.ps1')
    expect(script).toContain('SendMessageTimeout')
    expect(helperScript).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')")
    expect(helperScript).toContain("[Environment]::SetEnvironmentVariable('Path'")
    expect(helperScript).toContain("[ValidateSet('Add', 'Remove')]")
  })
})

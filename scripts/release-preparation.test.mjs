import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
// ParseFile handles the UTF-8 BOM; ScriptBlock.Create receives text, not encoded bytes.
const script = fs
  .readFileSync(path.join(root, 'scripts/prepare-cli-release-e2e.ps1'), 'utf8')
  .replace(/^\uFEFF/, '')
const quote = (value) => `'${value.replaceAll("'", "''")}'`
function fixture() {
  const base = path.join(root, '.tmp/release-preparation-tests')
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, 'run-'))
}
function run(output, prefix = '') {
  const isolated = script.replace("'D:\\coding\\completed\\dude-app'", quote(output))
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `${prefix}\nfunction Stop-Process { throw '测试禁止终止任何进程' }\n& ([scriptblock]::Create(${quote(isolated)}))`
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
  )
}

describe.runIf(process.platform === 'win32')('Windows 产物准备实际文件系统边界', () => {
  it('Windows PowerShell 可按文件编码解析两个发布脚本', () => {
    for (const name of ['prepare-cli-release-e2e.ps1', 'build-win-installer.ps1']) {
      const file = path.join(root, 'scripts', name)
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$tokens=$null; $parseErrors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(${quote(file)},[ref]$tokens,[ref]$parseErrors); if ($parseErrors.Count) { $parseErrors | Out-String | Write-Error; exit 1 }`
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
      )
      expect(result.status, result.stderr).toBe(0)
    }
  })
  it('保留旧 unpacked 和无关文件，不结束其他安装目录的同名进程', () => {
    const output = fixture()
    fs.mkdirSync(path.join(output, 'win-unpacked'))
    fs.writeFileSync(path.join(output, 'win-unpacked/marker'), '保留')
    fs.writeFileSync(path.join(output, 'unrelated.txt'), '用户文件')
    const result = run(
      output,
      "function Get-Process { [pscustomobject]@{Id=99;Path='D:\\Unrelated\\dude-app.exe'} }"
    )
    expect(result.status, result.stderr).toBe(0)
    expect(fs.existsSync(path.join(output, 'win-unpacked'))).toBe(false)
    const backups = fs.readdirSync(output).filter((name) => name.startsWith('previous-unpacked-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(output, backups[0], 'marker'), 'utf8')).toBe('保留')
    expect(fs.readFileSync(path.join(output, 'unrelated.txt'), 'utf8')).toBe('用户文件')
  })
  it('目标产物正在运行时拒绝移动', () => {
    const output = fixture()
    fs.mkdirSync(path.join(output, 'win-unpacked'))
    const result = run(
      output,
      `function Get-Process { [pscustomobject]@{Id=99;Path=${quote(path.join(output, 'win-unpacked/dude-app.exe'))}} }`
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('99')
    expect(fs.existsSync(path.join(output, 'win-unpacked'))).toBe(true)
    expect(fs.readdirSync(output)).toEqual(['win-unpacked'])
  })
  it('输出祖先 junction 拒绝，链接目标文件保持原位', () => {
    const base = fixture()
    const destination = path.join(base, 'destination')
    const output = path.join(base, 'link/output')
    fs.mkdirSync(path.join(destination, 'output/win-unpacked'), { recursive: true })
    fs.writeFileSync(path.join(destination, 'output/win-unpacked/marker'), '保留')
    fs.symlinkSync(destination, path.join(base, 'link'), 'junction')
    const result = run(output, 'function Get-Process { @() }')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(path.join(base, 'link'))
    expect(fs.readFileSync(path.join(destination, 'output/win-unpacked/marker'), 'utf8')).toBe(
      '保留'
    )
    expect(fs.readdirSync(path.join(destination, 'output'))).toEqual(['win-unpacked'])
  })
})

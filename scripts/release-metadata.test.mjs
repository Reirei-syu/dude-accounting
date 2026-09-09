import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

describe('本地打包与未确认发布信息的安全边界', () => {
  it('禁用更新 provider，保留旧安装身份并去掉模板宣传信息', () => {
    const pkg = JSON.parse(read('package.json'))
    const builder = yaml.load(read('electron-builder.yml'))
    expect(pkg.description).toContain('代理记账')
    expect(pkg.homepage).toBeUndefined()
    expect(builder.publish).toBeNull()
    expect(builder.appId).toBe('com.electron.app')
    expect(builder.productName).toBe(pkg.name)
    expect(builder.win.executableName).toBe(pkg.name)
    expect(builder.linux.maintainer).toBeUndefined()
    expect(builder.mac.extendInfo).toBeUndefined()
    expect(builder.nsis.deleteAppDataOnUninstall).toBe(false)
  })

  it('所有现行本地打包入口显式禁止上传', () => {
    const pkg = JSON.parse(read('package.json'))
    const entryNames = ['build:unpack', 'build:win', 'build:mac']
    for (const name of entryNames) expect(pkg.scripts[name]).toContain('--publish never')
    expect(pkg.scripts['build:linux']).toBe('node scripts/build-linux-disabled.mjs')
    expect(read('scripts/build-linux-disabled.mjs')).toContain('process.exitCode = 1')
    for (const file of ['scripts/build-win-installer.ps1', 'scripts/build-mac-installer.sh']) {
      const commands = read(file)
        .split(/\r?\n/)
        .filter((line) => line.includes('npx electron-builder'))
      expect(commands.length).toBeGreaterThan(0)
      for (const command of commands) expect(command).toContain('--publish never')
    }
  })

  it('workflow 只能手动构建，不含标签自动触发、写权限或 Release 上传动作', () => {
    const workflow = yaml.load(read('.github/workflows/release.yml'))
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs)).toEqual(['build'])
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toBeUndefined()
      for (const step of job.steps) {
        expect(step.uses ?? '').not.toMatch(/action-gh-release|create-release|upload-release/)
        expect(step.run ?? '').not.toMatch(/gh release|--publish (always|onTag|onTagOrDraft)/)
      }
    }
    expect(read('.github/workflows/release.yml')).not.toContain('contents: write')
  })
})

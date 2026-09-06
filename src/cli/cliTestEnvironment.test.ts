import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertCliTestPath,
  cleanupCliTestRoot,
  getCliTestEnv,
  stopCliTestProcess,
  waitCliTestExit
} from './cliTestEnvironment'

const roots: string[] = []
function fixture(): { root: string; data: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-env-test-'))
  roots.push(root)
  const data = path.join(root, 'AppData', 'Roaming')
  fs.mkdirSync(data, { recursive: true })
  return { root, data }
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    if (fs.existsSync(root)) cleanupCliTestRoot(root, path.join(root, 'AppData', 'Roaming'))
  }
})

describe('CLI 测试数据隔离', () => {
  it('为每个套件提供独立目录并覆盖 Windows 及 WSL 启动器继承的配置', () => {
    const first = fixture()
    const second = fixture()
    vi.stubEnv('DUDEACC_TEST_BUILD_READY', '1')
    vi.stubEnv('APPDATA', 'C:\\Users\\real\\AppData\\Roaming')
    vi.stubEnv('XDG_CONFIG_HOME', '/mnt/c/Users/real/AppData/Roaming')
    vi.stubEnv('DUDEACC_E2E_APPDATA_PATH', '/home/real/.config')
    expect(first.data).not.toBe(second.data)
    expect(getCliTestEnv(first.root, first.data)).toMatchObject({
      APPDATA: first.data,
      XDG_CONFIG_HOME: first.data,
      DUDEACC_E2E_APPDATA_PATH: first.data,
      DUDEACC_SKIP_BUILD: '1'
    })
  })

  it('拒绝临时目录之外及另一个套件的数据目录', () => {
    const first = fixture()
    const second = fixture()
    expect(() => assertCliTestPath(first.root, os.homedir())).toThrow()
    expect(() => assertCliTestPath(first.root, second.data)).toThrow()
    expect(() => assertCliTestPath(os.tmpdir(), first.data)).toThrow()
  })

  it('没有本次统一构建标记时拒绝运行', () => {
    const { root, data } = fixture()
    vi.stubEnv('DUDEACC_TEST_BUILD_READY', '')
    expect(() => getCliTestEnv(root, data)).toThrow('npm test')
  })

  it('拒绝通过目录链接重定向到另一套件的数据目录', () => {
    const first = fixture()
    const second = fixture()
    const saved = first.data + '-original'
    fs.renameSync(first.data, saved)
    try {
      fs.symlinkSync(second.data, first.data, process.platform === 'win32' ? 'junction' : 'dir')
      expect(() => assertCliTestPath(first.root, first.data)).toThrow()
    } finally {
      if (fs.existsSync(first.data)) fs.unlinkSync(first.data)
      fs.renameSync(saved, first.data)
    }
  })

  it('退出超时会终止包装器和它创建的子进程', async () => {
    const child = spawn(
      'node',
      [
        '-e',
        "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)"
      ],
      { windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    try {
      const [buffer] = await once(child.stdout, 'data')
      const descendantPid = Number(String(buffer).trim())
      expect(Number.isInteger(descendantPid)).toBe(true)
      await expect(waitCliTestExit(child, 100)).rejects.toThrow('超时')
      expect(() => process.kill(descendantPid, 0)).toThrow()
    } finally {
      await stopCliTestProcess(child)
    }
  }, 20_000)
})

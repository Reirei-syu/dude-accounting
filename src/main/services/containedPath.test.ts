import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveContainedPath, requireStoredFilename } from './containedPath'

const directories: string[] = []
function temporary(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-contained-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('备份受控路径 Windows 与 WSL 输入', () => {
  it.each([
    '../outside',
    'a/../../outside',
    '/tmp/file',
    'C:/file',
    'C:file',
    '//server/share/file',
    '\\\\server\\share',
    'a\\../file',
    'a/..\\file',
    'a\\b',
    './file',
    'a//b',
    'a/./b',
    'a/../b',
    'a/',
    'CON',
    'file:stream',
    'a.',
    'a ',
    ''
  ])('拒绝 %s', (value) => {
    expect(() => resolveContainedPath(temporary(), value)).toThrow()
  })
  it('合法包路径在不存在的子目录中仍限制在根目录内', () => {
    const root = temporary()
    expect(resolveContainedPath(root, 'electronic-vouchers/中文.pdf')).toBe(
      path.join(root, 'electronic-vouchers', '中文.pdf')
    )
  })
  it('同名前缀目录不能通过包含检查', () => {
    const root = temporary()
    expect(() => resolveContainedPath(root, `../${path.basename(root)}-other/a`)).toThrow()
  })
  it('拒绝指向根外的链接或 Windows junction', () => {
    const root = temporary(),
      outside = temporary()
    fs.symlinkSync(
      outside,
      path.join(root, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    expect(() => resolveContainedPath(root, 'link/file')).toThrow('链接')
  })
  it.each(['a/b.pdf', 'a\\b.pdf', '..', 'C:file.pdf'])('存储名必须是纯文件名 %s', (value) => {
    expect(() => requireStoredFilename(value)).toThrow()
  })
})

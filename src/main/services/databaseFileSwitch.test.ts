import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recoverDatabaseFileSwitch,
  switchDatabaseFile,
  withDatabaseImportStaging,
  acquireDatabaseConnectionLease
} from './databaseFileSwitch'

describe('数据库文件切换与恢复点', () => {
  let root: string
  let target: string
  let prepared: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-db-switch-'))
    target = path.join(root, 'main.db')
    prepared = path.join(root, 'prepared.db')
    fs.writeFileSync(target, 'original main')
    fs.writeFileSync(`${target}-wal`, 'original wal')
    fs.writeFileSync(`${target}-shm`, 'original shm')
    fs.writeFileSync(prepared, 'replacement')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(root, { recursive: true, force: true })
  })
  const expectOriginal = (): void => {
    expect(fs.readFileSync(target, 'utf8')).toBe('original main')
    expect(fs.readFileSync(`${target}-wal`, 'utf8')).toBe('original wal')
    expect(fs.readFileSync(`${target}-shm`, 'utf8')).toBe('original shm')
  }
  it('成功切换并清除旧 sidecar，保留输入文件', () => {
    switchDatabaseFile(prepared, target)
    expect(fs.readFileSync(target, 'utf8')).toBe('replacement')
    expect(fs.existsSync(`${target}-wal`)).toBe(false)
    expect(fs.existsSync(`${target}-shm`)).toBe(false)
    expect(fs.existsSync(`${target}.recovery`)).toBe(false)
    expect(fs.readFileSync(prepared, 'utf8')).toBe('replacement')
  })
  it('替换异常恢复 main WAL SHM 的原始字节', () => {
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(source).endsWith('prepared.db')) throw new Error('模拟替换失败')
      return rename(source, destination)
    })
    expect(() => switchDatabaseFile(prepared, target)).toThrow('模拟替换失败')
    expectOriginal()
    expect(fs.existsSync(`${target}.recovery`)).toBe(false)
  })
  it('复制中断不修改目标文件', () => {
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw new Error('模拟复制中断')
    })
    expect(() => switchDatabaseFile(prepared, target)).toThrow('模拟复制中断')
    expectOriginal()
    expect(fs.existsSync(`${target}.recovery`)).toBe(false)
  })
  it('回滚失败保留恢复点，重启后可重复恢复', () => {
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (!String(source).endsWith('journal.pending')) throw new Error('模拟文件锁定')
      return rename(source, destination)
    })
    expect(() => switchDatabaseFile(prepared, target)).toThrow('恢复点已保留')
    expect(fs.existsSync(`${target}.recovery`)).toBe(true)
    vi.restoreAllMocks()
    recoverDatabaseFileSwitch(target)
    recoverDatabaseFileSwitch(target)
    expectOriginal()
  })
  it('重启清理已提交状态，不撤销成功替换', () => {
    const remove = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file).endsWith('main.original')) throw new Error('模拟清理锁定')
      return remove(file, options)
    })
    switchDatabaseFile(prepared, target)
    expect(fs.existsSync(`${target}.recovery`)).toBe(true)
    vi.restoreAllMocks()
    recoverDatabaseFileSwitch(target)
    expect(fs.readFileSync(target, 'utf8')).toBe('replacement')
    expect(fs.existsSync(`${target}.recovery`)).toBe(false)
  })
  it('原本不存在的 WAL SHM 回滚后仍不存在', () => {
    fs.rmSync(`${target}-wal`)
    fs.rmSync(`${target}-shm`)
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (String(source).endsWith('prepared.db')) throw new Error('模拟替换失败')
      return rename(source, destination)
    })
    expect(() => switchDatabaseFile(prepared, target)).toThrow()
    expect(fs.readFileSync(target, 'utf8')).toBe('original main')
    expect(fs.existsSync(`${target}-wal`)).toBe(false)
    expect(fs.existsSync(`${target}-shm`)).toBe(false)
  })
  it('清理已删除提交标记后中断，重启不得回滚成功结果', () => {
    const remove = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file).endsWith('main.original')) throw new Error('部分清理中断')
      return remove(file, options)
    })
    switchDatabaseFile(prepared, target)
    expect(fs.existsSync(path.join(`${target}.recovery`, 'committed'))).toBe(false)
    vi.restoreAllMocks()
    recoverDatabaseFileSwitch(target)
    expect(fs.readFileSync(target, 'utf8')).toBe('replacement')
  })
  it('保留无所有权标记的同名目录', () => {
    fs.mkdirSync(`${target}.recovery`)
    const notes = path.join(`${target}.recovery`, 'user-notes.txt')
    fs.writeFileSync(notes, '用户文件')
    expect(() => recoverDatabaseFileSwitch(target)).toThrow('所有权未知')
    expect(fs.readFileSync(notes, 'utf8')).toBe('用户文件')
    expectOriginal()
  })
  it('重启清理已失去执行者的受控导入暂存目录', () => {
    const staging = `${target}.import-staging-abcd`
    fs.mkdirSync(staging)
    fs.writeFileSync(path.join(staging, 'owner'), 'dude-import-staging-v1')
    fs.mkdirSync(path.join(staging, 'package'))
    fs.writeFileSync(path.join(staging, 'package', 'partial.db'), 'partial')
    recoverDatabaseFileSwitch(target)
    expect(fs.existsSync(staging)).toBe(false)
    expectOriginal()
  })
  it('启动保留没有所有权标记的导入同名目录', () => {
    const staging = `${target}.import-staging-abcd`
    fs.mkdirSync(staging)
    fs.writeFileSync(path.join(staging, 'notes.txt'), '用户记录')
    expect(() => recoverDatabaseFileSwitch(target)).toThrow('所有权未知')
    expect(fs.readFileSync(path.join(staging, 'notes.txt'), 'utf8')).toBe('用户记录')
  })
  it('成功后的暂存清理中断不改报失败，保留 owner 并可在重启清理', () => {
    let stagingPath = ''
    const remove = fs.rmSync
    vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file).endsWith(`${path.sep}package`)) throw new Error('模拟清理中断')
      return remove(file, options)
    })
    const result = withDatabaseImportStaging(target, (staging) => {
      stagingPath = staging
      fs.mkdirSync(path.join(staging, 'package'))
      return 'completed'
    })
    expect(result).toBe('completed')
    expect(fs.existsSync(path.join(stagingPath, 'owner'))).toBe(true)
    vi.restoreAllMocks()
    recoverDatabaseFileSwitch(target)
    expect(fs.existsSync(stagingPath)).toBe(false)
    expectOriginal()
  })
  it('其他连接仍持共享锁时拒绝切换，释放后允许升级', () => {
    const release = acquireDatabaseConnectionLease(target)
    const other = new Database(`${target}.switch-lock.sqlite`)
    other.exec('BEGIN; SELECT name FROM sqlite_master LIMIT 1')
    try {
      expect(() => switchDatabaseFile(prepared, target)).toThrow('locked')
      expectOriginal()
      other.exec('ROLLBACK')
      switchDatabaseFile(prepared, target)
      expect(fs.readFileSync(target, 'utf8')).toBe('replacement')
    } finally {
      other.close()
      release()
    }
  })
})

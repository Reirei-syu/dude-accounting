import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { resolveContainedPath } from './containedPath'

const members = ['main', 'wal', 'shm'] as const
type Member = (typeof members)[number]
interface SwitchJournal {
  version: 1
  original: Record<Member, boolean>
  assetGeneration?: string
}

function assetLocation(targetPath: string, generation: string): string {
  if (!/^[a-f0-9-]{36}$/.test(generation)) throw new Error('无效的导入资产批次')
  return resolveContainedPath(path.dirname(path.resolve(targetPath)), `import-assets/${generation}`)
}

function locations(targetPath: string): { root: string; targets: Record<Member, string> } {
  const parent = path.dirname(path.resolve(targetPath))
  const name = path.basename(targetPath)
  const root = resolveContainedPath(parent, `${name}.recovery`)
  const targets = {
    main: resolveContainedPath(parent, name),
    wal: resolveContainedPath(parent, `${name}-wal`),
    shm: resolveContainedPath(parent, `${name}-shm`)
  }
  return { root, targets }
}

function writeDurable(filePath: string, content: string): void {
  const fd = fs.openSync(filePath, 'wx')
  try {
    fs.writeFileSync(fd, content)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function copyDurable(source: string, destination: string): void {
  fs.copyFileSync(source, destination)
  const fd = fs.openSync(destination, 'r+')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function cleanupRecovery(root: string): void {
  const allowed = new Set([
    'owner',
    'journal.pending',
    'prepared.db',
    'commit.pending',
    'committed',
    'assets',
    ...members.flatMap((member) => [`${member}.original`, `${member}.rollback`])
  ])
  const entries = fs.readdirSync(root)
  if (entries.some((entry) => !allowed.has(entry)))
    throw new Error(`恢复目录包含未知文件，已保留：${root}`)
  for (const entry of entries.filter((entry) => entry !== 'owner')) {
    fs.rmSync(resolveContainedPath(root, entry), { recursive: true, force: true })
  }
  fs.rmSync(resolveContainedPath(root, 'owner'), { force: true })
  fs.rmdirSync(root)
}

/** 必须在打开任何数据库连接前执行。失败时保留恢复点并阻止启动。 */
export function recoverDatabaseFileSwitch(targetPath: string): void {
  const parent = path.dirname(path.resolve(targetPath))
  if (
    !fs.existsSync(locations(targetPath).root) &&
    !fs
      .readdirSync(parent)
      .some((name) => name.startsWith(`${path.basename(targetPath)}.import-staging-`))
  )
    return
  withSwitchLock(targetPath, () => {
    recoverUnlocked(targetPath)
    cleanupImportStaging(targetPath)
  })
}

const heldLocks = new Set<string>()
const connectionLeases = new Map<string, { connection: Database.Database; count: number }>()

function switchLockPath(targetPath: string): string {
  return resolveContainedPath(
    path.dirname(path.resolve(targetPath)),
    `${path.basename(targetPath)}.switch-lock.sqlite`
  )
}

function beginShared(connection: Database.Database): void {
  connection.exec('BEGIN; SELECT name FROM sqlite_master LIMIT 1;')
}

export function acquireDatabaseConnectionLease(targetPath: string): () => void {
  const lockPath = switchLockPath(targetPath)
  let lease = connectionLeases.get(lockPath)
  if (!lease) {
    const connection = new Database(lockPath, { timeout: 0 })
    try {
      beginShared(connection)
    } catch (error) {
      connection.close()
      throw error
    }
    lease = { connection, count: 0 }
    connectionLeases.set(lockPath, lease)
  }
  lease.count++
  let released = false
  return () => {
    if (released) return
    released = true
    lease.count--
    if (!lease.count && !heldLocks.has(lockPath)) {
      if (lease.connection.inTransaction) lease.connection.exec('ROLLBACK')
      lease.connection.close()
      connectionLeases.delete(lockPath)
    }
  }
}

export function withDatabaseImportStaging<T>(
  targetPath: string,
  action: (staging: string) => T
): T {
  return withSwitchLock(targetPath, () => {
    recoverUnlocked(targetPath)
    cleanupImportStaging(targetPath)
    const staging = fs.mkdtempSync(
      path.join(path.dirname(targetPath), `${path.basename(targetPath)}.import-staging-`)
    )
    let result: T
    try {
      writeDurable(resolveContainedPath(staging, 'owner'), 'dude-import-staging-v1')
      result = action(staging)
    } catch (error) {
      try {
        cleanupImportStaging(targetPath)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `导入失败，暂存目录待恢复：${staging}`)
      }
      throw error
    }
    // 成功后的清理可重试，不将已提交结果改报失败。
    try {
      cleanupImportStaging(targetPath)
    } catch {
      /* 所有权标记保留，启动重试 */
    }
    return result
  })
}

function cleanupImportStaging(targetPath: string): void {
  const parent = path.dirname(path.resolve(targetPath))
  const prefix = `${path.basename(targetPath)}.import-staging-`
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.name.startsWith(prefix)) continue
    const directory = resolveContainedPath(parent, entry.name)
    if (!entry.isDirectory()) throw new Error('导入暂存路径不是目录，已保留')
    const entries = fs.readdirSync(directory)
    const owner = resolveContainedPath(directory, 'owner')
    if (
      entries.length &&
      (!fs.existsSync(owner) || fs.readFileSync(owner, 'utf8') !== 'dude-import-staging-v1')
    ) {
      throw new Error('导入暂存目录所有权未知，已保留')
    }
    if (entries.some((name) => !['owner', 'assets', 'package', 'migration-backups'].includes(name)))
      throw new Error('导入暂存目录含未知文件，已保留')
    for (const name of entries.filter((name) => name !== 'owner'))
      fs.rmSync(resolveContainedPath(directory, name), { recursive: true, force: true })
    fs.rmSync(owner, { force: true })
    fs.rmdirSync(directory)
  }
}

export function withDatabaseReplacementLock<T>(targetPath: string, action: () => T): T {
  return withSwitchLock(targetPath, action)
}

function withSwitchLock<T>(targetPath: string, action: () => T): T {
  const lockPath = switchLockPath(targetPath)
  if (heldLocks.has(lockPath)) return action()
  const lease = connectionLeases.get(lockPath)
  const lock = lease?.connection ?? new Database(lockPath, { timeout: 0 })
  try {
    if (lock.inTransaction) lock.exec('ROLLBACK')
    // SQLite 的操作系统锁随进程退出释放，不依赖 PID 存活推断。
    lock.exec('BEGIN EXCLUSIVE')
    heldLocks.add(lockPath)
    return action()
  } finally {
    heldLocks.delete(lockPath)
    if (lock.inTransaction) lock.exec('ROLLBACK')
    if (lease && lease.count > 0) beginShared(lock)
    else {
      lock.close()
      connectionLeases.delete(lockPath)
    }
  }
}

function recoverUnlocked(targetPath: string): void {
  const { root, targets } = locations(targetPath)
  if (!fs.existsSync(root)) return
  const journalPath = resolveContainedPath(root, 'journal.json')
  if (!fs.existsSync(journalPath)) {
    const entries = fs.readdirSync(root)
    const owner = resolveContainedPath(root, 'owner')
    if (
      entries.length &&
      (!fs.existsSync(owner) || fs.readFileSync(owner, 'utf8') !== 'dude-database-switch-v1')
    ) {
      throw new Error(`恢复目录所有权未知，已保留：${root}`)
    }
    // 只有 journal 原子发布后才允许触碰目标库；准备阶段中断可直接清理。
    cleanupRecovery(root)
    return
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as SwitchJournal
  if (
    journal.version !== 1 ||
    !journal.original ||
    members.some((member) => typeof journal.original[member] !== 'boolean')
  ) {
    throw new Error(`恢复点清单无效，禁止打开数据库：${root}`)
  }
  const assetPath = journal.assetGeneration
    ? assetLocation(targetPath, journal.assetGeneration)
    : null
  if (!fs.existsSync(resolveContainedPath(root, 'committed'))) {
    // 先验证全部恢复副本，不能在缺失副本时进行部分恢复。
    for (const member of members) {
      if (
        journal.original[member] &&
        !fs.statSync(resolveContainedPath(root, `${member}.original`)).isFile()
      ) {
        throw new Error(`恢复点文件缺失：${member}`)
      }
    }
    for (const member of members) {
      if (journal.original[member]) {
        const replacement = resolveContainedPath(root, `${member}.rollback`)
        copyDurable(resolveContainedPath(root, `${member}.original`), replacement)
        fs.renameSync(replacement, targets[member])
      } else {
        fs.rmSync(targets[member], { force: true })
      }
    }
    if (assetPath) fs.rmSync(assetPath, { recursive: true, force: true })
  }
  // 先不可逆地退出可回滚状态；清理中断不能让成功提交变成回滚。
  fs.unlinkSync(journalPath)
  cleanupRecovery(root)
}

/** 调用方须先完成载荷验证并关闭目标库；失败恢复原 main/WAL/SHM。 */
export function switchDatabaseFile(
  preparedPath: string,
  targetPath: string,
  assets?: { preparedPath: string; generation: string }
): void {
  withSwitchLock(targetPath, () => switchUnlocked(preparedPath, targetPath, assets))
}

function switchUnlocked(
  preparedPath: string,
  targetPath: string,
  assets?: { preparedPath: string; generation: string }
): void {
  recoverUnlocked(targetPath)
  const { root, targets } = locations(targetPath)
  fs.mkdirSync(root)
  let committed = false
  try {
    writeDurable(resolveContainedPath(root, 'owner'), 'dude-database-switch-v1')
    const original = Object.fromEntries(
      members.map((member) => [member, fs.existsSync(targets[member])])
    ) as Record<Member, boolean>
    for (const member of members) {
      if (original[member])
        copyDurable(targets[member], resolveContainedPath(root, `${member}.original`))
    }
    const staged = resolveContainedPath(root, 'prepared.db')
    copyDurable(preparedPath, staged)
    const assetPath = assets ? assetLocation(targetPath, assets.generation) : null
    if (assetPath && fs.existsSync(assetPath)) throw new Error('导入资产批次已存在')
    if (assets) fs.renameSync(assets.preparedPath, resolveContainedPath(root, 'assets'))
    const pendingJournal = resolveContainedPath(root, 'journal.pending')
    writeDurable(
      pendingJournal,
      JSON.stringify({
        version: 1,
        original,
        assetGeneration: assets?.generation
      } satisfies SwitchJournal)
    )
    fs.renameSync(pendingJournal, resolveContainedPath(root, 'journal.json'))
    if (assetPath) {
      fs.mkdirSync(path.dirname(assetPath), { recursive: true })
      fs.renameSync(resolveContainedPath(root, 'assets'), assetPath)
    }
    fs.rmSync(targets.wal, { force: true })
    fs.rmSync(targets.shm, { force: true })
    fs.renameSync(staged, targets.main)
    writeDurable(resolveContainedPath(root, 'commit.pending'), '1')
    fs.renameSync(
      resolveContainedPath(root, 'commit.pending'),
      resolveContainedPath(root, 'committed')
    )
    committed = true
  } catch (error) {
    try {
      recoverUnlocked(targetPath)
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `数据库切换失败，恢复点已保留，禁止继续使用：${root}`
      )
    }
    throw error
  } finally {
    // 已提交后的清理失败不是回滚；下次启动会依据 committed 标记完成清理。
    if (committed) {
      try {
        recoverUnlocked(targetPath)
      } catch {
        /* 保留可重试的清理状态 */
      }
    }
  }
}

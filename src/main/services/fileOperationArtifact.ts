import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { resolveContainedPath } from './containedPath'
import type {
  FileOperationJournal,
  FileOperationLease,
  FileOperationRecoveryRecord
} from './fileOperationJournal'
import { requireOperationId } from './fileOperationJournal'
import type { FileOperationRecoveryHandler } from './fileOperationLifecycle'
import { assertSynchronousOperation, type SynchronousResult } from './auditedTransaction'

interface ArtifactPlan {
  artifactVersion: 1
  parent: string
  directory: string
  owner: string
  digest?: string
  inventory?: Record<string, string>
  cleanupFinalizing?: boolean
}

function readPlan(record: FileOperationRecoveryRecord): ArtifactPlan {
  const plan = record.recoveryPlan as unknown as ArtifactPlan
  if (
    plan.artifactVersion !== 1 ||
    typeof plan.parent !== 'string' ||
    !path.isAbsolute(plan.parent) ||
    plan.directory !== `operation-${requireOperationId(record.operationId)}` ||
    typeof plan.owner !== 'string'
  )
    throw new Error('文件操作恢复计划无效')
  requireOperationId(plan.owner)
  return plan
}

function artifactRoot(plan: ArtifactPlan): string {
  return resolveContainedPath(plan.parent, plan.directory)
}

function assertOwner(plan: ArtifactPlan): string {
  const root = artifactRoot(plan)
  const ownerFile = resolveContainedPath(root, '.owner')
  if (fs.readFileSync(ownerFile, 'utf8') !== plan.owner) throw new Error('产物目录归属不匹配')
  return root
}

/** 包含目录结构、文件名和内容；拒绝链接和特殊文件。 */
export function treeDigest(root: string): string {
  const hash = createHash('sha256')
  function visit(relative: string): void {
    const current = relative ? resolveContainedPath(root, relative) : root
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('产物包含链接')
    if (stat.isDirectory()) {
      hash.update(JSON.stringify(['directory', relative]))
      for (const name of fs.readdirSync(current).sort())
        visit(relative ? `${relative}/${name}` : name)
    } else if (stat.isFile()) {
      hash.update(JSON.stringify(['file', relative, stat.size]))
      hash.update(createHash('sha256').update(fs.readFileSync(current)).digest())
    } else throw new Error('产物包含特殊文件')
  }
  visit('')
  return hash.digest('hex')
}

function treeInventory(root: string): Record<string, string> {
  const inventory: Record<string, string> = Object.create(null)
  function visit(relative: string): void {
    const current = resolveContainedPath(root, relative)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('产物包含链接')
    if (stat.isDirectory()) {
      inventory[relative] = 'directory'
      for (const name of fs.readdirSync(current)) visit(`${relative}/${name}`)
    } else if (stat.isFile()) {
      inventory[relative] = createHash('sha256').update(fs.readFileSync(current)).digest('hex')
    } else throw new Error('产物包含特殊文件')
  }
  for (const name of fs.readdirSync(root)) visit(name)
  return inventory
}

export function assertFileOperationArtifactOwner(record: FileOperationRecoveryRecord): void {
  assertOwner(readPlan(record))
}

export const fileOperationArtifactRecovery: FileOperationRecoveryHandler = {
  verify(record): boolean {
    const plan = readPlan(record)
    const root = assertOwner(plan)
    return (
      typeof plan.digest === 'string' &&
      treeDigest(resolveContainedPath(root, 'result')) === plan.digest
    )
  },
  compensate(record, savePlan): undefined {
    if (Object.keys(record.recoveryPlan).length === 0) return
    const plan = readPlan(record)
    const root = artifactRoot(plan)
    if (!fs.existsSync(root)) return
    if (plan.cleanupFinalizing && fs.readdirSync(root).length === 0) {
      fs.rmdirSync(root)
      return
    }
    assertOwner(plan)
    // 验证所有后代都不含链接；未发布的部分文件仍归属于独占创建的操作容器。
    treeDigest(root)
    const entries = fs.readdirSync(root)
    if (entries.some((name) => !['.owner', 'staging', 'result'].includes(name)))
      throw new Error('产物目录出现非本操作文件，禁止清理')
    for (const name of ['staging', 'result']) {
      const directory = resolveContainedPath(root, name)
      if (!fs.existsSync(directory)) continue
      if (plan.inventory) {
        const remaining = treeInventory(directory)
        if (Object.entries(remaining).some(([entry, hash]) => plan.inventory?.[entry] !== hash))
          throw new Error('产物内容已改变，禁止自动清理')
      } else if (plan.digest && treeDigest(directory) !== plan.digest) {
        throw new Error('产物内容已改变，禁止自动清理')
      }
    }
    // 归属标记最后删除；逐个删除允许恢复时接受清单的剩余子集。
    for (const name of ['staging', 'result']) {
      const directory = resolveContainedPath(root, name)
      if (!fs.existsSync(directory)) continue
      const remaining = treeInventory(directory)
      for (const entry of Object.keys(remaining).sort(
        (a, b) => b.split('/').length - a.split('/').length
      )) {
        const target = resolveContainedPath(directory, entry)
        if (remaining[entry] === 'directory') fs.rmdirSync(target)
        else fs.unlinkSync(target)
      }
      fs.rmdirSync(directory)
    }
    savePlan?.({ ...plan, cleanupFinalizing: true })
    fs.unlinkSync(resolveContainedPath(root, '.owner'))
    fs.rmdirSync(root)
  }
}

export function prepareFileOperationArtifact<T>(
  journal: FileOperationJournal,
  lease: FileOperationLease,
  operationId: string,
  parent: string,
  write: (staging: string, finalDirectory: string) => T & SynchronousResult<T>,
  metadata: Record<string, unknown> = {}
): string {
  assertSynchronousOperation(write as () => unknown)
  if (!path.isAbsolute(parent)) throw new Error('产物目录必须是显式绝对路径')
  const plan: ArtifactPlan = {
    ...metadata,
    artifactVersion: 1,
    parent,
    directory: `operation-${requireOperationId(operationId)}`,
    owner: randomUUID()
  }
  journal.saveRecoveryPlan(lease, operationId, { ...plan })
  const root = artifactRoot(plan)
  fs.mkdirSync(root, { mode: 0o700 })
  fs.writeFileSync(resolveContainedPath(root, '.owner'), plan.owner, { flag: 'wx', mode: 0o600 })
  const staging = resolveContainedPath(root, 'staging')
  const finalDirectory = resolveContainedPath(root, 'result')
  fs.mkdirSync(staging)
  const result = write(staging, finalDirectory)
  if (result && typeof (result as { then?: unknown }).then === 'function')
    throw new Error('产物写入回调不得返回 Promise')
  plan.digest = treeDigest(staging)
  plan.inventory = treeInventory(staging)
  journal.saveRecoveryPlan(lease, operationId, { ...plan })
  journal.checkpoint(lease, operationId, 'files_staged')
  if (fs.existsSync(finalDirectory)) throw new Error('发布目标已存在，禁止覆盖')
  fs.renameSync(staging, finalDirectory)
  journal.checkpoint(lease, operationId, 'files_published')
  return finalDirectory
}

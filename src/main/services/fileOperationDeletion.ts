import fs from 'node:fs'
import path from 'node:path'
import { assertFileOperationArtifactOwner, fileOperationArtifactRecovery, prepareFileOperationArtifact, treeDigest } from './fileOperationArtifact'
import type { FileOperationJournal, FileOperationLease, FileOperationRecoveryRecord } from './fileOperationJournal'
import type { FileOperationRecoveryHandler } from './fileOperationLifecycle'
import { resolveContainedPath } from './containedPath'

interface DeletionEntry { original: string; name: string; digest: string }

function entries(record: FileOperationRecoveryRecord): DeletionEntry[] {
  const value = record.recoveryPlan.deletionEntries
  if (!Array.isArray(value) || value.some(entry => !entry || typeof entry.original !== 'string' ||
    !path.isAbsolute(entry.original) || !/^item-\d+$/.test(entry.name) || typeof entry.digest !== 'string'))
    throw new Error('删除恢复清单无效')
  return value as DeletionEntry[]
}

function root(record: FileOperationRecoveryRecord): string {
  const parent = record.recoveryPlan.parent
  if (typeof parent !== 'string' || !path.isAbsolute(parent)) throw new Error('删除暂存目录无效')
  return resolveContainedPath(parent, `operation-${record.operationId}`)
}

export const fileOperationDeletionRecovery: FileOperationRecoveryHandler = {
  verify(record) {
    if (entries(record).some(entry => fs.existsSync(entry.original))) return false
    return !fs.existsSync(root(record)) || fileOperationArtifactRecovery.verify(record)
  },
  complete(record, savePlan): undefined {
    if (entries(record).some(entry => fs.existsSync(entry.original))) throw new Error('删除目标重新出现，禁止收尾')
    fileOperationArtifactRecovery.compensate(record, savePlan)
  },
  compensate(record, savePlan): undefined {
    if (Object.keys(record.recoveryPlan).length === 0) return
    const container = root(record)
    if (fs.existsSync(container) && !(record.recoveryPlan.cleanupFinalizing && fs.readdirSync(container).length === 0))
      assertFileOperationArtifactOwner(record)
    for (const entry of entries(record)) {
      const candidates = ['staging', 'result'].map(directory => resolveContainedPath(container, `${directory}/${entry.name}`))
      const existing = candidates.filter(candidate => fs.existsSync(candidate))
      if (existing.length > 1) throw new Error('删除恢复文件重复，禁止覆盖')
      if (existing.length === 1) {
        if (treeDigest(existing[0]) !== entry.digest)
          throw new Error('原位置或暂存内容发生变化，禁止覆盖恢复')
        const source = fs.lstatSync(existing[0], { bigint: true })
        if (source.isFile()) {
          // 硬链接创建是原子的且绝不替换目标；创建后退出可凭文件身份继续。
          try { fs.linkSync(existing[0], entry.original) } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const target = fs.lstatSync(entry.original, { bigint: true })
            if (!target.isFile() || target.dev !== source.dev || target.ino !== source.ino)
              throw new Error('原位置已被其他文件占用，禁止覆盖恢复')
          }
          fs.unlinkSync(existing[0])
        } else {
          if (fs.existsSync(entry.original)) throw new Error('原位置已被占用，禁止覆盖恢复')
          fs.renameSync(existing[0], entry.original)
        }
      } else if (!fs.existsSync(entry.original) || treeDigest(entry.original) !== entry.digest) {
        throw new Error('删除恢复文件缺失或被修改')
      }
    }
    fileOperationArtifactRecovery.compensate(record, savePlan)
  }
}

export function prepareFileOperationDeletion(
  journal: FileOperationJournal, lease: FileOperationLease, operationId: string,
  targets: string[], parent: string
): void {
  const deletionEntries = targets.map((original, index) => {
    if (!path.isAbsolute(original) || path.parse(original).root === original)
      throw new Error('删除目标必须是明确的非根绝对路径')
    const relativeParent = path.relative(original, parent)
    if (!relativeParent || (!relativeParent.startsWith('..') && !path.isAbsolute(relativeParent)))
      throw new Error('删除暂存目录不得位于删除目标内')
    return { original, name: `item-${index}`, digest: treeDigest(original) }
  })
  prepareFileOperationArtifact(journal, lease, operationId, parent, staging => {
    for (const entry of deletionEntries) fs.renameSync(entry.original, resolveContainedPath(staging, entry.name))
  }, { deletionEntries })
}

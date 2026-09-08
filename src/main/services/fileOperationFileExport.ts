import fs from 'node:fs'
import path from 'node:path'
import { assertFileOperationArtifactOwner, fileOperationArtifactRecovery, prepareFileOperationArtifact } from './fileOperationArtifact'
import type { FileOperationJournal, FileOperationLease, FileOperationRecoveryRecord } from './fileOperationJournal'
import type { FileOperationRecoveryHandler } from './fileOperationLifecycle'
import { resolveContainedPath } from './containedPath'

function locations(record: FileOperationRecoveryRecord): { source: string; target: string } {
  const { parent, exportTarget } = record.recoveryPlan
  if (typeof parent !== 'string' || typeof exportTarget !== 'string' || !path.isAbsolute(exportTarget))
    throw new Error('导出恢复计划无效')
  return { source: resolveContainedPath(parent, `operation-${record.operationId}/result/export`), target: exportTarget }
}

function sameFile(source: string, target: string): boolean {
  if (!fs.existsSync(source) || !fs.existsSync(target)) return false
  const a = fs.lstatSync(source, { bigint: true })
  const b = fs.lstatSync(target, { bigint: true })
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino
}

/** 保留独占容器中的文件身份作为发布证据，禁止替换既有目标。 */
export const fileOperationFileExportRecovery: FileOperationRecoveryHandler = {
  verify(record) {
    const { source, target } = locations(record)
    return fileOperationArtifactRecovery.verify(record) && sameFile(source, target)
  },
  compensate(record, savePlan): undefined {
    if (Object.keys(record.recoveryPlan).length === 0) return
    const { source, target } = locations(record)
    const withdrawn = path.join(path.dirname(source), 'withdrawn')
    if (fs.existsSync(withdrawn) || sameFile(source, target)) {
      assertFileOperationArtifactOwner(record)
      if (!fs.existsSync(withdrawn)) {
        if (!fileOperationArtifactRecovery.verify(record)) throw new Error('导出内容已改变，禁止自动撤回')
        // 公共路径可能被其他程序原子替换；先隔离对象，再按文件身份决定是否删除。
        fs.renameSync(target, withdrawn)
      }
      if (!sameFile(source, withdrawn)) {
        // 不能覆盖再次出现的文件；冲突时保留隔离对象，交由人工处理。
        try { fs.linkSync(withdrawn, target) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !sameFile(withdrawn, target)) throw error
        }
        fs.unlinkSync(withdrawn)
        throw new Error('导出目标已被其他文件替换，已保留原内容')
      }
      fs.unlinkSync(withdrawn)
    }
    fileOperationArtifactRecovery.compensate(record, savePlan)
  }
}

export function prepareFileOperationFileExport(
  journal: FileOperationJournal, lease: FileOperationLease, operationId: string,
  target: string, contents: string
): void {
  if (!path.isAbsolute(target)) throw new Error('导出文件必须使用显式绝对路径')
  const directory = prepareFileOperationArtifact(journal, lease, operationId, path.dirname(target),
    staging => { fs.writeFileSync(path.join(staging, 'export'), contents, { flag: 'wx', encoding: 'utf8' }) },
    { exportTarget: target })
  fs.linkSync(path.join(directory, 'export'), target)
  journal.checkpoint(lease, operationId, 'export_published')
}

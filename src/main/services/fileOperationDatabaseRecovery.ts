import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type { FileOperationRecoveryHandler } from './fileOperationLifecycle'
import type { FileOperationRecoveryRecord } from './fileOperationJournal'
import { checkDatabaseIntegrity } from '../database/migrationSchema'
import { treeDigest } from './fileOperationArtifact'

function target(record: FileOperationRecoveryRecord): string {
  const value = record.recoveryPlan.targetPath
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('数据库恢复计划无效')
  if (fs.existsSync(`${value}.recovery`)) throw new Error('数据库切换恢复点尚未收敛')
  return value
}

/** 文件切换自身的恢复先于数据库打开完成；此处只核验，不再次替换业务数据。 */
export const fileOperationDatabaseRecovery: FileOperationRecoveryHandler = {
  verify(record) {
    if (record.recoveryPlan.assetPath) {
      const assetPath = record.recoveryPlan.assetPath
      if (
        typeof assetPath !== 'string' ||
        !path.isAbsolute(assetPath) ||
        treeDigest(assetPath) !== record.recoveryPlan.assetDigest
      )
        return false
    }
    const db = new Database(target(record), { readonly: true, fileMustExist: true })
    try {
      checkDatabaseIntegrity(db)
      return true
    } finally {
      db.close()
    }
  },
  compensate(record): undefined {
    if (Object.keys(record.recoveryPlan).length === 0) return
    target(record)
    if (
      typeof record.recoveryPlan.assetPath === 'string' &&
      fs.existsSync(record.recoveryPlan.assetPath)
    )
      throw new Error('未提交导入仍存在附件，需人工确认')
  }
}

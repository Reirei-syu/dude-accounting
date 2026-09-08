import type Database from 'better-sqlite3'
import { FileOperationJournal } from './fileOperationJournal'
import { FileOperationLifecycle } from './fileOperationLifecycle'
import { fileOperationArtifactRecovery } from './fileOperationArtifact'
import { fileOperationDatabaseRecovery } from './fileOperationDatabaseRecovery'
import { fileOperationDeletionRecovery } from './fileOperationDeletion'
import { fileOperationFileExportRecovery } from './fileOperationFileExport'

/** 主库迁移及文件切换恢复完成后调用；不读取隐式 cwd 或另一个业务库。 */
export function recoverPendingFileOperations(db: Database.Database): {
  busy: boolean
  recovered: number
  manual: number
} {
  const journal = new FileOperationJournal(db.name)
  try {
    return new FileOperationLifecycle(journal, db).recoverPending({
      backup_create: fileOperationArtifactRecovery,
      archive_export: fileOperationArtifactRecovery,
      electronic_voucher_import: fileOperationArtifactRecovery,
      backup_restore: fileOperationDatabaseRecovery,
      backup_import: fileOperationDatabaseRecovery,
      backup_delete: fileOperationDeletionRecovery,
      archive_delete: fileOperationDeletionRecovery,
      audit_log_export: fileOperationFileExportRecovery
    })
  } finally {
    journal.close()
  }
}

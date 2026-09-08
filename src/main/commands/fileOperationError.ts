import { classifyFileOperationError, type FileOperationJournal } from '../services/fileOperationJournal'
import { CommandError } from './types'

export function fileOperationCommandError(error: unknown, operationId: string, journal: FileOperationJournal): CommandError {
  const record = journal.getRecoveryRecord(operationId)
  return new CommandError(
    error instanceof CommandError ? error.code : 'FILE_OPERATION_FAILED',
    error instanceof CommandError ? error.message : '文件操作未完成，请按操作 ID 查询处理状态',
    { ...(error instanceof CommandError && error.code === 'RISK_CONFIRMATION_REQUIRED' ? { missingPhysicalPackage: true } : {}),
      operationId, state: record?.state ?? 'planned', errorCode: record?.errorCode ?? classifyFileOperationError(error),
      compensation: record?.compensation ?? 'not_needed' },
    error instanceof CommandError ? error.exitCode : 10
  )
}

/** GUI 适配与 CLI 共用的业务结果，不包含数据库或 Electron 运行时类型。 */
export type CommandErrorCode =
  | 'AUTH_FAILED'
  | 'FILE_OPERATION_FAILED'
  | 'LEDGER_ACCESS_DENIED'
  | 'NOT_IMPLEMENTED'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'RISK_CONFIRMATION_REQUIRED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

export interface CommandFailure {
  code: CommandErrorCode
  message: string
  details: Record<string, unknown> | null
}

export interface CommandResult<T> {
  status: 'success' | 'error'
  data: T | null
  error: CommandFailure | null
}

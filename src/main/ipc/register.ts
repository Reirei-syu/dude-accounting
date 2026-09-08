import { registerAuthHandlers } from './auth'
import { registerLedgerHandlers } from './ledger'
import { registerSubjectHandlers } from './subject'
import { registerAuxiliaryHandlers } from './auxiliary'
import { registerSettingsHandlers } from './settings'
import { registerVoucherHandlers } from './voucher'
import { registerCashFlowHandlers } from './cashflow'
import { registerInitialBalanceHandlers } from './initialBalance'
import { registerPeriodHandlers } from './period'
import { registerPLCarryForwardHandlers } from './plCarryForward'
import { registerAuditLogHandlers } from './auditLog'
import { registerBackupHandlers } from './backup'
import { registerArchiveHandlers } from './archive'
import { registerElectronicVoucherHandlers } from './eVoucher'
import { registerReportingHandlers } from './reporting'
import { registerBookQueryHandlers } from './bookQuery'
import { registerPrintHandlers } from './print'
import { registerDiagnosticsHandlers } from './diagnostics'

/** 主程序与契约测试使用同一注册入口，防止清单与实际启动路径漂移。 */
export function registerIpcHandlers(): void {
  registerAuthHandlers()
  registerLedgerHandlers()
  registerSubjectHandlers()
  registerAuxiliaryHandlers()
  registerSettingsHandlers()
  registerVoucherHandlers()
  registerCashFlowHandlers()
  registerInitialBalanceHandlers()
  registerPeriodHandlers()
  registerPLCarryForwardHandlers()
  registerAuditLogHandlers()
  registerBackupHandlers()
  registerArchiveHandlers()
  registerElectronicVoucherHandlers()
  registerReportingHandlers()
  registerBookQueryHandlers()
  registerPrintHandlers()
  registerDiagnosticsHandlers()
}

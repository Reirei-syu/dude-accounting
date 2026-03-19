import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initializeDatabase, closeDatabase, getDatabase } from './database/init'
import { appendOperationLog } from './services/auditLog'
import {
  clearPendingRestoreLog,
  getPendingRestoreLogPath,
  readPendingRestoreLog
} from './services/pendingRestoreLog'
import { registerAuthHandlers } from './ipc/auth'
import { registerLedgerHandlers } from './ipc/ledger'
import { registerSubjectHandlers } from './ipc/subject'
import { registerAuxiliaryHandlers } from './ipc/auxiliary'
import { registerSettingsHandlers } from './ipc/settings'
import { registerVoucherHandlers } from './ipc/voucher'
import { registerCashFlowHandlers } from './ipc/cashflow'
import { registerInitialBalanceHandlers } from './ipc/initialBalance'
import { registerPeriodHandlers } from './ipc/period'
import { registerPLCarryForwardHandlers } from './ipc/plCarryForward'
import { registerAuditLogHandlers } from './ipc/auditLog'
import { registerBackupHandlers } from './ipc/backup'
import { registerArchiveHandlers } from './ipc/archive'
import { registerElectronicVoucherHandlers } from './ipc/eVoucher'
import { registerReportingHandlers } from './ipc/reporting'
import { registerBookQueryHandlers } from './ipc/bookQuery'
import { registerPrintHandlers } from './ipc/print'
import { registerDiagnosticsHandlers } from './ipc/diagnostics'
import { installGlobalErrorLogging } from './services/errorLog'
import { getRuntimeUserDataPath } from './services/runtimeAppPaths'

const runtimeUserDataPath = getRuntimeUserDataPath(app.getPath('appData'), is.dev)
if (runtimeUserDataPath) {
  app.setPath('userData', runtimeUserDataPath)
}

installGlobalErrorLogging(() => app.getPath('userData'))

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function flushPendingRestoreLog(): void {
  const pendingLogPath = getPendingRestoreLogPath(app.getPath('userData'))
  const payload = readPendingRestoreLog(pendingLogPath)
  if (!payload) {
    return
  }

  try {
    appendOperationLog(getDatabase(), {
      ledgerId: payload.ledgerId,
      userId: payload.userId,
      username: payload.username,
      module: 'backup',
      action: 'restore',
      targetType: payload.targetType,
      targetId: payload.targetId,
      details: {
        backupPath: payload.backupPath,
        manifestPath: payload.manifestPath,
        restartRequired: true,
        backupMode: payload.backupMode
      }
    })
  } finally {
    clearPendingRestoreLog(pendingLogPath)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dudeaccounting')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  initializeDatabase()
  flushPendingRestoreLog()

  // Register IPC handlers
  registerAuthHandlers()
  registerLedgerHandlers()
  registerSubjectHandlers()
  registerAuxiliaryHandlers()
  registerSettingsHandlers()
  registerVoucherHandlers()
  registerCashFlowHandlers()
  registerInitialBalanceHandlers()
  registerPLCarryForwardHandlers()
  registerPeriodHandlers()
  registerAuditLogHandlers()
  registerBackupHandlers()
  registerArchiveHandlers()
  registerElectronicVoucherHandlers()
  registerReportingHandlers()
  registerBookQueryHandlers()
  registerPrintHandlers()
  registerDiagnosticsHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

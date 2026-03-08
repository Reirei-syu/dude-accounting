import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initializeDatabase, closeDatabase } from './database/init'
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dudeaccounting')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  initializeDatabase()

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

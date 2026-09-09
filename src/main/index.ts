import { app, BrowserWindow, dialog } from 'electron'
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
import { registerIpcHandlers } from './ipc/register'
import { installGlobalErrorLogging } from './services/errorLog'
import { getRuntimeUserDataPath } from './services/runtimeAppPaths'
import { setRuntimeContext } from './runtime/runtimeContext'
import { consumeEmbeddedCliState } from './runtime/embeddedCliState'
import { flushEmbeddedCliOutput, runEmbeddedCli } from '../cli/embedded'
import path from 'node:path'
import { secureWindowContents } from './services/windowSecurity'

const cliE2eAppDataOverride = process.env.DUDEACC_E2E_APPDATA_PATH?.trim()
if (cliE2eAppDataOverride) {
  app.setPath('appData', path.resolve(cliE2eAppDataOverride))
}

const runtimeUserDataPath = getRuntimeUserDataPath(app.getPath('appData'), is.dev)
app.setPath('userData', runtimeUserDataPath)

installGlobalErrorLogging(() => app.getPath('userData'))

const CLI_FLAG = '--cli'
let embeddedCliRunning = false

function getEmbeddedCliArgv(argv: string[]): string[] | null {
  const cliFlagIndex = argv.indexOf(CLI_FLAG)
  if (cliFlagIndex < 0) {
    return null
  }

  return argv.slice(cliFlagIndex + 1)
}

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
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

  appendOperationLog(getDatabase(), {
    ledgerId: payload.ledgerId,
    userId: payload.userId,
    username: payload.username,
    module: 'backup',
    action: 'restore_legacy_unverified',
    targetType: 'legacy_restore',
    targetId:
      typeof payload.targetId === 'number' && Number.isSafeInteger(payload.targetId)
        ? payload.targetId
        : null,
    details: {
      state: 'recovery_required',
      errorCode: 'LEGACY_RESTORE_UNVERIFIED',
      compensation: 'manual_review_required',
      backupMode: payload.backupMode
    }
  })
  clearPendingRestoreLog(pendingLogPath)
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.dudeaccounting')

  setRuntimeContext({
    productName: 'dude-app',
    appDataPath: app.getPath('appData'),
    documentsPath: app.getPath('documents'),
    userDataPath: app.getPath('userData'),
    executablePath: process.execPath,
    isDevelopment: is.dev,
    isPackaged: app.isPackaged
  })

  app.on('browser-window-created', (_, window) => {
    secureWindowContents(window.webContents)
    optimizer.watchWindowShortcuts(window)
  })

  try {
    initializeDatabase()
    flushPendingRestoreLog()
  } catch (error) {
    dialog.showErrorBox(
      '启动失败',
      error instanceof Error ? error.message : '初始化数据库失败，请检查安装目录与数据目录权限。'
    )
    app.quit()
    return
  }

  const embeddedCliArgv = getEmbeddedCliArgv(process.argv)
  if (embeddedCliArgv) {
    embeddedCliRunning = true
    void runEmbeddedCli(embeddedCliArgv)
      .catch((error) => {
        console.error('CLI 执行异常', error)
        process.exitCode = 10
      })
      .finally(async () => {
        const cliState = consumeEmbeddedCliState()
        if (
          cliState.keepAliveUntilWindowClose &&
          !cliState.relaunchRequested &&
          Number(process.exitCode) === 0 &&
          BrowserWindow.getAllWindows().length > 0
        ) {
          embeddedCliRunning = false
          return
        }
        try {
          closeDatabase()
        } catch (error) {
          console.error('CLI 数据库关闭失败', error)
          process.exitCode = 10
        }
        await flushEmbeddedCliOutput()
        if (cliState.relaunchRequested) app.relaunch()
        app.exit(Number(process.exitCode) || 0)
      })
    return
  }

  // Register IPC handlers
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (embeddedCliRunning) {
    return
  }
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

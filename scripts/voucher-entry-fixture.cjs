const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  window.loadURL(process.env.VOUCHER_FIXTURE_URL)
})
app.on('window-all-closed', () => app.quit())

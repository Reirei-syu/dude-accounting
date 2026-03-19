import { app, ipcMain } from 'electron'
import { writeRendererErrorLog, type RendererErrorPayload } from '../services/errorLog'

export function registerDiagnosticsHandlers(): void {
  ipcMain.on('diagnostics:rendererError', (_event, payload: RendererErrorPayload) => {
    try {
      writeRendererErrorLog(app.getPath('userData'), payload)
    } catch {
      // Renderer error logging must never throw back into the UI thread.
    }
  })
}

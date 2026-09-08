import { contextBridge, ipcRenderer } from 'electron'
import type { PrintPreviewSettings } from '../main/services/print'

// 仅暴露当前打印任务所需的预览操作；不提供通用 IPC、登录或业务数据写入。
contextBridge.exposeInMainWorld('api', {
  print: {
    getPreviewModel: (jobId: string) => ipcRenderer.invoke('print:getPreviewModel', jobId),
    updatePreviewSettings: (payload: { jobId: string; settings: Partial<PrintPreviewSettings> }) =>
      ipcRenderer.invoke('print:updatePreviewSettings', {
        jobId: payload.jobId,
        settings: payload.settings
      }),
    print: (jobId: string) => ipcRenderer.invoke('print:print', String(jobId)),
    exportPdf: (jobId: string) => ipcRenderer.invoke('print:exportPdf', String(jobId))
  }
})

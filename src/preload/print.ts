import { contextBridge, ipcRenderer } from 'electron'
import type { TypedInvoke } from './invoke'
import type { PrintPreviewAPI } from '../shared/contracts/printPreviewApi'

const invoke: TypedInvoke = ipcRenderer.invoke.bind(ipcRenderer)

// 仅暴露当前打印任务所需的预览操作；不提供通用 IPC、登录或业务数据写入。
contextBridge.exposeInMainWorld('api', {
  print: {
    getPreviewModel: (jobId: string) => invoke('print:getPreviewModel', jobId),
    updatePreviewSettings: (
      payload: Parameters<PrintPreviewAPI['print']['updatePreviewSettings']>[0]
    ) =>
      invoke('print:updatePreviewSettings', {
        jobId: payload.jobId,
        settings: payload.settings
      }),
    print: (jobId: string) => invoke('print:print', String(jobId)),
    exportPdf: (jobId: string) => invoke('print:exportPdf', String(jobId))
  }
} satisfies PrintPreviewAPI)

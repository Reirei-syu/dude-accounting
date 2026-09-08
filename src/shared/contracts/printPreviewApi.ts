import type { DudeAPI } from './desktopApi'

/** 打印窗口只拥有本任务的四项能力，不继承主窗口 API。 */
export interface PrintPreviewAPI {
  print: Pick<DudeAPI['print'], 'getPreviewModel' | 'updatePreviewSettings'> & {
    print: (jobId: string) => ReturnType<DudeAPI['print']['print']>
    exportPdf: (jobId: string) => ReturnType<DudeAPI['print']['exportPdf']>
  }
}

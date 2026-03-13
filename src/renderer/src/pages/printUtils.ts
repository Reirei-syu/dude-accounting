async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function prepareAndOpenPrintPreview(
  payload: Record<string, unknown>,
  options?: {
    maxPollCount?: number
    pollIntervalMs?: number
  }
): Promise<{ success: boolean; error?: string }> {
  if (!window.electron) {
    return { success: false, error: '浏览器预览模式不支持打印预览' }
  }

  const prepared = await window.api.print.prepare(payload)
  if (!prepared.success || !prepared.jobId) {
    return { success: false, error: prepared.error || '创建打印任务失败' }
  }

  const maxPollCount = options?.maxPollCount ?? 600
  const pollIntervalMs = options?.pollIntervalMs ?? 100

  for (let attempt = 0; attempt < maxPollCount; attempt += 1) {
    const status = await window.api.print.getJobStatus(prepared.jobId)
    if (!status.success) {
      await window.api.print.dispose(prepared.jobId)
      return { success: false, error: status.error || '获取打印任务状态失败' }
    }

    if (status.status === 'ready') {
      const opened = await window.api.print.openPreview(prepared.jobId)
      if (!opened.success) {
        await window.api.print.dispose(prepared.jobId)
        return { success: false, error: opened.error || '打开打印预览失败' }
      }
      return { success: true }
    }

    if (status.status === 'failed') {
      await window.api.print.dispose(prepared.jobId)
      return { success: false, error: status.error || '生成打印预览失败' }
    }

    await sleep(pollIntervalMs)
  }

  await window.api.print.dispose(prepared.jobId)
  return { success: false, error: '打印任务生成超时，请缩小打印范围后重试' }
}

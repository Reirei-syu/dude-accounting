import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.expose },
  ipcRenderer: { invoke: mocks.invoke }
}))

describe('打印专用 preload', () => {
  it('只暴露四个受限接口，不接受输出路径或静默打印选项', async () => {
    await import('./print')
    expect(mocks.expose).toHaveBeenCalledOnce()
    const [name, api] = mocks.expose.mock.calls[0]
    expect(name).toBe('api')
    expect(Object.keys(api)).toEqual(['print'])
    expect(Object.keys(api.print).sort()).toEqual(
      ['exportPdf', 'getPreviewModel', 'print', 'updatePreviewSettings'].sort()
    )
    await api.print.print({ jobId: 'job', silent: true })
    expect(mocks.invoke).toHaveBeenLastCalledWith('print:print', '[object Object]')
    await api.print.exportPdf({ jobId: 'job', outputPath: 'C:/arbitrary' })
    expect(mocks.invoke).toHaveBeenLastCalledWith('print:exportPdf', '[object Object]')
    await api.print.getPreviewModel('job')
    expect(mocks.invoke).toHaveBeenLastCalledWith('print:getPreviewModel', 'job')
  })

  it('测量 preload 不暴露任何页面 API', async () => {
    mocks.expose.mockClear()
    await import('./printMeasurement')
    expect(mocks.expose).not.toHaveBeenCalled()
  })
})

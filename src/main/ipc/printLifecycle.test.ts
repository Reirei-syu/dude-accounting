import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { CommandActor } from '../commands/types'
import { runDatabaseMigrations } from '../database/migrations'
import { issueSession, resolveSessionActor, revokeSession } from '../security/sessionAuthority'

const runtime = vi.hoisted(() => ({
  directory: '',
  database: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  load: vi.fn(async () => undefined),
  pdf: vi.fn(async (): Promise<Buffer> => Buffer.from('%PDF-test'))
}))

class TestContents extends EventEmitter {
  id = Math.random()
  url = ''
  mainFrame = { url: '' }
  dead = false
  getURL(): string {
    return this.url
  }
  isDestroyed(): boolean {
    return this.dead
  }
  printToPDF = runtime.pdf
  executeJavaScript = vi.fn(async () => ({ rowKeyGroups: [[]], oversizeRowKeys: [] }))
}

class TestWindow extends EventEmitter {
  static windows = new Set<TestWindow>()
  static getAllWindows(): TestWindow[] {
    return [...this.windows]
  }
  static fromWebContents(contents: WebContents): TestWindow | null {
    return [...this.windows].find((window) => window.webContents === (contents as unknown)) ?? null
  }
  webContents = new TestContents()
  constructor() {
    super()
    TestWindow.windows.add(this)
  }
  async loadFile(filePath: string): Promise<void> {
    this.webContents.url = pathToFileURL(filePath).href
    this.webContents.mainFrame.url = this.webContents.url
    await runtime.load()
  }
  setBounds = vi.fn()
  setSkipTaskbar = vi.fn()
  focus = vi.fn()
  destroy(): void {
    this.webContents.dead = true
    this.webContents.emit('destroyed')
    TestWindow.windows.delete(this)
    this.emit('closed')
  }
  close(): void {
    this.destroy()
  }
}

vi.mock('electron', () => ({
  app: { getPath: () => runtime.directory },
  BrowserWindow: TestWindow,
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      runtime.handlers.set(name, handler)
  }
}))
vi.mock('../database/init', () => ({ getDatabase: runtime.database }))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('打印任务会话与生命周期集成回归', () => {
  let db: Database.Database
  let actor: CommandActor
  let print: typeof import('./print')
  const settings = {
    orientation: 'portrait',
    scalePercent: 100,
    marginPreset: 'default',
    densityPreset: 'default'
  }
  function jobFile(jobId: string): string {
    return path.join(runtime.directory, 'print-jobs', `${jobId}.json`)
  }
  function createJob(): string {
    const jobId = randomUUID()
    fs.mkdirSync(path.dirname(jobFile(jobId)), { recursive: true })
    fs.writeFileSync(
      jobFile(jobId),
      JSON.stringify({
        id: jobId,
        type: 'book',
        bookType: null,
        preferenceKey: null,
        title: '隔离生命周期回归',
        ledgerId: 1,
        createdBy: 1,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        status: 'ready',
        orientation: 'portrait',
        settings,
        layoutVersion: 1,
        sourceDocument: { title: '隔离生命周期回归', orientation: 'portrait', segments: [] },
        layoutResult: {
          title: '隔离生命周期回归',
          orientation: 'portrait',
          settings,
          pages: [],
          pageCount: 0,
          diagnostics: {
            engine: 'page-model',
            overflowDetected: false,
            oversizeRowKeys: [],
            pageRowCounts: []
          }
        },
        error: null,
        previewWebContentsId: null
      })
    )
    return jobId
  }
  beforeEach(async () => {
    const base = path.resolve('.tmp/print-lifecycle-tests')
    fs.mkdirSync(base, { recursive: true })
    runtime.directory = fs.mkdtempSync(path.join(base, 'run-'))
    db = new Database(':memory:')
    runDatabaseMigrations(db)
    db.exec(
      "INSERT INTO users(id,username,permissions,is_admin) VALUES(1,'print-test','{}',1); INSERT INTO ledgers(id,name,start_period,current_period) VALUES(1,'隔离测试','2026-09','2026-09')"
    )
    runtime.database.mockReturnValue(db)
    runtime.load.mockReset().mockResolvedValue(undefined)
    runtime.pdf.mockReset().mockResolvedValue(Buffer.from('%PDF-test'))
    actor = resolveSessionActor(db, issueSession(db, 1), 'cli')
    print = await import('./print')
    print.registerPrintHandlers()
  })
  afterEach(() => {
    for (const window of TestWindow.getAllWindows()) window.destroy()
    vi.restoreAllMocks()
    db.close()
    fs.rmSync(runtime.directory, { recursive: true, force: true })
  })

  it('CLI 打开的预览在原会话撤销后拒绝读取', async () => {
    const jobId = createJob()
    await print.openPrintPreviewForActor(db, actor, jobId)
    const sender = TestWindow.getAllWindows()[0].webContents
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
    expect(await runtime.handlers.get('print:getPreviewModel')!(event, jobId)).toMatchObject({
      success: true
    })
    revokeSession(db, actor.session!)
    expect(await runtime.handlers.get('print:getPreviewModel')!(event, jobId)).toMatchObject({
      success: false,
      errorCode: 'UNAUTHORIZED'
    })
  })

  it('PDF 渲染期间撤销会话时不得落盘', async () => {
    const jobId = createJob()
    const started = deferred<void>()
    const pdf = deferred<Buffer>()
    runtime.pdf.mockImplementationOnce(() => {
      started.resolve()
      return pdf.promise
    })
    const outputPath = path.join(runtime.directory, 'blocked.pdf')
    const pending = print.exportPreparedJobPdfForActor(db, actor, { jobId, outputPath })
    await started.promise
    revokeSession(db, actor.session!)
    pdf.resolve(Buffer.from('%PDF-test'))
    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('HTML 创建目录期间撤销会话时不得落盘', async () => {
    const jobId = createJob()
    const started = deferred<void>()
    const mkdir = deferred<undefined>()
    vi.spyOn(fsPromises, 'mkdir').mockImplementationOnce(() => {
      started.resolve()
      return mkdir.promise
    })
    const outputPath = path.join(runtime.directory, 'blocked.html')
    const pending = print.exportPreparedJobHtmlForActor(db, actor, { jobId, outputPath })
    await started.promise
    revokeSession(db, actor.session!)
    mkdir.resolve(undefined)
    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fs.existsSync(outputPath)).toBe(false)
  })

  it('布局期间删除任务后不得重新保存', async () => {
    const jobId = createJob()
    const pending = print.updatePrintPreviewSettingsForActor(db, actor, {
      jobId,
      settings: { scalePercent: 75 }
    })
    expect(print.disposePrintJobForActor(db, actor, jobId)).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(fs.existsSync(jobFile(jobId))).toBe(false)
  })

  it('页面加载期间删除任务会销毁窗口', async () => {
    const jobId = createJob()
    const started = deferred<void>()
    const load = deferred<undefined>()
    runtime.load.mockImplementationOnce(() => {
      started.resolve()
      return load.promise
    })
    const pending = print.openPrintPreviewForActor(db, actor, jobId)
    await started.promise
    print.disposePrintJobForActor(db, actor, jobId)
    load.resolve(undefined)
    await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(TestWindow.getAllWindows()).toHaveLength(0)
  })

  it('任务文件被另一进程删除后缓存不得复活任务', () => {
    const jobId = createJob()
    expect(print.getPrintPreviewModelForActor(db, actor, jobId)).not.toBeNull()
    fs.rmSync(jobFile(jobId))
    expect(print.getPrintPreviewModelForActor(db, actor, jobId)).toBeNull()
    expect(fs.existsSync(jobFile(jobId))).toBe(false)
  })

  it('创建本地页面失败后不留下空窗口', async () => {
    const jobId = createJob()
    fs.writeFileSync(path.join(runtime.directory, 'print-pages'), '阻止目录创建')
    await expect(print.openPrintPreviewForActor(db, actor, jobId)).rejects.toThrow()
    expect(TestWindow.getAllWindows()).toHaveLength(0)
  })

  it('普通用户撤销账套权限并重新登录后仍不能读取旧任务', async () => {
    const jobId = createJob()
    db.exec(
      'UPDATE users SET is_admin=0 WHERE id=1; INSERT INTO user_ledger_permissions(user_id,ledger_id) VALUES(1,1)'
    )
    actor = resolveSessionActor(db, issueSession(db, 1), 'ipc')
    const sender = new TestContents()
    const event = { sender } as unknown as IpcMainInvokeEvent
    const { setSessionBySender } = await import('./session')
    setSessionBySender(sender, actor)
    expect(await runtime.handlers.get('print:getPreviewModel')!(event, jobId)).toMatchObject({
      success: true
    })
    db.exec('DELETE FROM user_ledger_permissions WHERE user_id=1')
    actor = resolveSessionActor(db, issueSession(db, 1), 'ipc')
    setSessionBySender(sender, actor)
    expect(await runtime.handlers.get('print:getPreviewModel')!(event, jobId)).toMatchObject({
      success: false,
      errorCode: 'UNAUTHORIZED'
    })
    sender.emit('destroyed')
  })

  it.each(['cli', 'ipc'] as const)('%s 准备期间删除任务不会在后台完成时复活', async (source) => {
    const started = deferred<void>()
    const load = deferred<undefined>()
    runtime.load.mockImplementationOnce(() => {
      started.resolve()
      return load.promise
    })
    const payload = {
      type: 'book' as const,
      ledgerId: 1,
      bookType: 'detail_ledger',
      title: '准备竞态',
      columns: [{ key: 'text', label: '内容' }],
      rows: []
    }
    let pending: Promise<unknown>
    let jobId: string
    if (source === 'cli') {
      pending = print.preparePrintJobForActor(db, actor, payload)
      await started.promise
      jobId = fs.readdirSync(path.join(runtime.directory, 'print-jobs'))[0].replace(/\.json$/, '')
    } else {
      const sender = new TestContents()
      const { setSessionBySender } = await import('./session')
      setSessionBySender(sender, actor)
      const prepared = (await runtime.handlers.get('print:prepare')!({ sender }, payload)) as {
        jobId: string
      }
      jobId = prepared.jobId
      await started.promise
      pending = Promise.resolve()
    }
    expect(print.disposePrintJobForActor(db, actor, jobId)).toBe(true)
    load.resolve(undefined)
    await pending
    // 让 IPC 的后台布局与 finally 链完成。
    await new Promise((resolve) => setImmediate(resolve))
    expect(fs.existsSync(jobFile(jobId))).toBe(false)
    expect(print.getPrintJobStatusForActor(db, actor, jobId)).toBeNull()
  })
})

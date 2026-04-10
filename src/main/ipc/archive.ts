import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  deleteArchiveCommand,
  exportArchiveCommand,
  getArchiveManifestCommand,
  listArchivesCommand,
  validateArchiveCommand
} from '../commands/archiveCommands'
import { getPathPreference, rememberPathPreference } from '../services/pathPreference'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { createCommandContextFromEvent, isCommandSuccess } from './commandBridge'
import { requireLedgerAccess } from './session'

const ARCHIVE_LAST_DIR_KEY = 'archive_export_last_dir'

function getDefaultArchiveRootDir(): string {
  return path.join(app.getPath('documents'), 'Dude Accounting', '电子档案导出')
}

async function pickArchiveRootDirectory(
  sender: Electron.WebContents,
  defaultPath: string
): Promise<{ cancelled: boolean; directoryPath?: string }> {
  const browserWindow = BrowserWindow.fromWebContents(sender)
  const options = {
    title: '选择电子档案导出目录',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const result = browserWindow
    ? await dialog.showOpenDialog(browserWindow, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true }
  }

  return {
    cancelled: false,
    directoryPath: result.filePaths[0]
  }
}

export function registerArchiveHandlers(): void {
  ipcMain.handle(
    'archive:export',
    async (event, payload: { ledgerId: number; fiscalYear: string; directoryPath?: string }) =>
      withIpcTelemetry(
        {
          channel: 'archive:export',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: payload.ledgerId,
            fiscalYear: payload.fiscalYear,
            hasDirectoryPath: Boolean(payload.directoryPath)
          }
        },
        async () => {
          try {
            const db = getDatabase()
            requireLedgerAccess(event, db, payload.ledgerId)
            const ledger = db
              .prepare('SELECT id, name FROM ledgers WHERE id = ?')
              .get(payload.ledgerId) as { id: number; name: string } | undefined

            if (!ledger) {
              return { success: false, error: '账套不存在' }
            }

            const preferredDir =
              getPathPreference(db, ARCHIVE_LAST_DIR_KEY) ?? getDefaultArchiveRootDir()
            const picked = payload.directoryPath
              ? { cancelled: false, directoryPath: payload.directoryPath }
              : await pickArchiveRootDirectory(event.sender, preferredDir)

            if (picked.cancelled || !picked.directoryPath) {
              return { success: false, cancelled: true }
            }

            rememberPathPreference(db, ARCHIVE_LAST_DIR_KEY, picked.directoryPath)
            const result = await exportArchiveCommand(createCommandContextFromEvent(event), {
              ledgerId: payload.ledgerId,
              fiscalYear: payload.fiscalYear,
              directoryPath: picked.directoryPath
            })
            if (!isCommandSuccess(result)) {
              return {
                success: false,
                error: result.error?.message ?? '导出电子档案失败'
              }
            }

            return {
              success: true,
              ...result.data
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '导出电子档案失败'
            }
          }
        }
      )
  )

  ipcMain.handle('archive:list', (event, ledgerId?: number) =>
    withIpcTelemetry(
      {
        channel: 'archive:list',
        baseDir: app.getPath('userData'),
        context: {
          ledgerId: typeof ledgerId === 'number' ? ledgerId : null
        }
      },
      async () => {
        const db = getDatabase()

        if (typeof ledgerId === 'number') {
          requireLedgerAccess(event, db, ledgerId)
        }

        const result = await listArchivesCommand(createCommandContextFromEvent(event), {
          ledgerId
        })
        if (isCommandSuccess(result)) {
          return result.data
        }

        throw new Error(result.error?.message ?? '获取电子档案列表失败')
      }
    )
  )

  ipcMain.handle('archive:validate', (event, exportId: number) =>
    withIpcTelemetry(
      {
        channel: 'archive:validate',
        baseDir: app.getPath('userData'),
        context: { exportId }
      },
      async () => {
        try {
          const result = await validateArchiveCommand(createCommandContextFromEvent(event), {
            exportId
          })
          return isCommandSuccess(result)
            ? {
                success: result.data.valid,
                valid: result.data.valid,
                actualChecksum: result.data.actualChecksum,
                error: result.data.error
              }
            : {
                success: false,
                error: result.error?.message ?? '校验电子档案失败'
              }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '校验电子档案失败'
          }
        }
      }
    )
  )

  ipcMain.handle(
    'archive:delete',
    (
      event,
      payload: {
        exportId: number
        deleteRecordOnly?: boolean
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'archive:delete',
          baseDir: app.getPath('userData'),
          context: {
            exportId: payload.exportId,
            deleteRecordOnly: payload.deleteRecordOnly === true
          }
        },
        async () => {
          const result = await deleteArchiveCommand(createCommandContextFromEvent(event), payload)
          return isCommandSuccess(result)
            ? {
                success: true,
                deletedPhysicalPackage: result.data.deletedPhysicalPackage,
                deletedPaths: result.data.deletedPaths
              }
            : {
                success: false,
                error: result.error?.message ?? '删除电子档案失败'
              }
        }
      )
  )

  ipcMain.handle('archive:getManifest', async (event, exportId: number) => {
    const result = await getArchiveManifestCommand(createCommandContextFromEvent(event), {
      exportId
    })
    if (isCommandSuccess(result)) {
      return result.data
    }

    throw new Error(result.error?.message ?? '获取归档清单失败')
  })
}

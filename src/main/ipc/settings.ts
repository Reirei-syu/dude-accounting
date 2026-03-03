import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { requireAuth, requirePermission } from './session'

export function registerSettingsHandlers(): void {
  const db = getDatabase()

  // 获取系统设置
  ipcMain.handle('settings:get', (event, key: string) => {
    requireAuth(event)
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? row.value : null
  })

  // 获取所有系统设置
  ipcMain.handle('settings:getAll', (event) => {
    requireAuth(event)
    const rows = db.prepare('SELECT key, value FROM system_settings').all() as {
      key: string
      value: string
    }[]
    const settings: Record<string, string> = {}
    for (const row of rows) {
      settings[row.key] = row.value
    }
    return settings
  })

  // 更新系统设置
  ipcMain.handle('settings:set', (event, key: string, value: string) => {
    requirePermission(event, 'system_settings')
    db.prepare(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value)
    return { success: true }
  })
}

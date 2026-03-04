import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { requireAuth, requirePermission } from './session'

export function registerAuxiliaryHandlers(): void {
  const db = getDatabase()

  // 获取账套的所有辅助核算项
  ipcMain.handle('auxiliary:getAll', (event, ledgerId: number) => {
    requireAuth(event)
    return db
      .prepare('SELECT * FROM auxiliary_items WHERE ledger_id = ? ORDER BY category, code')
      .all(ledgerId)
  })

  // 按分类获取辅助核算项
  ipcMain.handle('auxiliary:getByCategory', (event, ledgerId: number, category: string) => {
    requireAuth(event)
    return db
      .prepare('SELECT * FROM auxiliary_items WHERE ledger_id = ? AND category = ? ORDER BY code')
      .all(ledgerId, category)
  })

  // 新增辅助核算项
  ipcMain.handle(
    'auxiliary:create',
    (
      event,
      data: {
        ledgerId: number
        category: string
        code: string
        name: string
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        db.prepare(
          'INSERT INTO auxiliary_items (ledger_id, category, code, name) VALUES (?, ?, ?, ?)'
        ).run(data.ledgerId, data.category, data.code, data.name)
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 修改辅助核算项
  ipcMain.handle(
    'auxiliary:update',
    (
      event,
      data: {
        id: number
        code?: string
        name?: string
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        if (data.code !== undefined && data.name !== undefined) {
          db.prepare('UPDATE auxiliary_items SET code = ?, name = ? WHERE id = ?').run(
            data.code,
            data.name,
            data.id
          )
        } else if (data.name !== undefined) {
          db.prepare('UPDATE auxiliary_items SET name = ? WHERE id = ?').run(data.name, data.id)
        } else if (data.code !== undefined) {
          db.prepare('UPDATE auxiliary_items SET code = ? WHERE id = ?').run(data.code, data.id)
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 删除辅助核算项
  ipcMain.handle('auxiliary:delete', (event, id: number) => {
    requirePermission(event, 'ledger_settings')

    // Check if used in voucher entries
    const used = db
      .prepare('SELECT id FROM voucher_entries WHERE auxiliary_item_id = ? LIMIT 1')
      .get(id)
    if (used) {
      return { success: false, error: '该辅助核算项已被凭证使用，无法删除' }
    }

    db.prepare('DELETE FROM auxiliary_items WHERE id = ?').run(id)
    return { success: true }
  })
}

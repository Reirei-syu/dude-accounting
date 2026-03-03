import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { requireAuth, requirePermission } from './session'

export function registerSubjectHandlers(): void {
  const db = getDatabase()

  // 获取账套的所有科目
  ipcMain.handle('subject:getAll', (event, ledgerId: number) => {
    requireAuth(event)
    return db.prepare('SELECT * FROM subjects WHERE ledger_id = ? ORDER BY code').all(ledgerId)
  })

  // 按代码模糊搜索科目（联想下拉用）
  ipcMain.handle('subject:search', (event, ledgerId: number, keyword: string) => {
    requireAuth(event)
    return db
      .prepare(
        `SELECT * FROM subjects WHERE ledger_id = ?
           AND (code LIKE ? OR name LIKE ?)
           ORDER BY code LIMIT 20`
      )
      .all(ledgerId, `%${keyword}%`, `%${keyword}%`)
  })

  // 新增科目
  ipcMain.handle(
    'subject:create',
    (
      event,
      data: {
        ledgerId: number
        code: string
        name: string
        parentCode: string | null
        category: string
        balanceDirection: number
        hasAuxiliary: boolean
        isCashFlow: boolean
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        // Calculate level from code
        const level = data.parentCode ? Math.floor(data.code.length / 2) : 1

        db.prepare(
          `INSERT INTO subjects (ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        ).run(
          data.ledgerId,
          data.code,
          data.name,
          data.parentCode,
          data.category,
          data.balanceDirection,
          data.hasAuxiliary ? 1 : 0,
          data.isCashFlow ? 1 : 0,
          level
        )
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 修改科目
  ipcMain.handle(
    'subject:update',
    (
      event,
      data: {
        id: number
        name?: string
        hasAuxiliary?: boolean
        isCashFlow?: boolean
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        if (data.name !== undefined) {
          db.prepare('UPDATE subjects SET name = ? WHERE id = ?').run(data.name, data.id)
        }
        if (data.hasAuxiliary !== undefined) {
          db.prepare('UPDATE subjects SET has_auxiliary = ? WHERE id = ?').run(
            data.hasAuxiliary ? 1 : 0,
            data.id
          )
        }
        if (data.isCashFlow !== undefined) {
          db.prepare('UPDATE subjects SET is_cash_flow = ? WHERE id = ?').run(
            data.isCashFlow ? 1 : 0,
            data.id
          )
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 删除科目（仅非系统科目可删）
  ipcMain.handle('subject:delete', (event, id: number) => {
    requirePermission(event, 'ledger_settings')
    const subject = db.prepare('SELECT is_system FROM subjects WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!subject) return { success: false, error: '科目不存在' }
    if (subject.is_system === 1) return { success: false, error: '系统科目不可删除' }

    db.prepare('DELETE FROM subjects WHERE id = ?').run(id)
    return { success: true }
  })
}

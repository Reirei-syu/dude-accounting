import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  seedSubjectsForLedger,
  seedCashFlowItemsForLedger,
  seedPLCarryForwardRulesForLedger
} from '../database/seed'
import { requireAuth, requirePermission } from './session'

export function registerLedgerHandlers(): void {
  const db = getDatabase()

  // 获取所有账套
  ipcMain.handle('ledger:getAll', (event) => {
    requireAuth(event)
    return db.prepare('SELECT * FROM ledgers ORDER BY created_at DESC').all()
  })

  // 创建新账套
  ipcMain.handle(
    'ledger:create',
    (
      event,
      data: {
        name: string
        standardType: 'enterprise' | 'npo'
        startPeriod: string
      }
    ) => {
      try {
        requirePermission(event, 'ledger_settings')
        const result = db
          .prepare(
            `INSERT INTO ledgers (name, standard_type, start_period, current_period) VALUES (?, ?, ?, ?)`
          )
          .run(data.name, data.standardType, data.startPeriod, data.startPeriod)

        const ledgerId = result.lastInsertRowid as number

        // Seed standard subjects for this ledger
        seedSubjectsForLedger(db, ledgerId, data.standardType)
        seedCashFlowItemsForLedger(db, ledgerId)
        seedPLCarryForwardRulesForLedger(db, ledgerId, data.standardType)

        // Create initial period
        db.prepare('INSERT INTO periods (ledger_id, period) VALUES (?, ?)').run(
          ledgerId,
          data.startPeriod
        )

        return { success: true, id: ledgerId }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 更新账套
  ipcMain.handle(
    'ledger:update',
    (event, data: { id: number; name?: string; currentPeriod?: string }) => {
      try {
        requirePermission(event, 'ledger_settings')
        if (data.name !== undefined) {
          db.prepare('UPDATE ledgers SET name = ? WHERE id = ?').run(data.name, data.id)
        }
        if (data.currentPeriod !== undefined) {
          db.prepare('UPDATE ledgers SET current_period = ? WHERE id = ?').run(
            data.currentPeriod,
            data.id
          )
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  // 删除账套
  ipcMain.handle('ledger:delete', (event, id: number) => {
    try {
      requirePermission(event, 'ledger_settings')
      db.prepare('DELETE FROM ledgers WHERE id = ?').run(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // 获取账套当前期间
  ipcMain.handle('ledger:getPeriods', (event, ledgerId: number) => {
    requireAuth(event)
    return db.prepare('SELECT * FROM periods WHERE ledger_id = ? ORDER BY period').all(ledgerId)
  })
}

import { ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import {
  getStandardTemplateSummaries,
  seedCashFlowItemsForLedger,
  seedCashFlowMappingsForLedger,
  seedPLCarryForwardRulesForLedger,
  seedSubjectsForLedger
} from '../database/seed'
import { appendOperationLog } from '../services/auditLog'
import { assertLedgerDeletionAllowed } from '../services/ledgerCompliance'
import { requireAuth, requirePermission } from './session'

export function registerLedgerHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('ledger:getAll', (event) => {
    requireAuth(event)
    return db.prepare('SELECT * FROM ledgers ORDER BY created_at DESC').all()
  })

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
        const user = requirePermission(event, 'ledger_settings')
        const result = db
          .prepare(
            `INSERT INTO ledgers (name, standard_type, start_period, current_period)
             VALUES (?, ?, ?, ?)`
          )
          .run(data.name, data.standardType, data.startPeriod, data.startPeriod)

        const ledgerId = Number(result.lastInsertRowid)
        seedSubjectsForLedger(db, ledgerId, data.standardType)
        seedCashFlowItemsForLedger(db, ledgerId)
        seedCashFlowMappingsForLedger(db, ledgerId, data.standardType)
        seedPLCarryForwardRulesForLedger(db, ledgerId, data.standardType)
        db.prepare('INSERT INTO periods (ledger_id, period) VALUES (?, ?)').run(
          ledgerId,
          data.startPeriod
        )

        appendOperationLog(db, {
          ledgerId,
          userId: user.id,
          username: user.username,
          module: 'ledger',
          action: 'create',
          targetType: 'ledger',
          targetId: ledgerId,
          details: {
            standardType: data.standardType,
            startPeriod: data.startPeriod
          }
        })

        return { success: true, id: ledgerId }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(
    'ledger:update',
    (event, data: { id: number; name?: string; currentPeriod?: string }) => {
      try {
        const user = requirePermission(event, 'ledger_settings')
        if (data.name !== undefined) {
          db.prepare('UPDATE ledgers SET name = ? WHERE id = ?').run(data.name, data.id)
        }
        if (data.currentPeriod !== undefined) {
          db.prepare('UPDATE ledgers SET current_period = ? WHERE id = ?').run(
            data.currentPeriod,
            data.id
          )
          db.prepare('INSERT OR IGNORE INTO periods (ledger_id, period) VALUES (?, ?)').run(
            data.id,
            data.currentPeriod
          )
        }

        appendOperationLog(db, {
          ledgerId: data.id,
          userId: user.id,
          username: user.username,
          module: 'ledger',
          action: 'update',
          targetType: 'ledger',
          targetId: data.id,
          details: {
            name: data.name,
            currentPeriod: data.currentPeriod
          }
        })

        return { success: true }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle('ledger:delete', (event, id: number) => {
    try {
      const user = requirePermission(event, 'ledger_settings')
      assertLedgerDeletionAllowed(db, id)
      db.prepare('DELETE FROM ledgers WHERE id = ?').run(id)

      appendOperationLog(db, {
        ledgerId: id,
        userId: user.id,
        username: user.username,
        module: 'ledger',
        action: 'delete',
        targetType: 'ledger',
        targetId: id
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('ledger:getPeriods', (event, ledgerId: number) => {
    requireAuth(event)
    return db.prepare('SELECT * FROM periods WHERE ledger_id = ? ORDER BY period').all(ledgerId)
  })

  ipcMain.handle('ledger:getStandardTemplates', (event) => {
    requireAuth(event)
    return getStandardTemplateSummaries()
  })

  ipcMain.handle(
    'ledger:applyStandardTemplate',
    (
      event,
      data: {
        ledgerId: number
        standardType: 'enterprise' | 'npo'
      }
    ) => {
      try {
        const user = requirePermission(event, 'ledger_settings')
        const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ?').get(data.ledgerId) as
          | { id: number }
          | undefined

        if (!ledger) {
          return { success: false, error: '账套不存在' }
        }

        const voucherCount = Number(
          (
            db
              .prepare('SELECT COUNT(1) AS count FROM vouchers WHERE ledger_id = ?')
              .get(data.ledgerId) as { count: number }
          ).count
        )
        const nonZeroInitialBalanceCount = Number(
          (
            db
              .prepare(
                `SELECT COUNT(1) AS count
                 FROM initial_balances
                 WHERE ledger_id = ? AND (debit_amount <> 0 OR credit_amount <> 0)`
              )
              .get(data.ledgerId) as { count: number }
          ).count
        )

        if (voucherCount > 0 || nonZeroInitialBalanceCount > 0) {
          return {
            success: false,
            error: '账套已有业务数据，暂不允许切换会计准则模板'
          }
        }

        const replaceTemplate = db.transaction(() => {
          db.prepare('DELETE FROM cash_flow_mappings WHERE ledger_id = ?').run(data.ledgerId)
          db.prepare('DELETE FROM cash_flow_items WHERE ledger_id = ? AND is_system = 1').run(
            data.ledgerId
          )
          db.prepare('DELETE FROM pl_carry_forward_rules WHERE ledger_id = ?').run(data.ledgerId)
          db.prepare('DELETE FROM subjects WHERE ledger_id = ? AND is_system = 1').run(
            data.ledgerId
          )

          db.prepare('UPDATE ledgers SET standard_type = ? WHERE id = ?').run(
            data.standardType,
            data.ledgerId
          )

          seedSubjectsForLedger(db, data.ledgerId, data.standardType)
          seedCashFlowItemsForLedger(db, data.ledgerId)
          seedCashFlowMappingsForLedger(db, data.ledgerId, data.standardType)
          seedPLCarryForwardRulesForLedger(db, data.ledgerId, data.standardType)
        })

        replaceTemplate()

        const updatedLedger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(data.ledgerId)
        const subjectCount = Number(
          (
            db
              .prepare('SELECT COUNT(1) AS count FROM subjects WHERE ledger_id = ?')
              .get(data.ledgerId) as { count: number }
          ).count
        )

        appendOperationLog(db, {
          ledgerId: data.ledgerId,
          userId: user.id,
          username: user.username,
          module: 'ledger',
          action: 'apply_standard_template',
          targetType: 'ledger',
          targetId: data.ledgerId,
          details: {
            standardType: data.standardType,
            subjectCount
          }
        })

        return {
          success: true,
          ledger: updatedLedger,
          subjectCount
        }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}

import { app, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { getStandardTemplateSummaries } from '../database/seed'
import { appendOperationLog } from '../services/auditLog'
import { listAccessibleLedgers, listLedgerPeriods } from '../services/ledgerCatalog'
import {
  applyLedgerStandardTemplate,
  createLedgerWithTemplate,
  updateLedgerConfiguration
} from '../services/ledgerLifecycle'
import { assertLedgerDeletionAllowed } from '../services/ledgerCompliance'
import { withIpcTelemetry } from '../services/runtimeLogger'
import { requireAuth, requireLedgerAccess, requirePermission } from './session'

export function registerLedgerHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('ledger:getAll', (event) =>
    withIpcTelemetry(
      {
        channel: 'ledger:getAll',
        baseDir: app.getPath('userData')
      },
      () => {
        const user = requireAuth(event)
        return listAccessibleLedgers(db, {
          userId: user.id,
          isAdmin: user.isAdmin
        })
      }
    )
  )

  ipcMain.handle(
    'ledger:create',
    (
      event,
      data: {
        name: string
        standardType: 'enterprise' | 'npo'
        startPeriod: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'ledger:create',
          baseDir: app.getPath('userData'),
          context: {
            standardType: data.standardType,
            startPeriod: data.startPeriod
          }
        },
        () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            const result = createLedgerWithTemplate(db, {
              name: data.name,
              standardType: data.standardType,
              startPeriod: data.startPeriod,
              operatorUserId: user.id,
              operatorIsAdmin: user.isAdmin
            })

            appendOperationLog(db, {
              ledgerId: result.ledgerId,
              userId: user.id,
              username: user.username,
              module: 'ledger',
              action: 'create',
              targetType: 'ledger',
              targetId: result.ledgerId,
              details: {
                standardType: data.standardType,
                startPeriod: data.startPeriod,
                customSubjectCount: result.customSubjectCount
              }
            })

            return { success: true, id: result.ledgerId }
          } catch (error) {
            return { success: false, error: (error as Error).message }
          }
        }
      )
  )

  ipcMain.handle(
    'ledger:update',
    (event, data: { id: number; name?: string; currentPeriod?: string }) =>
      withIpcTelemetry(
        {
          channel: 'ledger:update',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: data.id,
            hasName: data.name !== undefined,
            hasCurrentPeriod: data.currentPeriod !== undefined
          }
        },
        () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            requireLedgerAccess(event, db, data.id)
            updateLedgerConfiguration(db, {
              ledgerId: data.id,
              name: data.name,
              currentPeriod: data.currentPeriod
            })

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
  )

  ipcMain.handle('ledger:delete', (event, id: number) =>
    withIpcTelemetry(
      {
        channel: 'ledger:delete',
        baseDir: app.getPath('userData'),
        context: { ledgerId: id }
      },
      () => {
        try {
          const user = requirePermission(event, 'ledger_settings')
          requireLedgerAccess(event, db, id)
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
      }
    )
  )

  ipcMain.handle('ledger:getPeriods', (event, ledgerId: number) =>
    withIpcTelemetry(
      {
        channel: 'ledger:getPeriods',
        baseDir: app.getPath('userData'),
        context: { ledgerId }
      },
      () => {
        requireAuth(event)
        requireLedgerAccess(event, db, ledgerId)
        return listLedgerPeriods(db, ledgerId)
      }
    )
  )

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
    ) =>
      withIpcTelemetry(
        {
          channel: 'ledger:applyStandardTemplate',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: data.ledgerId,
            standardType: data.standardType
          }
        },
        () => {
          try {
            const user = requirePermission(event, 'ledger_settings')
            requireLedgerAccess(event, db, data.ledgerId)
            const result = applyLedgerStandardTemplate(db, {
              ledgerId: data.ledgerId,
              standardType: data.standardType
            })

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
                subjectCount: result.subjectCount,
                customSubjectCount: result.customSubjectCount
              }
            })

            return {
              success: true,
              ledger: result.updatedLedger,
              subjectCount: result.subjectCount
            }
          } catch (error) {
            return { success: false, error: (error as Error).message }
          }
        }
      )
  )
}

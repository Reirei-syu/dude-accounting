import { app, ipcMain } from 'electron'
import { getDatabase } from '../database/init'
import { appendOperationLog } from '../services/auditLog'
import { assertPeriodWritable } from '../services/periodState'
import {
  applyVoucherBatchAction,
  listVoucherBatchTargets,
  type VoucherBatchAction
} from '../services/voucherBatchLifecycle'
import {
  getNextVoucherNumber,
  getVoucherLedgerId,
  listVoucherEntries,
  listVoucherSummaries,
  type VoucherListStatusFilter
} from '../services/voucherCatalog'
import {
  createVoucherWithEntries,
  isVoucherNumberConflictError,
  resolveVoucherCashFlowEntries,
  updateVoucherWithEntries,
  type VoucherEntryInput
} from '../services/voucherLifecycle'
import { withIpcTelemetry } from '../services/runtimeLogger'
import {
  assertVoucherSwapAllowed,
  type EmergencyReversalPayload,
  normalizeEmergencyReversalPayload
} from '../services/voucherControl'
import { requireAuth, requireLedgerAccess, requirePermission } from './session'
import {
  applyVoucherSwapPlan,
  buildVoucherSwapPlan,
  listVoucherSwapEntriesByVoucherId,
  listVoucherSwapVouchers,
  type VoucherSwapVoucher
} from '../services/voucherSwapLifecycle'

interface SaveVoucherInput {
  ledgerId: number
  voucherDate: string
  voucherWord?: string
  isCarryForward?: boolean
  entries: VoucherEntryInput[]
}

interface UpdateVoucherInput {
  voucherId: number
  ledgerId: number
  voucherDate: string
  entries: VoucherEntryInput[]
}

interface SwapVoucherPositionsInput {
  voucherIds: number[]
}

export { resolveVoucherCashFlowEntries }

export function registerVoucherHandlers(): void {
  const db = getDatabase()
  const selectLedgerPeriodStmt = db.prepare('SELECT current_period FROM ledgers WHERE id = ?')

  const ensureVoucherPeriod = (
    ledgerId: number,
    voucherDateOrPeriod: string,
    mode: 'date' | 'period'
  ): { ok: true; period: string } | { ok: false; error: string } => {
    const period = mode === 'date' ? voucherDateOrPeriod.slice(0, 7) : voucherDateOrPeriod
    const ledger = selectLedgerPeriodStmt.get(ledgerId) as { current_period: string } | undefined
    if (!ledger) {
      return { ok: false, error: '账套不存在' }
    }
    if (ledger.current_period !== period) {
      return {
        ok: false,
        error: `凭证日期必须在当前会计期间（${ledger.current_period}）内`
      }
    }
    try {
      assertPeriodWritable(db, ledgerId, period)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '当前期间已结账'
      }
    }
    return { ok: true, period }
  }

  ipcMain.handle('voucher:getNextNumber', (event, ledgerId: number, period: string) =>
    withIpcTelemetry(
      {
        channel: 'voucher:getNextNumber',
        baseDir: app.getPath('userData'),
        context: { ledgerId, period }
      },
      () => {
        requirePermission(event, 'voucher_entry')
        requireLedgerAccess(event, db, ledgerId)
        const periodCheck = ensureVoucherPeriod(ledgerId, period, 'period')
        if (!periodCheck.ok) {
          throw new Error(periodCheck.error)
        }
        return getNextVoucherNumber(db, ledgerId, periodCheck.period)
      }
    )
  )

  ipcMain.handle('voucher:save', (event, payload: SaveVoucherInput) => {
    try {
      const currentUser = requirePermission(event, 'voucher_entry')
      if (!payload.ledgerId) {
        return { success: false, error: '请选择账套' }
      }
      requireLedgerAccess(event, db, payload.ledgerId)
      if (!payload.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.voucherDate)) {
        return { success: false, error: '凭证日期格式不正确' }
      }

      const periodCheck = ensureVoucherPeriod(payload.ledgerId, payload.voucherDate, 'date')
      if (!periodCheck.ok) {
        return { success: false, error: periodCheck.error }
      }
      const allowSameRow = db
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get('allow_same_maker_auditor') as { value: string } | undefined
      const allowSameMakerAuditor = allowSameRow?.value === '1'

      const result = createVoucherWithEntries(db, {
        ledgerId: payload.ledgerId,
        period: periodCheck.period,
        voucherDate: payload.voucherDate,
        voucherWord: payload.voucherWord,
        isCarryForward: payload.isCarryForward,
        entries: payload.entries,
        creatorId: currentUser.id,
        allowSameMakerAuditor
      })

      return { success: true, ...result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '保存凭证失败'
      }
    }
  })

  ipcMain.handle('voucher:update', (event, payload: UpdateVoucherInput) => {
    try {
      requirePermission(event, 'voucher_entry')

      if (!payload.voucherId) {
        return { success: false, error: '请选择凭证' }
      }
      if (!payload.ledgerId) {
        return { success: false, error: '请选择账套' }
      }
      requireLedgerAccess(event, db, payload.ledgerId)
      if (!payload.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.voucherDate)) {
        return { success: false, error: '凭证日期格式不正确' }
      }

      const voucher = db
        .prepare(
          `SELECT id, ledger_id, voucher_number, voucher_word, status
           FROM vouchers
           WHERE id = ?`
        )
        .get(payload.voucherId) as
        | {
            id: number
            ledger_id: number
            voucher_number: number
            voucher_word: string
            status: number
          }
        | undefined

      if (!voucher) {
        return { success: false, error: '凭证不存在' }
      }
      if (voucher.ledger_id !== payload.ledgerId) {
        return { success: false, error: '凭证不属于当前账套' }
      }
      if (voucher.status !== 0) {
        return { success: false, error: '仅未审核凭证可修改' }
      }

      const periodCheck = ensureVoucherPeriod(payload.ledgerId, payload.voucherDate, 'date')
      if (!periodCheck.ok) {
        return { success: false, error: periodCheck.error }
      }
      try {
        updateVoucherWithEntries(db, {
          voucherId: payload.voucherId,
          ledgerId: payload.ledgerId,
          period: periodCheck.period,
          voucherDate: payload.voucherDate,
          entries: payload.entries
        })
      } catch (error) {
        if (isVoucherNumberConflictError(error)) {
          return { success: false, error: '凭证编号冲突，请调整日期后重试' }
        }
        throw error
      }

      return {
        success: true,
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        status: voucher.status
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '修改凭证失败'
      }
    }
  })

  ipcMain.handle(
    'voucher:list',
    (
      event,
      query: {
        ledgerId: number
        voucherId?: number
        period?: string
        dateFrom?: string
        dateTo?: string
        keyword?: string
        status?: VoucherListStatusFilter
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'voucher:list',
          baseDir: app.getPath('userData'),
          context: {
            ledgerId: query.ledgerId,
            hasVoucherId: typeof query.voucherId === 'number',
            hasPeriod: Boolean(query.period),
            hasDateFrom: Boolean(query.dateFrom),
            hasDateTo: Boolean(query.dateTo),
            hasKeyword: Boolean(query.keyword),
            status: query.status ?? null
          }
        },
        () => {
          requireAuth(event)
          requireLedgerAccess(event, db, query.ledgerId)
          return listVoucherSummaries(db, query)
        }
      )
  )

  ipcMain.handle('voucher:getEntries', (event, voucherId: number) =>
    withIpcTelemetry(
      {
        channel: 'voucher:getEntries',
        baseDir: app.getPath('userData'),
        context: { voucherId }
      },
      () => {
        requireAuth(event)
        const ledgerId = getVoucherLedgerId(db, voucherId)
        if (ledgerId === null) {
          throw new Error('凭证不存在')
        }
        requireLedgerAccess(event, db, ledgerId)
        return listVoucherEntries(db, voucherId)
      }
    )
  )

  ipcMain.handle('voucher:swapPositions', (event, payload: SwapVoucherPositionsInput) =>
    withIpcTelemetry(
      {
        channel: 'voucher:swapPositions',
        baseDir: app.getPath('userData'),
        context: {
          requestedCount: Array.isArray(payload.voucherIds) ? payload.voucherIds.length : 0
        }
      },
      () => {
        try {
          const currentUser = requirePermission(event, 'voucher_entry')

          if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length !== 2) {
            return {
              success: false,
              error:
                '\u4ec5\u9009\u62e9 2 \u5f20\u51ed\u8bc1\u65f6\u624d\u53ef\u4ea4\u6362\u4f4d\u7f6e'
            }
          }

          const voucherIds = Array.from(new Set(payload.voucherIds))
          if (voucherIds.length !== 2) {
            return {
              success: false,
              error: '\u8bf7\u9009\u62e9\u4e24\u5f20\u4e0d\u540c\u7684\u51ed\u8bc1'
            }
          }

          const vouchers = listVoucherSwapVouchers(db, voucherIds)
          if (vouchers.length !== 2) {
            return {
              success: false,
              error: '\u5b58\u5728\u65e0\u6548\u51ed\u8bc1\uff0c\u4ea4\u6362\u5931\u8d25'
            }
          }
          for (const voucher of vouchers) {
            requireLedgerAccess(event, db, voucher.ledgerId)
          }

          const vouchersById = new Map<number, VoucherSwapVoucher>(
            vouchers.map((voucher) => [voucher.id, voucher])
          )
          const firstVoucher = vouchersById.get(voucherIds[0])
          const secondVoucher = vouchersById.get(voucherIds[1])

          if (!firstVoucher || !secondVoucher) {
            return {
              success: false,
              error: '\u5b58\u5728\u65e0\u6548\u51ed\u8bc1\uff0c\u4ea4\u6362\u5931\u8d25'
            }
          }

          assertVoucherSwapAllowed([firstVoucher, secondVoucher])

          if (
            firstVoucher.ledgerId !== secondVoucher.ledgerId ||
            firstVoucher.period !== secondVoucher.period
          ) {
            return {
              success: false,
              error:
                '\u4ec5\u652f\u6301\u540c\u4e00\u8d26\u5957\u3001\u540c\u4e00\u671f\u95f4\u7684\u4e24\u5f20\u51ed\u8bc1\u4ea4\u6362\u4f4d\u7f6e'
            }
          }

          const entryMap = listVoucherSwapEntriesByVoucherId(db, voucherIds)
          const plan = buildVoucherSwapPlan(
            firstVoucher,
            secondVoucher,
            entryMap.get(firstVoucher.id) ?? [],
            entryMap.get(secondVoucher.id) ?? []
          )

          applyVoucherSwapPlan(db, plan)

          appendOperationLog(db, {
            ledgerId: firstVoucher.ledgerId,
            userId: currentUser.id,
            username: currentUser.username,
            module: 'voucher',
            action: 'swap_positions',
            targetType: 'voucher_pair',
            targetId: voucherIds.join(','),
            details: {
              voucherIds
            }
          })

          return { success: true, voucherIds }
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : '\u4ea4\u6362\u51ed\u8bc1\u4f4d\u7f6e\u5931\u8d25'
          }
        }
      }
    )
  )

  ipcMain.handle(
    'voucher:batchAction',
    (
      event,
      payload: {
        action: VoucherBatchAction
        voucherIds: number[]
        reason?: string
        approvalTag?: string
      }
    ) =>
      withIpcTelemetry(
        {
          channel: 'voucher:batchAction',
          baseDir: app.getPath('userData'),
          context: {
            action: payload.action,
            requestedCount: Array.isArray(payload.voucherIds) ? payload.voucherIds.length : 0
          }
        },
        () => {
          try {
            if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length === 0) {
              return { success: false, error: '请选择凭证' }
            }

            const action = payload.action
            const user =
              action === 'audit' || action === 'unaudit'
                ? requirePermission(event, 'audit')
                : action === 'bookkeep'
                  ? requirePermission(event, 'bookkeeping')
                  : action === 'unbookkeep'
                    ? requirePermission(event, 'unbookkeep')
                    : requirePermission(event, 'voucher_entry')
            const emergencyReversal: EmergencyReversalPayload | null =
              action === 'unbookkeep'
                ? normalizeEmergencyReversalPayload({
                    reason: payload.reason,
                    approvalTag: payload.approvalTag
                  })
                : null

            const vouchers = listVoucherBatchTargets(db, payload.voucherIds)

            if (vouchers.length !== payload.voucherIds.length) {
              return { success: false, error: '存在无效凭证，操作中止' }
            }
            for (const voucher of vouchers) {
              requireLedgerAccess(event, db, voucher.ledger_id)
            }

            const { applicable, skipped } = applyVoucherBatchAction(
              db,
              action,
              vouchers,
              user.id,
              emergencyReversal
            )

            appendOperationLog(db, {
              ledgerId:
                applicable.length > 0
                  ? applicable[0].ledger_id
                  : vouchers.length > 0
                    ? vouchers[0].ledger_id
                    : null,
              userId: user.id,
              username: user.username,
              module: 'voucher',
              action,
              targetType: 'voucher_batch',
              targetId: payload.voucherIds.join(','),
              reason: emergencyReversal?.reason ?? null,
              approvalTag: emergencyReversal?.approvalTag ?? null,
              details: {
                processedCount: applicable.length,
                skippedCount: skipped.length,
                requestedCount: vouchers.length
              }
            })
            return {
              success: true,
              processedCount: applicable.length,
              skippedCount: skipped.length,
              requestedCount: vouchers.length
            }
          } catch (error) {
            return {
              success: false,
              error: error instanceof Error ? error.message : '凭证批量操作失败'
            }
          }
        }
      )
  )
}

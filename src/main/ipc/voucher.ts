import { ipcMain } from 'electron'
import Decimal from 'decimal.js'
import { getDatabase } from '../database/init'
import { requireAuth, requirePermission } from './session'

interface VoucherEntryInput {
  summary: string
  subjectCode: string
  debitAmount: string
  creditAmount: string
  cashFlowItemId: number | null
}

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

interface NormalizedVoucherEntry {
  summary: string
  subjectCode: string
  debitCents: number
  creditCents: number
  cashFlowItemId: number | null
}

function isVoucherNumberConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('UNIQUE constraint failed') && error.message.includes('vouchers')
}

function parseAmountToCents(raw: string, field: string): number {
  const value = raw.trim()
  if (value === '') return 0

  const decimalPattern = /^\d+(\.\d{0,2})?$/
  if (!decimalPattern.test(value)) {
    throw new Error(`${field}格式不正确，仅支持最多两位小数`)
  }

  const amount = new Decimal(value)
  if (amount.isNegative()) {
    throw new Error(`${field}不能为负数`)
  }

  return amount.mul(100).toNumber()
}

function normalizeEntries(entries: VoucherEntryInput[]): NormalizedVoucherEntry[] {
  const normalized: NormalizedVoucherEntry[] = []

  for (const entry of entries) {
    const summary = entry.summary.trim()
    const subjectCode = entry.subjectCode.trim()
    const debitCents = parseAmountToCents(entry.debitAmount, '借方金额')
    const creditCents = parseAmountToCents(entry.creditAmount, '贷方金额')

    const isEmpty = summary === '' && subjectCode === '' && debitCents === 0 && creditCents === 0
    if (isEmpty) continue

    normalized.push({
      summary,
      subjectCode,
      debitCents,
      creditCents,
      cashFlowItemId: entry.cashFlowItemId
    })
  }

  return normalized
}

export function registerVoucherHandlers(): void {
  const db = getDatabase()

  ipcMain.handle('voucher:getNextNumber', (event, ledgerId: number, period: string) => {
    requirePermission(event, 'voucher_entry')
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
      )
      .get(ledgerId, period) as { max_num: number }
    return row.max_num + 1
  })

  ipcMain.handle('voucher:save', (event, payload: SaveVoucherInput) => {
    try {
      const currentUser = requirePermission(event, 'voucher_entry')
      if (!payload.ledgerId) {
        return { success: false, error: '请选择账套' }
      }
      if (!payload.voucherDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.voucherDate)) {
        return { success: false, error: '凭证日期格式不正确' }
      }

      const period = payload.voucherDate.slice(0, 7)
      const entries = normalizeEntries(payload.entries)

      if (entries.length < 2) {
        return { success: false, error: '至少需要两条有效分录' }
      }

      let totalDebit = 0
      let totalCredit = 0

      const subjectByCode = new Map<string, { is_cash_flow: number }>()
      const selectSubjectStmt = db.prepare(
        'SELECT code, is_cash_flow FROM subjects WHERE ledger_id = ? AND code = ?'
      )
      const selectCashFlowStmt = db.prepare(
        'SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?'
      )

      for (const [index, entry] of entries.entries()) {
        if (!entry.subjectCode) {
          return { success: false, error: `第${index + 1}行缺少会计科目` }
        }

        if (entry.debitCents > 0 && entry.creditCents > 0) {
          return { success: false, error: `第${index + 1}行借贷不能同时有值` }
        }

        if (entry.debitCents === 0 && entry.creditCents === 0) {
          return { success: false, error: `第${index + 1}行借贷金额不能同时为空` }
        }

        let subject = subjectByCode.get(entry.subjectCode)
        if (!subject) {
          subject = selectSubjectStmt.get(payload.ledgerId, entry.subjectCode) as
            | { code: string; is_cash_flow: number }
            | undefined
          if (!subject) {
            return { success: false, error: `第${index + 1}行科目不存在：${entry.subjectCode}` }
          }
          subjectByCode.set(entry.subjectCode, subject)
        }

        if (subject.is_cash_flow === 1) {
          if (entry.cashFlowItemId === null) {
            return { success: false, error: `第${index + 1}行为现金流科目，必须指定现金流量项目` }
          }

          const cashFlowItem = selectCashFlowStmt.get(payload.ledgerId, entry.cashFlowItemId) as
            | { id: number }
            | undefined
          if (!cashFlowItem) {
            return { success: false, error: `第${index + 1}行现金流量项目无效` }
          }
        }

        totalDebit += entry.debitCents
        totalCredit += entry.creditCents
      }

      if (totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
        return { success: false, error: '借贷不平衡，无法保存' }
      }

      const allowSameRow = db
        .prepare('SELECT value FROM system_settings WHERE key = ?')
        .get('allow_same_maker_auditor') as { value: string } | undefined
      const allowSameMakerAuditor = allowSameRow?.value === '1'

      const createVoucherTx = db.transaction(() => {
        const maxNumberRow = db
          .prepare(
            'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
          )
          .get(payload.ledgerId, period) as { max_num: number }
        const nextNumber = maxNumberRow.max_num + 1

        const voucherWord = (payload.voucherWord || '记').trim() || '记'
        const creatorId = currentUser.id
        const isCarryForward = payload.isCarryForward === true
        const shouldAutoBookkeep = isCarryForward && allowSameMakerAuditor
        const status = shouldAutoBookkeep ? 2 : 0
        const auditorId = shouldAutoBookkeep ? creatorId : null
        const bookkeeperId = shouldAutoBookkeep ? creatorId : null

        const voucherResult = db
          .prepare(
            `INSERT INTO vouchers (
                            ledger_id, period, voucher_date, voucher_number, voucher_word, status,
                            creator_id, auditor_id, bookkeeper_id, is_carry_forward, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .run(
            payload.ledgerId,
            period,
            payload.voucherDate,
            nextNumber,
            voucherWord,
            status,
            creatorId,
            auditorId,
            bookkeeperId,
            isCarryForward ? 1 : 0
          )

        const voucherId = voucherResult.lastInsertRowid as number
        const insertEntryStmt = db.prepare(
          `INSERT INTO voucher_entries (
                        voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )

        for (const [index, entry] of entries.entries()) {
          insertEntryStmt.run(
            voucherId,
            index + 1,
            entry.summary,
            entry.subjectCode,
            entry.debitCents,
            entry.creditCents,
            entry.cashFlowItemId
          )
        }

        return { voucherId, voucherNumber: nextNumber, status }
      })

      let result: { voucherId: number; voucherNumber: number; status: number } | null = null
      const retryLimit = 5
      for (let attempt = 0; attempt < retryLimit; attempt += 1) {
        try {
          result = createVoucherTx()
          break
        } catch (error) {
          if (!isVoucherNumberConflictError(error)) {
            throw error
          }
        }
      }

      if (!result) {
        return { success: false, error: '凭证编号冲突，请重试' }
      }
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

      const period = payload.voucherDate.slice(0, 7)
      const entries = normalizeEntries(payload.entries)
      if (entries.length < 2) {
        return { success: false, error: '至少需要两条有效分录' }
      }

      let totalDebit = 0
      let totalCredit = 0
      const subjectByCode = new Map<string, { is_cash_flow: number }>()
      const selectSubjectStmt = db.prepare(
        'SELECT code, is_cash_flow FROM subjects WHERE ledger_id = ? AND code = ?'
      )
      const selectCashFlowStmt = db.prepare(
        'SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?'
      )

      for (const [index, entry] of entries.entries()) {
        if (!entry.subjectCode) {
          return { success: false, error: `第${index + 1}行缺少会计科目` }
        }

        if (entry.debitCents > 0 && entry.creditCents > 0) {
          return { success: false, error: `第${index + 1}行借贷不能同时有值` }
        }

        if (entry.debitCents === 0 && entry.creditCents === 0) {
          return { success: false, error: `第${index + 1}行借贷金额不能同时为空` }
        }

        let subject = subjectByCode.get(entry.subjectCode)
        if (!subject) {
          subject = selectSubjectStmt.get(payload.ledgerId, entry.subjectCode) as
            | { code: string; is_cash_flow: number }
            | undefined
          if (!subject) {
            return { success: false, error: `第${index + 1}行科目不存在：${entry.subjectCode}` }
          }
          subjectByCode.set(entry.subjectCode, subject)
        }

        if (subject.is_cash_flow === 1) {
          if (entry.cashFlowItemId === null) {
            return { success: false, error: `第${index + 1}行为现金流科目，必须指定现金流量项目` }
          }

          const cashFlowItem = selectCashFlowStmt.get(payload.ledgerId, entry.cashFlowItemId) as
            | { id: number }
            | undefined
          if (!cashFlowItem) {
            return { success: false, error: `第${index + 1}行现金流量项目无效` }
          }
        }

        totalDebit += entry.debitCents
        totalCredit += entry.creditCents
      }

      if (totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
        return { success: false, error: '借贷不平衡，无法保存' }
      }

      const updateVoucherTx = db.transaction(() => {
        db.prepare(
          `UPDATE vouchers
           SET period = ?, voucher_date = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(period, payload.voucherDate, payload.voucherId)

        db.prepare('DELETE FROM voucher_entries WHERE voucher_id = ?').run(payload.voucherId)

        const insertEntryStmt = db.prepare(
          `INSERT INTO voucher_entries (
             voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, cash_flow_item_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )

        for (const [index, entry] of entries.entries()) {
          insertEntryStmt.run(
            payload.voucherId,
            index + 1,
            entry.summary,
            entry.subjectCode,
            entry.debitCents,
            entry.creditCents,
            entry.cashFlowItemId
          )
        }
      })

      try {
        updateVoucherTx()
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
        period?: string
        dateFrom?: string
        dateTo?: string
        keyword?: string
      }
    ) => {
      requireAuth(event)

      const whereClauses = ['v.ledger_id = ?']
      const params: Array<string | number> = [query.ledgerId]

      if (query.period) {
        whereClauses.push('v.period = ?')
        params.push(query.period)
      }
      if (query.dateFrom) {
        whereClauses.push('v.voucher_date >= ?')
        params.push(query.dateFrom)
      }
      if (query.dateTo) {
        whereClauses.push('v.voucher_date <= ?')
        params.push(query.dateTo)
      }
      if (query.keyword) {
        whereClauses.push(
          `EXISTS (
                        SELECT 1 FROM voucher_entries ve
                        WHERE ve.voucher_id = v.id AND ve.summary LIKE ?
                    )`
        )
        params.push(`%${query.keyword}%`)
      }

      const sql = `
                SELECT
                    v.id,
                    v.ledger_id,
                    v.period,
                    v.voucher_date,
                    v.voucher_number,
                    v.voucher_word,
                    v.status,
                    v.creator_id,
                    v.auditor_id,
                    v.bookkeeper_id,
                    SUM(ve.debit_amount) AS total_debit,
                    SUM(ve.credit_amount) AS total_credit
                FROM vouchers v
                INNER JOIN voucher_entries ve ON ve.voucher_id = v.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY v.id
                ORDER BY v.voucher_date DESC, v.voucher_number DESC
            `

      return db.prepare(sql).all(...params)
    }
  )

  ipcMain.handle('voucher:getEntries', (event, voucherId: number) => {
    requireAuth(event)
    return db
      .prepare(
        `SELECT
                    ve.*,
                    s.name AS subject_name,
                    cfi.code AS cash_flow_code,
                    cfi.name AS cash_flow_name
                 FROM voucher_entries ve
                 LEFT JOIN subjects s
                    ON s.code = ve.subject_code
                   AND s.ledger_id = (SELECT ledger_id FROM vouchers WHERE id = ve.voucher_id)
                 LEFT JOIN cash_flow_items cfi
                    ON cfi.id = ve.cash_flow_item_id
                 WHERE ve.voucher_id = ?
                 ORDER BY ve.row_order ASC`
      )
      .all(voucherId)
  })

  ipcMain.handle(
    'voucher:batchAction',
    (
      event,
      payload: {
        action: 'audit' | 'bookkeep' | 'unbookkeep' | 'unaudit' | 'delete'
        voucherIds: number[]
      }
    ) => {
      try {
        if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length === 0) {
          return { success: false, error: '请选择凭证' }
        }

        const action = payload.action
        const user =
          action === 'audit' || action === 'unaudit'
            ? requirePermission(event, 'audit')
            : action === 'bookkeep' || action === 'unbookkeep'
              ? requirePermission(event, 'bookkeeping')
              : requirePermission(event, 'voucher_entry')

        const placeholders = payload.voucherIds.map(() => '?').join(',')
        const vouchers = db
          .prepare(`SELECT id, status FROM vouchers WHERE id IN (${placeholders})`)
          .all(...payload.voucherIds) as Array<{ id: number; status: number }>

        if (vouchers.length !== payload.voucherIds.length) {
          return { success: false, error: '存在无效凭证，操作中止' }
        }

        const runTx = db.transaction(() => {
          for (const voucher of vouchers) {
            if (action === 'audit') {
              if (voucher.status !== 0) throw new Error('仅未审核凭证可审核')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 1, auditor_id = ?, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(user.id, voucher.id)
            } else if (action === 'bookkeep') {
              if (voucher.status !== 1) throw new Error('仅已审核凭证可记账')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 2, bookkeeper_id = ?, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(user.id, voucher.id)
            } else if (action === 'unbookkeep') {
              if (voucher.status !== 2) throw new Error('仅已记账凭证可反记账')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 1, bookkeeper_id = NULL, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(voucher.id)
            } else if (action === 'unaudit') {
              if (voucher.status !== 1) throw new Error('仅已审核凭证可反审核')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 0, auditor_id = NULL, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(voucher.id)
            } else if (action === 'delete') {
              if (voucher.status === 2) throw new Error('已记账凭证不可删除')
              db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucher.id)
            }
          }
        })

        runTx()
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '凭证批量操作失败'
        }
      }
    }
  )
}

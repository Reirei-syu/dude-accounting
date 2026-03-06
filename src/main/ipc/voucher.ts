import { ipcMain } from 'electron'
import Decimal from 'decimal.js'
import { getDatabase } from '../database/init'
import { applyCashFlowMappings } from '../services/cashFlowMapping'
import { assertPeriodWritable } from '../services/periodState'
import { requireAuth, requirePermission } from './session'
import { splitVouchersByBatchAction, type VoucherBatchAction } from './voucherBatchAction'
import { buildVoucherSwapPlan, type VoucherSwapEntry, type VoucherSwapVoucher } from './voucherSwap'

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

interface SwapVoucherPositionsInput {
  voucherIds: number[]
}

type VoucherListStatusFilter = 'all' | 0 | 1 | 2 | 3

interface NormalizedVoucherEntry {
  summary: string
  subjectCode: string
  debitCents: number
  creditCents: number
  cashFlowItemId: number | null
}

interface VoucherSubjectMeta {
  code: string
  is_cash_flow: number
  has_children: number
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

    if (debitCents === 0 && creditCents === 0) continue

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
  const selectLedgerPeriodStmt = db.prepare('SELECT current_period FROM ledgers WHERE id = ?')
  const selectSubjectMetaStmt = db.prepare(
    `SELECT
       s.code,
       s.is_cash_flow,
       EXISTS (
         SELECT 1
           FROM subjects child
          WHERE child.ledger_id = s.ledger_id
            AND child.code <> s.code
            AND (child.parent_code = s.code OR child.code LIKE s.code || '%')
       ) AS has_children
     FROM subjects s
     WHERE s.ledger_id = ? AND s.code = ?`
  )
  const selectCashFlowStmt = db.prepare(
    'SELECT id FROM cash_flow_items WHERE ledger_id = ? AND id = ?'
  )

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

  ipcMain.handle('voucher:getNextNumber', (event, ledgerId: number, period: string) => {
    requirePermission(event, 'voucher_entry')
    const periodCheck = ensureVoucherPeriod(ledgerId, period, 'period')
    if (!periodCheck.ok) {
      throw new Error(periodCheck.error)
    }
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(voucher_number), 0) AS max_num FROM vouchers WHERE ledger_id = ? AND period = ?'
      )
      .get(ledgerId, periodCheck.period) as { max_num: number }
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

      const periodCheck = ensureVoucherPeriod(payload.ledgerId, payload.voucherDate, 'date')
      if (!periodCheck.ok) {
        return { success: false, error: periodCheck.error }
      }
      const period = periodCheck.period
      let entries = normalizeEntries(payload.entries)

      if (entries.length < 2) {
        return { success: false, error: '至少需要两条有效分录' }
      }

      let totalDebit = 0
      let totalCredit = 0

      const subjectByCode = new Map<string, VoucherSubjectMeta>()

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
          subject = selectSubjectMetaStmt.get(payload.ledgerId, entry.subjectCode) as
            | VoucherSubjectMeta
            | undefined
          if (!subject) {
            return { success: false, error: `第${index + 1}行科目不存在：${entry.subjectCode}` }
          }
          subjectByCode.set(entry.subjectCode, subject)
        }

        if (subject.has_children === 1) {
          return {
            success: false,
            error: `第${index + 1}行必须使用末级科目：${entry.subjectCode}`
          }
        }

        totalDebit += entry.debitCents
        totalCredit += entry.creditCents
      }

      const autoMatched = applyCashFlowMappings(
        entries.map((entry) => ({
          subjectCode: entry.subjectCode,
          debitCents: entry.debitCents,
          creditCents: entry.creditCents,
          cashFlowItemId: entry.cashFlowItemId,
          isCashFlow: (subjectByCode.get(entry.subjectCode)?.is_cash_flow ?? 0) === 1
        })),
        (
          db
            .prepare(
              `SELECT
                 subject_code,
                 counterpart_subject_code,
                 entry_direction,
                 cash_flow_item_id
               FROM cash_flow_mappings
               WHERE ledger_id = ?
                 AND counterpart_subject_code <> ''`
            )
            .all(payload.ledgerId) as Array<{
            subject_code: string
            counterpart_subject_code: string
            entry_direction: 'inflow' | 'outflow'
            cash_flow_item_id: number
          }>
        ).map((rule) => ({
          subjectCode: rule.subject_code,
          counterpartSubjectCode: rule.counterpart_subject_code,
          entryDirection: rule.entry_direction,
          cashFlowItemId: rule.cash_flow_item_id
        }))
      )

      if (autoMatched.errors.length > 0) {
        return { success: false, error: autoMatched.errors[0] }
      }

      entries = entries.map((entry, index) => ({
        ...entry,
        cashFlowItemId: autoMatched.entries[index].cashFlowItemId
      }))

      for (const [index, entry] of entries.entries()) {
        const subject = subjectByCode.get(entry.subjectCode)
        if (!subject) {
          return { success: false, error: `第${index + 1}行科目不存在：${entry.subjectCode}` }
        }

        if (subject.is_cash_flow !== 1 && entry.cashFlowItemId !== null) {
          return { success: false, error: `第${index + 1}行非现金流科目，不应指定现金流量项目` }
        }

        if (entry.cashFlowItemId !== null) {
          const cashFlowItem = selectCashFlowStmt.get(payload.ledgerId, entry.cashFlowItemId) as
            | { id: number }
            | undefined
          if (!cashFlowItem) {
            return { success: false, error: `第${index + 1}行现金流量项目无效` }
          }
        }
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

      const periodCheck = ensureVoucherPeriod(payload.ledgerId, payload.voucherDate, 'date')
      if (!periodCheck.ok) {
        return { success: false, error: periodCheck.error }
      }
      const period = periodCheck.period
      const entries = normalizeEntries(payload.entries)
      if (entries.length < 2) {
        return { success: false, error: '至少需要两条有效分录' }
      }

      let totalDebit = 0
      let totalCredit = 0
      const subjectByCode = new Map<string, VoucherSubjectMeta>()

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
          subject = selectSubjectMetaStmt.get(payload.ledgerId, entry.subjectCode) as
            | VoucherSubjectMeta
            | undefined
          if (!subject) {
            return { success: false, error: `第${index + 1}行科目不存在：${entry.subjectCode}` }
          }
          subjectByCode.set(entry.subjectCode, subject)
        }

        if (subject.has_children === 1) {
          return {
            success: false,
            error: `第${index + 1}行必须使用末级科目：${entry.subjectCode}`
          }
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
        status?: VoucherListStatusFilter
      }
    ) => {
      requireAuth(event)

      const whereClauses = ['v.ledger_id = ?']
      const params: Array<string | number> = [query.ledgerId]

      if (query.status === 'all') {
        // Explicitly include all voucher states, including deleted.
      } else if (typeof query.status === 'number') {
        whereClauses.push('v.status = ?')
        params.push(query.status)
      } else {
        whereClauses.push('v.status IN (0, 1, 2)')
      }

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
                    COALESCE(
                      (
                        SELECT ve_first.summary
                        FROM voucher_entries ve_first
                        WHERE ve_first.voucher_id = v.id
                        ORDER BY ve_first.row_order ASC, ve_first.id ASC
                        LIMIT 1
                      ),
                      ''
                    ) AS first_summary,
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

  ipcMain.handle('voucher:swapPositions', (event, payload: SwapVoucherPositionsInput) => {
    try {
      requirePermission(event, 'voucher_entry')

      if (!Array.isArray(payload.voucherIds) || payload.voucherIds.length !== 2) {
        return {
          success: false,
          error: '\u4ec5\u9009\u62e9 2 \u5f20\u51ed\u8bc1\u65f6\u624d\u53ef\u4ea4\u6362\u4f4d\u7f6e'
        }
      }

      const voucherIds = Array.from(new Set(payload.voucherIds))
      if (voucherIds.length !== 2) {
        return {
          success: false,
          error: '\u8bf7\u9009\u62e9\u4e24\u5f20\u4e0d\u540c\u7684\u51ed\u8bc1'
        }
      }

      const placeholders = voucherIds.map(() => '?').join(',')
      const voucherRows = db
        .prepare(
          `SELECT
             id,
             ledger_id,
             period,
             voucher_date,
             status,
             creator_id,
             auditor_id,
             bookkeeper_id,
             attachment_count,
             is_carry_forward
           FROM vouchers
           WHERE id IN (${placeholders})`
        )
        .all(...voucherIds) as Array<{
        id: number
        ledger_id: number
        period: string
        voucher_date: string
        status: number
        creator_id: number | null
        auditor_id: number | null
        bookkeeper_id: number | null
        attachment_count: number
        is_carry_forward: number
      }>

      if (voucherRows.length !== 2) {
        return {
          success: false,
          error: '\u5b58\u5728\u65e0\u6548\u51ed\u8bc1\uff0c\u4ea4\u6362\u5931\u8d25'
        }
      }

      const vouchersById = new Map<number, VoucherSwapVoucher>(
        voucherRows.map((voucher) => [
          voucher.id,
          {
            id: voucher.id,
            ledgerId: voucher.ledger_id,
            period: voucher.period,
            voucherDate: voucher.voucher_date,
            status: voucher.status,
            creatorId: voucher.creator_id,
            auditorId: voucher.auditor_id,
            bookkeeperId: voucher.bookkeeper_id,
            attachmentCount: voucher.attachment_count,
            isCarryForward: voucher.is_carry_forward
          }
        ])
      )

      const firstVoucher = vouchersById.get(voucherIds[0])
      const secondVoucher = vouchersById.get(voucherIds[1])

      if (!firstVoucher || !secondVoucher) {
        return {
          success: false,
          error: '\u5b58\u5728\u65e0\u6548\u51ed\u8bc1\uff0c\u4ea4\u6362\u5931\u8d25'
        }
      }

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

      const entryRows = db
        .prepare(
          `SELECT
             voucher_id,
             row_order,
             summary,
             subject_code,
             debit_amount,
             credit_amount,
             auxiliary_item_id,
             cash_flow_item_id
           FROM voucher_entries
           WHERE voucher_id IN (${placeholders})
           ORDER BY voucher_id ASC, row_order ASC, id ASC`
        )
        .all(...voucherIds) as Array<{
        voucher_id: number
        row_order: number
        summary: string
        subject_code: string
        debit_amount: number
        credit_amount: number
        auxiliary_item_id: number | null
        cash_flow_item_id: number | null
      }>

      const buildEntriesForVoucher = (voucherId: number): VoucherSwapEntry[] =>
        entryRows
          .filter((entry) => entry.voucher_id === voucherId)
          .map((entry) => ({
            rowOrder: entry.row_order,
            summary: entry.summary,
            subjectCode: entry.subject_code,
            debitAmount: entry.debit_amount,
            creditAmount: entry.credit_amount,
            auxiliaryItemId: entry.auxiliary_item_id,
            cashFlowItemId: entry.cash_flow_item_id
          }))

      const plan = buildVoucherSwapPlan(
        firstVoucher,
        secondVoucher,
        buildEntriesForVoucher(firstVoucher.id),
        buildEntriesForVoucher(secondVoucher.id)
      )

      const updateVoucherStmt = db.prepare(
        `UPDATE vouchers
         SET voucher_date = ?,
             status = ?,
             creator_id = ?,
             auditor_id = ?,
             bookkeeper_id = ?,
             attachment_count = ?,
             is_carry_forward = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      const deleteEntriesStmt = db.prepare('DELETE FROM voucher_entries WHERE voucher_id = ?')
      const insertEntryStmt = db.prepare(
        `INSERT INTO voucher_entries (
           voucher_id,
           row_order,
           summary,
           subject_code,
           debit_amount,
           credit_amount,
           auxiliary_item_id,
           cash_flow_item_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )

      const swapTx = db.transaction(() => {
        updateVoucherStmt.run(
          plan.firstVoucherUpdate.voucherDate,
          plan.firstVoucherUpdate.status,
          plan.firstVoucherUpdate.creatorId,
          plan.firstVoucherUpdate.auditorId,
          plan.firstVoucherUpdate.bookkeeperId,
          plan.firstVoucherUpdate.attachmentCount,
          plan.firstVoucherUpdate.isCarryForward,
          plan.firstVoucherId
        )
        updateVoucherStmt.run(
          plan.secondVoucherUpdate.voucherDate,
          plan.secondVoucherUpdate.status,
          plan.secondVoucherUpdate.creatorId,
          plan.secondVoucherUpdate.auditorId,
          plan.secondVoucherUpdate.bookkeeperId,
          plan.secondVoucherUpdate.attachmentCount,
          plan.secondVoucherUpdate.isCarryForward,
          plan.secondVoucherId
        )

        deleteEntriesStmt.run(plan.firstVoucherId)
        deleteEntriesStmt.run(plan.secondVoucherId)

        for (const entry of plan.firstVoucherEntries) {
          insertEntryStmt.run(
            plan.firstVoucherId,
            entry.rowOrder,
            entry.summary,
            entry.subjectCode,
            entry.debitAmount,
            entry.creditAmount,
            entry.auxiliaryItemId,
            entry.cashFlowItemId
          )
        }

        for (const entry of plan.secondVoucherEntries) {
          insertEntryStmt.run(
            plan.secondVoucherId,
            entry.rowOrder,
            entry.summary,
            entry.subjectCode,
            entry.debitAmount,
            entry.creditAmount,
            entry.auxiliaryItemId,
            entry.cashFlowItemId
          )
        }
      })

      swapTx()

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
  })

  ipcMain.handle(
    'voucher:batchAction',
    (
      event,
      payload: {
        action: VoucherBatchAction
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
          .prepare(
            `SELECT
               id,
               status,
               deleted_from_status,
               ledger_id,
               period,
               voucher_word,
               auditor_id,
               bookkeeper_id
             FROM vouchers
             WHERE id IN (${placeholders})`
          )
          .all(...payload.voucherIds) as Array<{
          id: number
          status: number
          deleted_from_status: number | null
          ledger_id: number
          period: string
          voucher_word: string
          auditor_id: number | null
          bookkeeper_id: number | null
        }>

        if (vouchers.length !== payload.voucherIds.length) {
          return { success: false, error: '存在无效凭证，操作中止' }
        }

        const { applicable: applicableVouchers, skipped: skippedVouchers } =
          splitVouchersByBatchAction(action, vouchers)

        const runTx = db.transaction(() => {
          for (const voucher of applicableVouchers) {
            if (action === 'audit') {
              if (voucher.status !== 0) continue
              if (voucher.status !== 0) throw new Error('仅未审核凭证可审核')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 1, auditor_id = ?, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(user.id, voucher.id)
            } else if (action === 'bookkeep') {
              if (voucher.status !== 1) continue
              if (voucher.status !== 1) throw new Error('仅已审核凭证可记账')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 2, bookkeeper_id = ?, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(user.id, voucher.id)
            } else if (action === 'unbookkeep') {
              if (voucher.status !== 2) continue
              if (voucher.status !== 2) throw new Error('仅已记账凭证可反记账')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 1, bookkeeper_id = NULL, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(voucher.id)
            } else if (action === 'unaudit') {
              if (voucher.status !== 1) continue
              if (voucher.status !== 1) throw new Error('仅已审核凭证可反审核')
              db.prepare(
                `UPDATE vouchers
                                 SET status = 0, auditor_id = NULL, updated_at = datetime('now')
                                 WHERE id = ?`
              ).run(voucher.id)
            } else if (action === 'delete') {
              if (voucher.status !== 0 && voucher.status !== 1) continue
              db.prepare(
                `UPDATE vouchers
                 SET status = 3, deleted_from_status = status, updated_at = datetime('now')
                 WHERE id = ?`
              ).run(voucher.id)
            } else if (action === 'restoreDelete') {
              if (voucher.status !== 3) continue

              const restoredStatus = voucher.deleted_from_status ?? 0
              if (restoredStatus === 0) {
                db.prepare(
                  `UPDATE vouchers
                   SET status = 0,
                       deleted_from_status = NULL,
                       auditor_id = NULL,
                       bookkeeper_id = NULL,
                       updated_at = datetime('now')
                   WHERE id = ?`
                ).run(voucher.id)
              } else if (restoredStatus === 1) {
                db.prepare(
                  `UPDATE vouchers
                   SET status = 1,
                       deleted_from_status = NULL,
                       bookkeeper_id = NULL,
                       updated_at = datetime('now')
                   WHERE id = ?`
                ).run(voucher.id)
              } else {
                db.prepare(
                  `UPDATE vouchers
                   SET status = ?,
                       deleted_from_status = NULL,
                       updated_at = datetime('now')
                   WHERE id = ?`
                ).run(restoredStatus, voucher.id)
              }
            } else if (action === 'purgeDelete') {
              if (voucher.status !== 3) continue
              db.prepare('DELETE FROM vouchers WHERE id = ?').run(voucher.id)
            }
          }
        })

        runTx()
        return {
          success: true,
          processedCount: applicableVouchers.length,
          skippedCount: skippedVouchers.length,
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
}

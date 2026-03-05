import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useLedgerStore } from '../stores/ledgerStore'

type BalanceRow = {
  subject_code: string
  subject_name: string
  balance_direction: number
  debit_amount: number
  credit_amount: number
}

type EditableRow = {
  code: string
  name: string
  balanceDirection: number
  debit: string
  credit: string
}

const DECIMAL_PATTERN = /^\d*(\.\d{0,2})?$/

function formatCents(value: number): string {
  if (!value) return ''
  return new Decimal(value).div(100).toFixed(2)
}

function parseAmount(value: string): { amount: Decimal; valid: boolean } {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { amount: new Decimal(0), valid: true }
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { amount: new Decimal(0), valid: false }
  }
  return { amount: new Decimal(trimmed), valid: true }
}

function getDirectionLabel(direction: number): string {
  return direction === 1 ? '借方' : '贷方'
}

function computeTargetPeriod(startPeriod: string, currentPeriod: string): string {
  if (!startPeriod) return ''
  if (!currentPeriod || !/^\d{4}-\d{2}$/.test(currentPeriod)) return startPeriod
  const startYear = Number(startPeriod.slice(0, 4))
  const currentYear = Number(currentPeriod.slice(0, 4))
  if (Number.isNaN(startYear) || Number.isNaN(currentYear) || currentYear <= startYear) {
    return startPeriod
  }
  return `${currentYear}-01`
}

export default function InitialBalance(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const [rows, setRows] = useState<EditableRow[]>([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  const targetPeriod = useMemo(() => {
    if (!currentLedger) return ''
    return computeTargetPeriod(currentLedger.start_period, currentPeriod || '')
  }, [currentLedger, currentPeriod])

  const canOperate = Boolean(window.electron && currentLedger)

  const loadRows = useCallback(async (): Promise<void> => {
    if (!currentLedger || !window.electron || !targetPeriod) {
      setRows([])
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const list = (await window.api.initialBalance.list(
        currentLedger.id,
        targetPeriod
      )) as BalanceRow[]
      setRows(
        list.map((row) => ({
          code: row.subject_code,
          name: row.subject_name,
          balanceDirection: row.balance_direction,
          debit: formatCents(row.debit_amount),
          credit: formatCents(row.credit_amount)
        }))
      )
    } catch (error) {
      setRows([])
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载期初余额失败'
      })
    } finally {
      setLoading(false)
    }
  }, [currentLedger, targetPeriod])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  const filteredRows = useMemo(() => {
    const trimmed = keyword.trim()
    if (!trimmed) return rows
    return rows.filter(
      (row) => row.code.includes(trimmed) || row.name.toLowerCase().includes(trimmed.toLowerCase())
    )
  }, [keyword, rows])

  const totals = useMemo(() => {
    let debit = new Decimal(0)
    let credit = new Decimal(0)
    let hasInvalid = false

    for (const row of rows) {
      const parsedDebit = parseAmount(row.debit)
      const parsedCredit = parseAmount(row.credit)
      if (!parsedDebit.valid || !parsedCredit.valid) {
        hasInvalid = true
      }
      debit = debit.plus(parsedDebit.amount)
      credit = credit.plus(parsedCredit.amount)
    }

    return {
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      balanced: debit.equals(credit),
      hasInvalid
    }
  }, [rows])

  const updateRow = (code: string, field: 'debit' | 'credit', value: string): void => {
    setRows((current) =>
      current.map((row) => {
        if (row.code !== code) return row
        const trimmed = value.trim()
        if (field === 'debit' && trimmed !== '') {
          return { ...row, debit: value, credit: '' }
        }
        if (field === 'credit' && trimmed !== '') {
          return { ...row, credit: value, debit: '' }
        }
        return { ...row, [field]: value }
      })
    )
  }

  const handleSave = async (): Promise<void> => {
    setMessage(null)
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持保存期初余额' })
      return
    }
    if (!targetPeriod) {
      setMessage({ type: 'error', text: '期初期间不正确' })
      return
    }
    if (totals.hasInvalid) {
      setMessage({ type: 'error', text: '存在金额格式不正确的行' })
      return
    }
    if (!totals.balanced) {
      setMessage({ type: 'error', text: '借贷合计不平衡，无法保存' })
      return
    }

    try {
      const result = await window.api.initialBalance.save({
        ledgerId: currentLedger.id,
        period: targetPeriod,
        entries: rows.map((row) => ({
          subjectCode: row.code,
          debitAmount: row.debit,
          creditAmount: row.credit
        }))
      })
      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存期初余额失败' })
        return
      }
      setMessage({ type: 'success', text: '期初余额保存成功' })
      await loadRows()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存期初余额失败'
      })
    }
  }

  const note =
    currentLedger && targetPeriod === currentLedger.start_period
      ? `首年期初以启用年月 ${currentLedger.start_period} 为准`
      : '后续年度期初统一按当年 1 月录入'

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          期初数录入
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="glass-input"
            placeholder="搜索科目编码或名称"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <button className="glass-btn-secondary" onClick={() => void loadRows()} disabled={loading}>
            刷新
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void handleSave()}
            disabled={!canOperate || loading}
            style={!canOperate ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
          >
            保存
          </button>
        </div>
      </div>

      <div className="glass-panel-light px-4 py-3 flex flex-wrap items-center gap-4 text-sm">
        <div>
          <span style={{ color: 'var(--color-text-muted)' }}>期初期间：</span>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
            {targetPeriod || '未选择'}
          </span>
        </div>
        <div style={{ color: 'var(--color-text-muted)' }}>{note}</div>
      </div>

      <div className="glass-panel flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[780px] h-full">
            <div
              className="grid grid-cols-[120px_minmax(0,1fr)_72px_150px_150px] gap-2 px-3 py-3 text-sm font-semibold border-b"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div>科目编码</div>
              <div>科目名称</div>
              <div>方向</div>
              <div className="text-right">借方金额</div>
              <div className="text-right">贷方金额</div>
            </div>

            <div className="overflow-y-auto h-[calc(100%-78px)] px-2 py-2 pr-4">
              {filteredRows.map((row) => (
                <div
                  key={row.code}
                  className="grid grid-cols-[120px_minmax(0,1fr)_72px_150px_150px] gap-2 px-2 py-2 rounded-lg text-sm items-center"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  <div>{row.code}</div>
                  <div className="truncate">{row.name}</div>
                  <div>{getDirectionLabel(row.balanceDirection)}</div>
                  <div>
                    <input
                      className="glass-input text-right w-full"
                      inputMode="decimal"
                      value={row.debit}
                      onChange={(event) => updateRow(row.code, 'debit', event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <input
                      className="glass-input text-right w-full"
                      inputMode="decimal"
                      value={row.credit}
                      onChange={(event) => updateRow(row.code, 'credit', event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ))}

              {filteredRows.length === 0 && !loading && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  未找到匹配科目
                </div>
              )}
            </div>

            <div
              className="flex justify-end gap-6 px-4 py-2 border-t text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: totals.balanced ? 'var(--color-text-secondary)' : 'var(--color-danger)'
              }}
            >
              <span>借方合计：{totals.debit}</span>
              <span>贷方合计：{totals.credit}</span>
              {!totals.balanced && <span>借贷不平</span>}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div
          className="text-sm px-2"
          aria-live="polite"
          style={{
            color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {message.text}
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

interface VoucherQueryProps {
  presetDateFrom?: string
  presetDateTo?: string
  presetKeyword?: string
  presetVoucherId?: number
  autoQuery?: boolean
  queryRequestKey?: number
}

interface VoucherRow {
  id: number
  period: string
  voucher_date: string
  voucher_number: number
  voucher_word: string
  status: 0 | 1 | 2 | 3
  total_debit: number
  total_credit: number
}

const STATUS_TEXT: Record<number, string> = {
  0: '未审核',
  1: '已审核',
  2: '已记账',
  3: '已删除'
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return {
    from: `${year}-${month}-01`,
    to: formatDate(now)
  }
}

function getCurrentYearDateRange(): { from: string; to: string } {
  const year = new Date().getFullYear()
  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`
  }
}

function formatAmount(amountCents: number): string {
  return new Decimal(amountCents).div(100).toFixed(2)
}

export default function VoucherQuery(props: VoucherQueryProps): JSX.Element {
  const { currentLedger } = useLedgerStore()
  const openTab = useUIStore((state) => state.openTab)
  const { from, to } = useMemo(getDefaultDateRange, [])

  const [dateFrom, setDateFrom] = useState(props.presetDateFrom ?? from)
  const [dateTo, setDateTo] = useState(props.presetDateTo ?? to)
  const [keyword, setKeyword] = useState(props.presetKeyword ?? '')
  const [voucherId, setVoucherId] = useState<number | undefined>(props.presetVoucherId)
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const executeQuery = async (overrides?: {
    dateFrom?: string
    dateTo?: string
    keyword?: string
    voucherId?: number
  }): Promise<void> => {
    setError('')
    if (!currentLedger) {
      setRows([])
      setError('请先选择账套')
      return
    }
    if (!window.electron) {
      setRows([])
      setError('浏览器预览模式不支持查询')
      return
    }

    const finalDateFrom = overrides?.dateFrom ?? dateFrom
    const finalDateTo = overrides?.dateTo ?? dateTo
    const finalKeyword = overrides?.keyword ?? keyword
    const finalVoucherId = overrides?.voucherId ?? voucherId

    setLoading(true)
    try {
      const list = await window.api.voucher.list({
        ledgerId: currentLedger.id,
        voucherId: finalVoucherId,
        dateFrom: finalDateFrom,
        dateTo: finalDateTo,
        keyword: finalKeyword.trim() || undefined
      })
      setRows(list as VoucherRow[])
    } catch (err) {
      setRows([])
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const nextDateFrom = props.presetDateFrom ?? from
    const nextDateTo = props.presetDateTo ?? to
    const nextKeyword = props.presetKeyword ?? ''

    setDateFrom(nextDateFrom)
    setDateTo(nextDateTo)
    setKeyword(nextKeyword)
    setVoucherId(props.presetVoucherId)

    if (props.autoQuery) {
      void executeQuery({
        dateFrom: nextDateFrom,
        dateTo: nextDateTo,
        keyword: nextKeyword,
        voucherId: props.presetVoucherId
      })
    }
  }, [
    currentLedger?.id,
    from,
    props.autoQuery,
    props.presetDateFrom,
    props.presetDateTo,
    props.presetKeyword,
    props.presetVoucherId,
    props.queryRequestKey,
    to
  ])

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void executeQuery()
  }

  const handleSelectCurrentYear = (): void => {
    const range = getCurrentYearDateRange()
    setDateFrom(range.from)
    setDateTo(range.to)
    setError('')
  }

  const openVoucherForView = (row: VoucherRow): void => {
    openTab({
      id: 'voucher-entry',
      title: '凭证录入',
      componentType: 'VoucherEntry',
      params: {
        editVoucherId: row.id,
        editRequestKey: Date.now()
      }
    })
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        凭证查询
      </h2>

      <form
        className="glass-panel-light p-3 flex items-center gap-3 flex-wrap"
        onSubmit={handleSubmit}
      >
        <label
          className="text-sm"
          htmlFor="voucher-date-from"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          从
        </label>
        <input
          id="voucher-date-from"
          type="date"
          className="glass-input px-3 py-2 text-sm"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <label
          className="text-sm"
          htmlFor="voucher-date-to"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          到
        </label>
        <input
          id="voucher-date-to"
          type="date"
          className="glass-input px-3 py-2 text-sm"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <button
          type="button"
          className="glass-btn-secondary px-4 py-2 text-sm font-semibold"
          onClick={handleSelectCurrentYear}
          title="将日期范围切换为本年 1 月 1 日到 12 月 31 日"
        >
          本年
        </button>
        <input
          id="voucher-keyword"
          className="glass-input px-3 py-2 text-sm min-w-[220px]"
          placeholder="摘要关键字（模糊查询）"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          aria-label="摘要关键字"
        />
        <button className="glass-btn-secondary px-5 py-2" type="submit">
          {loading ? '查询中...' : '查询'}
        </button>
      </form>

      <div className="glass-panel flex-1 overflow-hidden">
        <div className="h-full overflow-x-auto">
          <div className="min-w-[760px] h-full">
            <div
              className="grid grid-cols-12 py-2 px-3 border-b text-sm font-semibold"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-primary)'
              }}
            >
              <div className="col-span-2">日期</div>
              <div className="col-span-2">凭证号</div>
              <div className="col-span-2">状态</div>
              <div className="col-span-3 text-right">借方发生额</div>
              <div className="col-span-3 text-right">贷方发生额</div>
            </div>
            <div className="overflow-y-auto h-[calc(100%-41px)]">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-12 py-2 px-3 border-b text-sm cursor-pointer transition-colors hover:bg-black/5"
                  style={{
                    borderColor: 'var(--color-glass-border-light)',
                    color: 'var(--color-text-secondary)'
                  }}
                  onDoubleClick={() => openVoucherForView(row)}
                >
                  <div className="col-span-2">{row.voucher_date}</div>
                  <div className="col-span-2">
                    {row.voucher_word}-{String(row.voucher_number).padStart(4, '0')}
                  </div>
                  <div className="col-span-2">{STATUS_TEXT[row.status]}</div>
                  <div className="col-span-3 text-right">{formatAmount(row.total_debit)}</div>
                  <div className="col-span-3 text-right">{formatAmount(row.total_credit)}</div>
                </div>
              ))}
              {rows.length === 0 && !loading && (
                <div
                  className="py-10 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  暂无数据
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--color-danger)' }} aria-live="polite">
          {error}
        </div>
      )}
    </div>
  )
}

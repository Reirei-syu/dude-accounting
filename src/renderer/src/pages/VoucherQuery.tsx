import { useMemo, useState, type FormEvent, type JSX } from 'react'
import Decimal from 'decimal.js'
import { useLedgerStore } from '../stores/ledgerStore'
import { useUIStore } from '../stores/uiStore'

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

export default function VoucherQuery(): JSX.Element {
  const { currentLedger } = useLedgerStore()
  const openTab = useUIStore((state) => state.openTab)
  const { from, to } = useMemo(getDefaultDateRange, [])

  const [dateFrom, setDateFrom] = useState(from)
  const [dateTo, setDateTo] = useState(to)
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<VoucherRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleQuery = async (): Promise<void> => {
    setError('')
    if (!currentLedger) {
      setError('请先选择账套')
      return
    }
    if (!window.electron) {
      setError('浏览器预览模式不支持查询')
      return
    }

    setLoading(true)
    try {
      const list = await window.api.voucher.list({
        ledgerId: currentLedger.id,
        dateFrom,
        dateTo,
        keyword: keyword.trim() || undefined
      })
      setRows(list as VoucherRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void handleQuery()
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
          onChange={(e) => setDateFrom(e.target.value)}
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
          onChange={(e) => setDateTo(e.target.value)}
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
          onChange={(e) => setKeyword(e.target.value)}
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
                  className="grid grid-cols-12 py-2 px-3 border-b text-sm cursor-pointer"
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
                  <div className="col-span-3 text-right">
                    {new Decimal(row.total_debit).div(100).toFixed(2)}
                  </div>
                  <div className="col-span-3 text-right">
                    {new Decimal(row.total_credit).div(100).toFixed(2)}
                  </div>
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

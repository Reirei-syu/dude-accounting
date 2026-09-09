import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import Decimal from 'decimal.js'
import type { ElectronicVoucherListRow } from '../../../shared/contracts/electronicVoucher'
import { useLedgerStore } from '../stores/ledgerStore'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'

const statusLabels = {
  imported: '待核验',
  verified: '人工核验通过',
  parsed: '结构化已复核',
  converted: '已关联凭证',
  rejected: '已拒绝'
}

export default function ElectronicVoucherPage(): JSX.Element {
  const ledgerId = useLedgerStore((state) => state.currentLedger?.id)
  const userId = useAuthStore((state) => state.user?.id)
  return ledgerId ? (
    <ElectronicVoucherScope key={`${userId}:${ledgerId}`} ledgerId={ledgerId} />
  ) : (
    <p>请先选择账套</p>
  )
}

function ElectronicVoucherScope({ ledgerId }: { ledgerId: number }): JSX.Element {
  const [records, setRecords] = useState<ElectronicVoucherListRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [sourcePath, setSourcePath] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [form, setForm] = useState({ number: '', date: '', amount: '', counterpart: '' })
  const [voucherId, setVoucherId] = useState('')
  const mounted = useRef(false)
  const busyRef = useRef(false)
  const selected = records.find((row) => row.id === selectedId)
  const reload = useCallback(async (): Promise<void> => {
    const rows = await window.api.eVoucher.list(ledgerId)
    if (mounted.current) setRecords(rows)
  }, [ledgerId])
  useEffect(() => {
    mounted.current = true
    void reload().catch((error: Error) => {
      if (mounted.current) setMessage(error.message)
    })
    return () => {
      mounted.current = false
    }
  }, [reload])

  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    try {
      await operation()
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : '处理失败')
    } finally {
      try {
        if (mounted.current) await reload()
      } catch (error) {
        if (mounted.current) setMessage(error instanceof Error ? error.message : '刷新失败')
      }
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const check = (result: { success: boolean; error?: string }): void => {
    if (!result.success) throw new Error(result.error || '处理失败')
  }
  const select = (row: ElectronicVoucherListRow): void => {
    setSelectedId(row.id)
    setEvidence('')
    setConfirmed(false)
    setVoucherId('')
    setForm({
      number: row.source_number ?? '',
      date: row.source_date ?? '',
      amount: row.amount_cents === null ? '' : new Decimal(row.amount_cents).div(100).toFixed(2),
      counterpart: row.counterpart_name ?? ''
    })
  }
  const locked = busy || !selected || selected.linked_voucher_id !== null
  const parsed = selected?.status === 'parsed'
  const verified = parsed || selected?.status === 'verified'
  const button =
    'glass-btn-secondary px-3 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-40'
  const input = 'glass-input w-full px-3 py-2'

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">电子凭证</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        原件接收 → 核验 → 人工摘录复核 → 去重 → 预填或关联 → 留痕。 当前 PDF
        仅支持完整性检查和有依据的人工核验，不提供自动验签、税务验真或 OCR；其他格式保留待核验。
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            const result = await window.api.eVoucher.import({
              ledgerId,
              sourcePath,
              operationId: crypto.randomUUID()
            })
            check(result)
            if (mounted.current) {
              setMessage('原件已接收，请选择记录完成核验')
              setSourcePath('')
            }
          })
        }}
      >
        <input
          aria-label="原件绝对路径"
          className={input}
          placeholder="原件绝对路径（支持 Windows 或 /mnt/盘符 路径）"
          value={sourcePath}
          onChange={(event) => setSourcePath(event.target.value)}
          disabled={busy}
        />
        <button className={button} disabled={busy || !sourcePath.trim()}>
          接收原件
        </button>
        <button className={button} type="button" disabled={busy} onClick={() => void run(reload)}>
          刷新
        </button>
      </form>
      {message && (
        <p role="status" className="glass-panel-light p-3 text-sm">
          {message}
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)] gap-4 min-h-0 flex-1">
        <div className="glass-panel overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="p-3 text-left">原件</th>
                <th>状态</th>
                <th>来源号码</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr
                  key={row.id}
                  style={{
                    background: selectedId === row.id ? 'var(--color-surface-hover)' : undefined
                  }}
                >
                  <td className="p-3">
                    <button
                      className="text-left underline"
                      disabled={busy}
                      onClick={() => select(row)}
                    >
                      {row.original_name}
                    </button>
                    <div className="text-xs">#{row.id}</div>
                  </td>
                  <td>
                    {statusLabels[row.status]}
                    {row.linked_voucher_id && <div>凭证 #{row.linked_voucher_id}</div>}
                  </td>
                  <td>{row.source_number || '待摘录'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {records.length === 0 && <p className="p-4">暂无电子凭证</p>}
        </div>
        <div className="glass-panel p-4 overflow-auto flex flex-col gap-3">
          {!selected ? (
            <p>请选择原件记录</p>
          ) : (
            <>
              <h2 className="font-semibold">{selected.original_name}</h2>
              <p className="text-xs break-all">SHA-256：{selected.sha256}</p>
              {selected.last_error && (
                <p role="alert" className="text-sm" style={{ color: 'var(--color-danger)' }}>
                  最近处理信息：{selected.last_error}
                </p>
              )}
              <button
                className={button}
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    check(await window.api.eVoucher.verify({ recordId: selected.id }))
                    if (mounted.current) setMessage('完整性检查已留痕，请查看记录状态与处理信息')
                  })
                }
              >
                检查原件完整性（不代表验真）
              </button>
              <label>
                人工核验依据
                <textarea
                  aria-label="人工核验依据"
                  className={input}
                  disabled={locked}
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  placeholder="填写实际核验渠道、核验结果及依据；不要填写密码或账号凭据"
                />
              </label>
              <label className="text-sm flex gap-2">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已实际核验原件真实性并确认上述依据，知晓这不是系统自动验真
              </label>
              <div className="flex gap-2">
                <button
                  className={button}
                  disabled={locked || !confirmed || !evidence.trim()}
                  onClick={() =>
                    void run(async () => {
                      check(
                        await window.api.eVoucher.verify({
                          recordId: selected.id,
                          verificationStatus: 'verified',
                          verificationMessage: evidence,
                          manualConfirmation: true
                        })
                      )
                      if (mounted.current) setMessage('人工核验申请已处理，请以记录最新状态为准')
                    })
                  }
                >
                  记录人工核验通过
                </button>
                <button
                  className={button}
                  disabled={locked || !evidence.trim()}
                  onClick={() =>
                    void run(async () => {
                      check(
                        await window.api.eVoucher.verify({
                          recordId: selected.id,
                          verificationStatus: 'failed',
                          verificationMessage: evidence
                        })
                      )
                      if (mounted.current) setMessage('已拒绝，后续入账已阻止')
                    })
                  }
                >
                  记录核验失败
                </button>
              </div>
              <h3 className="font-semibold mt-2">人工摘录复核</h3>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  来源号码
                  <input
                    className={input}
                    disabled={locked}
                    value={form.number}
                    onChange={(event) => setForm({ ...form, number: event.target.value })}
                  />
                </label>
                <label>
                  来源日期
                  <input
                    className={input}
                    type="date"
                    disabled={locked}
                    value={form.date}
                    onChange={(event) => setForm({ ...form, date: event.target.value })}
                  />
                </label>
                <label>
                  金额（元）
                  <input
                    className={input}
                    disabled={locked}
                    value={form.amount}
                    onChange={(event) => setForm({ ...form, amount: event.target.value })}
                  />
                </label>
                <label>
                  往来名称
                  <input
                    className={input}
                    disabled={locked}
                    value={form.counterpart}
                    onChange={(event) => setForm({ ...form, counterpart: event.target.value })}
                  />
                </label>
              </div>
              <button
                className={button}
                disabled={locked || !verified}
                onClick={() =>
                  void run(async () => {
                    const cents = new Decimal(form.amount).times(100)
                    if (!cents.isInteger() || !Number.isSafeInteger(cents.toNumber()))
                      throw new Error('金额须精确到分且在安全范围内')
                    check(
                      await window.api.eVoucher.parse({
                        recordId: selected.id,
                        sourceNumber: form.number,
                        sourceDate: form.date,
                        amountCents: cents.toNumber(),
                        counterpartName: form.counterpart
                      })
                    )
                    if (mounted.current) setMessage('结构化复核已保存，尚未入账')
                  })
                }
              >
                保存摘录并检查重复
              </button>
              <button
                className={button}
                disabled={locked || !parsed}
                onClick={() =>
                  void run(async () => {
                    const result = await window.api.eVoucher.convert({ recordId: selected.id })
                    check(result)
                    if (!mounted.current || !result.draftVoucher) return
                    const fingerprint = result.draftVoucher.sourceFingerprint
                    const tabId = `evoucher-entry-${ledgerId}-${selected.id}-${encodeURIComponent(fingerprint)}`
                    const ui = useUIStore.getState()
                    const existing = ui.tabs.find(
                      (tab) =>
                        tab.id === tabId ||
                        ((
                          tab.params?.initialElectronicDraft as
                            | {
                                sourceRecordId?: number
                                ledgerId?: number
                                sourceFingerprint?: string
                              }
                            | undefined
                        )?.sourceRecordId === selected.id &&
                          (tab.params?.initialElectronicDraft as { ledgerId?: number } | undefined)
                            ?.ledgerId === ledgerId &&
                          (
                            tab.params?.initialElectronicDraft as
                              | { sourceFingerprint?: string }
                              | undefined
                          )?.sourceFingerprint === fingerprint)
                    )
                    if (existing) ui.setActiveTab(existing.id)
                    else
                      ui.openTab({
                        id: tabId,
                        title: `电子凭证 #${selected.id} 预填`,
                        componentType: 'VoucherEntry',
                        params: { initialElectronicDraft: result.draftVoucher }
                      })
                  })
                }
              >
                打开凭证预填（待复核保存）
              </button>
              <div className="flex gap-2">
                <input
                  aria-label="已记账凭证ID"
                  className={input}
                  placeholder="同账套已记账凭证 ID"
                  disabled={locked}
                  value={voucherId}
                  onChange={(event) => setVoucherId(event.target.value)}
                />
                <button
                  className={button}
                  disabled={locked || !parsed || !/^\d+$/.test(voucherId)}
                  onClick={() =>
                    void run(async () => {
                      check(
                        await window.api.eVoucher.link({
                          recordId: selected.id,
                          voucherId: Number(voucherId),
                          sourceFingerprint: selected.fingerprint
                        })
                      )
                      if (mounted.current) setMessage('已补充来源关联，未修改已记账凭证内容')
                    })
                  }
                >
                  关联已记账凭证
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

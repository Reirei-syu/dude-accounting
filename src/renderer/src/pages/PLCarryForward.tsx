import { useCallback, useEffect, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

type CarryForwardRule = {
  id: number
  fromSubjectCode: string
  fromSubjectName: string
  toSubjectCode: string
  toSubjectName: string
}

export default function PLCarryForward(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const [rules, setRules] = useState<CarryForwardRule[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadRules = useCallback(async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setRules([])
      return
    }

    setLoading(true)
    setMessage(null)
    try {
      const nextRules = await window.api.plCarryForward.listRules(currentLedger.id)
      setRules(nextRules)
    } catch (error) {
      setRules([])
      setMessage(error instanceof Error ? error.message : '加载损益结转规则失败')
    } finally {
      setLoading(false)
    }
  }, [currentLedger])

  useEffect(() => {
    void loadRules()
  }, [loadRules])

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            期末损益结转设置
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            当前版本为只读预览。企业账套默认结转至本年利润，民非账套按规则结转至对应净资产科目。
          </p>
        </div>
        <button className="glass-btn-secondary" onClick={() => void loadRules()} disabled={loading}>
          {loading ? '刷新中...' : '刷新规则'}
        </button>
      </div>

      {!currentLedger && (
        <div
          className="glass-panel-light px-4 py-6 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          请先选择账套后查看损益结转规则。
        </div>
      )}

      {message && (
        <div className="text-sm px-1" style={{ color: 'var(--color-danger)' }}>
          {message}
        </div>
      )}

      {currentLedger && (
        <>
          <div className="glass-panel-light px-4 py-3 text-sm space-y-1">
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>当前账套：</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {currentLedger.name}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>账套类型：</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {currentLedger.standard_type === 'npo' ? '民非' : '企业'}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--color-text-muted)' }}>规则数量：</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {rules.length}
              </span>
            </div>
          </div>

          <div className="glass-panel flex-1 overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 border-b text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-muted)'
              }}
            >
              执行损益结转时，系统默认按下列映射归集当前会计期间已记账损益类科目发生额；在结转页面勾选“未记账凭证”后，可扩大到全部状态凭证。
            </div>

            <div className="flex-1 overflow-auto p-2">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr
                    className="border-b"
                    style={{
                      borderColor: 'var(--color-glass-border-light)',
                      color: 'var(--color-text-primary)'
                    }}
                  >
                    <th className="py-2 px-3 font-semibold">损益科目</th>
                    <th className="py-2 px-3 font-semibold">结转目标科目</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="border-b last:border-0 hover:bg-white/10 transition-colors"
                      style={{
                        borderColor: 'var(--color-glass-border-light)',
                        color: 'var(--color-text-primary)'
                      }}
                    >
                      <td className="py-2 px-3">
                        {rule.fromSubjectCode} {rule.fromSubjectName}
                      </td>
                      <td className="py-2 px-3">
                        {rule.toSubjectCode} {rule.toSubjectName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!loading && rules.length === 0 && (
                <div
                  className="py-12 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前账套暂无损益结转规则。
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

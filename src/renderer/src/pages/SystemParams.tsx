import { useEffect, useState, type JSX } from 'react'

type VoucherDateStrategy = 'last_voucher_date' | 'period_start'
type VoucherListStatus = 'all' | 'pending' | 'audited' | 'posted'

export default function SystemParams(): JSX.Element {
  const [allowSameMakerAuditor, setAllowSameMakerAuditor] = useState(false)
  const [defaultVoucherWord, setDefaultVoucherWord] = useState('记')
  const [voucherDateStrategy, setVoucherDateStrategy] =
    useState<VoucherDateStrategy>('last_voucher_date')
  const [voucherListDefaultStatus, setVoucherListDefaultStatus] =
    useState<VoucherListStatus>('all')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (!window.electron) return

    window.api.settings
      .getAll()
      .then((settings) => {
        setAllowSameMakerAuditor(settings.allow_same_maker_auditor === '1')
        setDefaultVoucherWord(settings.default_voucher_word || '记')
        setVoucherDateStrategy(
          settings.new_voucher_date_strategy === 'period_start'
            ? 'period_start'
            : 'last_voucher_date'
        )
        setVoucherListDefaultStatus(
          settings.voucher_list_default_status === 'pending' ||
            settings.voucher_list_default_status === 'audited' ||
            settings.voucher_list_default_status === 'posted'
            ? settings.voucher_list_default_status
            : 'all'
        )
      })
      .catch((error) => {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '加载系统参数失败'
        })
      })
  }, [])

  const handleSave = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持保存系统参数' })
      return
    }

    setSaving(true)
    try {
      await Promise.all([
        window.api.settings.set(
          'allow_same_maker_auditor',
          allowSameMakerAuditor ? '1' : '0'
        ),
        window.api.settings.set('default_voucher_word', defaultVoucherWord.trim() || '记'),
        window.api.settings.set('new_voucher_date_strategy', voucherDateStrategy),
        window.api.settings.set('voucher_list_default_status', voucherListDefaultStatus)
      ])
      setMessage({ type: 'success', text: '系统参数已更新' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存失败'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        系统参数设置
      </h2>

      <div className="glass-panel-light p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              允许制单人与审核人为同一人
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              仅影响系统自动生成的期末损益结转凭证。
            </div>
          </div>
          <label className="flex items-center gap-2" htmlFor="allow-same-maker-auditor">
            <input
              id="allow-same-maker-auditor"
              type="checkbox"
              checked={allowSameMakerAuditor}
              onChange={(event) => setAllowSameMakerAuditor(event.target.checked)}
            />
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {allowSameMakerAuditor ? '已开启' : '已关闭'}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              默认凭证字
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              新建凭证时默认使用的凭证字。
            </div>
            <select
              className="glass-input"
              value={defaultVoucherWord}
              onChange={(event) => setDefaultVoucherWord(event.target.value)}
            >
              <option value="记">记</option>
              <option value="转">转</option>
              <option value="收">收</option>
              <option value="付">付</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              新建凭证日期策略
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              控制新建凭证时日期默认取值。
            </div>
            <select
              className="glass-input"
              value={voucherDateStrategy}
              onChange={(event) =>
                setVoucherDateStrategy(event.target.value as VoucherDateStrategy)
              }
            >
              <option value="last_voucher_date">继承当前期间上一张凭证日期</option>
              <option value="period_start">固定取当前期间首日</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              凭证管理默认状态页
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              打开凭证管理时默认定位到的状态标签。
            </div>
            <select
              className="glass-input"
              value={voucherListDefaultStatus}
              onChange={(event) =>
                setVoucherListDefaultStatus(event.target.value as VoucherListStatus)
              }
            >
              <option value="all">全部</option>
              <option value="pending">未审核</option>
              <option value="audited">已审核</option>
              <option value="posted">已记账</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <button
          className="glass-btn-secondary px-6 py-2"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {message && (
        <div
          className="text-sm px-1"
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

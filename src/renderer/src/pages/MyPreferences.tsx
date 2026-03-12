import { useEffect, useState, type JSX } from 'react'

import { useLedgerStore } from '../stores/ledgerStore'
import { HOME_TAB_PRESETS } from '../stores/uiStore'

export default function MyPreferences(): JSX.Element {
  const ledgers = useLedgerStore((state) => state.ledgers)
  const [defaultLedgerId, setDefaultLedgerId] = useState('')
  const [defaultHomeTab, setDefaultHomeTab] = useState('voucher-entry')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (!window.electron) return

    window.api.settings
      .getUserPreferences()
      .then((preferences) => {
        setDefaultLedgerId(preferences.default_ledger_id ?? '')
        setDefaultHomeTab(preferences.default_home_tab ?? 'voucher-entry')
      })
      .catch((error) => {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '加载个人偏好失败'
        })
      })
  }, [])

  const handleSave = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持保存个人偏好' })
      return
    }

    setSaving(true)
    try {
      await window.api.settings.setUserPreferences({
        default_ledger_id: defaultLedgerId,
        default_home_tab: defaultHomeTab
      })
      setMessage({ type: 'success', text: '个人偏好已更新' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存个人偏好失败'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        我的偏好
      </h2>

      <div className="glass-panel-light p-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
            默认账套
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            登录后优先进入该账套；若账套未授权或已失效，将自动回退到首个可访问账套。
          </div>
          <select
            className="glass-input"
            value={defaultLedgerId}
            onChange={(event) => setDefaultLedgerId(event.target.value)}
          >
            <option value="">跟随首个可访问账套</option>
            {ledgers.map((ledger) => (
              <option key={ledger.id} value={String(ledger.id)}>
                {ledger.name}（{ledger.standard_type === 'npo' ? '民非' : '企业'}）
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
            默认首页
          </div>
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            登录成功后，如果当前没有打开中的工作标签，则自动打开这里配置的首页。
          </div>
          <select
            className="glass-input"
            value={defaultHomeTab}
            onChange={(event) => setDefaultHomeTab(event.target.value)}
          >
            {HOME_TAB_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.title}
              </option>
            ))}
          </select>
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

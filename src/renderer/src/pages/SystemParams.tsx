import { useEffect, useState, type JSX } from 'react'

export default function SystemParams(): JSX.Element {
  const [allowSameMakerAuditor, setAllowSameMakerAuditor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (!window.electron) return
    window.api.settings
      .get('allow_same_maker_auditor')
      .then((value) => {
        setAllowSameMakerAuditor(value === '1')
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
      await window.api.settings.set('allow_same_maker_auditor', allowSameMakerAuditor ? '1' : '0')
      setMessage({ type: 'success', text: '系统参数已更新' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '保存失败'
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

      <div className="glass-panel-light p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
            允许制单人与审核人为同一人
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            仅影响系统自动生成的期末损益结转凭证
          </div>
        </div>
        <label className="flex items-center gap-2" htmlFor="allow-same-maker-auditor">
          <input
            id="allow-same-maker-auditor"
            type="checkbox"
            checked={allowSameMakerAuditor}
            onChange={(e) => setAllowSameMakerAuditor(e.target.checked)}
          />
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {allowSameMakerAuditor ? '已开启' : '已关闭'}
          </span>
        </label>
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

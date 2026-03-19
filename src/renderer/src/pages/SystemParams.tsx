import { useEffect, useState, type JSX } from 'react'

type VoucherDateStrategy = 'last_voucher_date' | 'period_start'
type VoucherListStatus = 'all' | 'pending' | 'audited' | 'posted'
type ErrorLogStatus = {
  logDirectory: string
  runtimeLogPath: string
  errorLogPath: string
  runtimeLogExists: boolean
  errorLogExists: boolean
}

export default function SystemParams(): JSX.Element {
  const [allowSameMakerAuditor, setAllowSameMakerAuditor] = useState(false)
  const [defaultVoucherWord, setDefaultVoucherWord] = useState('记')
  const [voucherDateStrategy, setVoucherDateStrategy] =
    useState<VoucherDateStrategy>('last_voucher_date')
  const [voucherListDefaultStatus, setVoucherListDefaultStatus] =
    useState<VoucherListStatus>('all')
  const [saving, setSaving] = useState(false)
  const [openingLogDir, setOpeningLogDir] = useState(false)
  const [exportingLogs, setExportingLogs] = useState(false)
  const [errorLogStatus, setErrorLogStatus] = useState<ErrorLogStatus | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (!window.electron) return

    Promise.all([window.api.settings.getAll(), window.api.settings.getErrorLogStatus()])
      .then(([settings, nextErrorLogStatus]) => {
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
        setErrorLogStatus(nextErrorLogStatus)
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

  const handleOpenErrorLogDirectory = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持打开错误日志目录' })
      return
    }

    setOpeningLogDir(true)
    try {
      const result = await window.api.settings.openErrorLogDirectory()
      if (!result.success) {
        setMessage({
          type: 'error',
          text: result.error || '打开错误日志目录失败'
        })
        return
      }

      setMessage({ type: 'success', text: '错误日志目录已打开' })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '打开错误日志目录失败'
      })
    } finally {
      setOpeningLogDir(false)
    }
  }

  const handleExportDiagnosticsLogs = async (): Promise<void> => {
    setMessage(null)
    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持导出日志文件' })
      return
    }

    setExportingLogs(true)
    try {
      const result = await window.api.settings.exportDiagnosticsLogs()
      if (result.cancelled) {
        return
      }
      if (!result.success || !result.exportDirectory) {
        setMessage({
          type: 'error',
          text: result.error || '导出日志文件失败'
        })
        return
      }

      setMessage({
        type: 'success',
        text: `日志文件已导出到：${result.exportDirectory}`
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出日志文件失败'
      })
    } finally {
      setExportingLogs(false)
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

      <div className="glass-panel-light p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-base" style={{ color: 'var(--color-text-primary)' }}>
              错误日志
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              系统会自动记录主进程未捕获异常、Promise 未处理拒绝、渲染进程脚本错误和进程异常退出，便于后续排查突然出现的 BUG。
            </div>
          </div>
          <button
            className="glass-btn-secondary px-4 py-2"
            type="button"
            onClick={() => void handleExportDiagnosticsLogs()}
            disabled={exportingLogs}
          >
            {exportingLogs ? '导出中...' : '导出日志文件'}
          </button>
          <button
            className="glass-btn-secondary px-4 py-2"
            type="button"
            onClick={() => void handleOpenErrorLogDirectory()}
            disabled={openingLogDir}
          >
            {openingLogDir ? '打开中...' : '打开日志目录'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            <div style={{ color: 'var(--color-text-secondary)' }}>日志目录</div>
            <div className="mt-1 font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>
              {errorLogStatus?.logDirectory ?? '加载中...'}
            </div>
          </div>

          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            <div style={{ color: 'var(--color-text-secondary)' }}>今日日志</div>
            <div className="mt-1 font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>
              {errorLogStatus?.runtimeLogPath ?? '加载中...'}
            </div>
            <div className="mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {errorLogStatus
                ? errorLogStatus.runtimeLogExists
                  ? '今日已生成运行日志'
                  : '今日尚未生成运行日志'
                : '正在读取状态'}
            </div>
          </div>

          <div
            className="rounded-xl border px-3 py-3"
            style={{ borderColor: 'var(--color-glass-border-light)' }}
          >
            <div style={{ color: 'var(--color-text-secondary)' }}>今日错误日志</div>
            <div className="mt-1 font-mono break-all" style={{ color: 'var(--color-text-primary)' }}>
              {errorLogStatus?.errorLogPath ?? '加载中...'}
            </div>
            <div className="mt-1" style={{ color: 'var(--color-text-muted)' }}>
              {errorLogStatus
                ? errorLogStatus.errorLogExists
                  ? '今日已记录错误日志'
                  : '今日尚未记录错误日志'
                : '正在读取状态'}
            </div>
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

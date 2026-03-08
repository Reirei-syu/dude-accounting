import { useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'

interface BackupRow {
  id: number
  ledger_id: number
  fiscal_year: string | null
  backup_path: string
  checksum: string
  file_size: number
  status: 'generated' | 'validated' | 'failed'
  created_at: string
  validated_at: string | null
}

interface ArchiveRow {
  id: number
  ledger_id: number
  fiscal_year: string
  export_path: string
  manifest_path: string
  checksum: string | null
  status: 'generated' | 'validated' | 'failed'
  item_count: number
  created_at: string
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function Backup(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const [fiscalYear, setFiscalYear] = useState(currentPeriod?.slice(0, 4) ?? '')
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [archives, setArchives] = useState<ArchiveRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    setFiscalYear(currentPeriod?.slice(0, 4) ?? '')
  }, [currentPeriod])

  const canOperate = Boolean(window.electron && currentLedger)
  const yearValue = useMemo(() => fiscalYear.trim(), [fiscalYear])

  const loadData = async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setBackups([])
      setArchives([])
      return
    }

    setLoading(true)
    try {
      const [backupRows, archiveRows] = await Promise.all([
        window.api.backup.list(currentLedger.id),
        window.api.archive.list(currentLedger.id)
      ])

      setBackups(backupRows as BackupRow[])
      setArchives(archiveRows as ArchiveRow[])
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载备份与归档信息失败'
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [currentLedger?.id])

  const createBackup = async (): Promise<void> => {
    if (!currentLedger || !canOperate) return
    setMessage(null)
    const result = await window.api.backup.create({
      ledgerId: currentLedger.id,
      fiscalYear: yearValue || null
    })

    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '创建备份失败' })
      return
    }

    setMessage({ type: 'success', text: '系统备份已创建' })
    await loadData()
  }

  const validateBackup = async (backupId: number): Promise<void> => {
    setMessage(null)
    const result = await window.api.backup.validate(backupId)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '备份校验失败' })
      return
    }

    setMessage({ type: 'success', text: '备份校验通过' })
    await loadData()
  }

  const restoreBackup = async (backupId: number): Promise<void> => {
    if (!window.confirm('恢复备份会替换当前数据库并触发应用重启，是否继续？')) {
      return
    }

    const result = await window.api.backup.restore(backupId)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '恢复备份失败' })
      return
    }

    setMessage({ type: 'success', text: '备份恢复已启动，应用将重启。' })
  }

  const createArchive = async (): Promise<void> => {
    if (!currentLedger || !canOperate) return
    if (!/^\d{4}$/.test(yearValue)) {
      setMessage({ type: 'error', text: '请输入 4 位归档年度' })
      return
    }

    setMessage(null)
    const result = await window.api.archive.export({
      ledgerId: currentLedger.id,
      fiscalYear: yearValue
    })

    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '创建电子档案导出失败' })
      return
    }

    setMessage({ type: 'success', text: '电子档案导出已生成' })
    await loadData()
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            合规备份与归档
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            系统备份文件与电子档案导出文件分别管理，删除账套前必须先完成已校验备份与归档。
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="glass-input px-3 py-2 text-sm"
            value={fiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
            placeholder="归档年度，例如 2026"
          />
          <button className="glass-btn-secondary" onClick={() => void createBackup()} disabled={!canOperate}>
            创建备份
          </button>
          <button className="glass-btn-secondary" onClick={() => void createArchive()} disabled={!canOperate}>
            创建归档
          </button>
          <button className="glass-btn-secondary" onClick={() => void loadData()} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-panel-light p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              系统备份
            </h3>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {backups.length} 条记录
            </span>
          </div>

          <div className="space-y-2 max-h-[56vh] overflow-auto">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="rounded-xl border p-3"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      #{backup.id} {backup.fiscal_year ?? '未分年度'}
                    </div>
                    <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      {backup.created_at} · {formatFileSize(backup.file_size)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="glass-btn-secondary text-sm"
                      onClick={() => void validateBackup(backup.id)}
                    >
                      校验
                    </button>
                    <button
                      className="glass-btn-secondary text-sm"
                      onClick={() => void restoreBackup(backup.id)}
                    >
                      恢复
                    </button>
                  </div>
                </div>
                <div className="text-xs mt-2 break-all" style={{ color: 'var(--color-text-secondary)' }}>
                  {backup.backup_path}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  状态：{backup.status} {backup.validated_at ? `· 校验时间 ${backup.validated_at}` : ''}
                </div>
              </div>
            ))}

            {backups.length === 0 && (
              <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                当前账套暂无备份记录
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel-light p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              电子档案导出
            </h3>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {archives.length} 条记录
            </span>
          </div>

          <div className="space-y-2 max-h-[56vh] overflow-auto">
            {archives.map((archive) => (
              <div
                key={archive.id}
                className="rounded-xl border p-3"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  #{archive.id} {archive.fiscal_year}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {archive.created_at} · 项目数 {archive.item_count}
                </div>
                <div className="text-xs mt-2 break-all" style={{ color: 'var(--color-text-secondary)' }}>
                  {archive.export_path}
                </div>
                <div className="text-xs mt-1 break-all" style={{ color: 'var(--color-text-secondary)' }}>
                  Manifest: {archive.manifest_path}
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  状态：{archive.status}
                </div>
              </div>
            ))}

            {archives.length === 0 && (
              <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                当前账套暂无电子档案导出记录
              </div>
            )}
          </div>
        </section>
      </div>

      {message && (
        <div
          className="text-sm px-1"
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

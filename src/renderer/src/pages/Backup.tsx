import { useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import {
  formatArchiveCardTitle,
  formatBackupCardTitle,
  getLatestRecordIdsByGroup,
  getVisibleRecordItems,
  shouldShowExpandButton
} from './backupCardLayout'
import { getArchivePackageName, getBackupPackageName } from './backupRecordDisplay'
import {
  getArchiveYearOptions,
  getBackupPeriodOptions,
  pickDefaultArchiveYear,
  pickDefaultBackupPeriod,
  type SelectablePeriod
} from './backupSelection'

interface BackupRow {
  id: number
  ledger_id: number
  backup_period: string | null
  fiscal_year: string | null
  backup_path: string
  manifest_path: string | null
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
  validated_at: string | null
}

interface DetailModalState {
  title: string
  rows: Array<{
    label: string
    value: string
  }>
}

interface RecordBrowserState {
  type: 'backup' | 'archive'
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const actionButtonClass =
  'glass-btn-secondary min-w-0 whitespace-nowrap px-3 py-1 text-xs leading-none disabled:cursor-not-allowed disabled:opacity-45'

const confirmRecordedRestore = (): boolean =>
  window.confirm(
    '整库恢复会用所选系统备份包完整覆盖当前系统数据，当前所有账套都会回到该备份创建时的状态，包括刚新建的账套。该操作不是导入单个账套。恢复完成后应用会自动重启。是否继续？'
  )

const confirmPathRestore = (): boolean =>
  window.confirm(
    '从路径整库恢复会在你选择备份包后，完整覆盖当前系统数据，当前所有账套都会回到该备份创建时的状态，包括刚新建的账套。该操作不是导入单个账套。恢复完成后应用会自动重启。是否继续？'
  )

export default function Backup(): JSX.Element {
  const { currentLedger, currentPeriod } = useLedgerStore()
  const [backupPeriod, setBackupPeriod] = useState('')
  const [archiveYear, setArchiveYear] = useState('')
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [archives, setArchives] = useState<ArchiveRow[]>([])
  const [periods, setPeriods] = useState<SelectablePeriod[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null)
  const [recordBrowser, setRecordBrowser] = useState<RecordBrowserState | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)
  const backupPeriodOptions = useMemo(() => getBackupPeriodOptions(periods), [periods])
  const archiveYearOptions = useMemo(() => getArchiveYearOptions(periods), [periods])
  const latestBackupIds = useMemo(
    () => getLatestRecordIdsByGroup(backups, () => 'all'),
    [backups]
  )
  const latestArchiveIds = useMemo(
    () => getLatestRecordIdsByGroup(archives, () => 'all'),
    [archives]
  )
  const visibleBackups = useMemo(() => getVisibleRecordItems(backups, false), [backups])
  const visibleArchives = useMemo(() => getVisibleRecordItems(archives, false), [archives])

  useEffect(() => {
    if (!backupPeriodOptions.includes(backupPeriod)) {
      setBackupPeriod(pickDefaultBackupPeriod(periods))
    }
  }, [backupPeriod, backupPeriodOptions, periods])

  useEffect(() => {
    if (!archiveYearOptions.includes(archiveYear)) {
      setArchiveYear(pickDefaultArchiveYear(periods))
    }
  }, [archiveYear, archiveYearOptions, periods])

  useEffect(() => {
    if (currentPeriod && backupPeriodOptions.includes(currentPeriod)) {
      setBackupPeriod(currentPeriod)
    }
  }, [currentPeriod, backupPeriodOptions])

  const loadData = async (): Promise<void> => {
    if (!currentLedger || !window.electron) {
      setBackups([])
      setArchives([])
      setPeriods([])
      return
    }

    setLoading(true)
    try {
      const [backupRows, archiveRows, ledgerPeriods] = await Promise.all([
        window.api.backup.list(currentLedger.id),
        window.api.archive.list(currentLedger.id),
        window.api.ledger.getPeriods(currentLedger.id)
      ])

      setBackups(backupRows as BackupRow[])
      setArchives(archiveRows as ArchiveRow[])
      setPeriods(
        (ledgerPeriods as Array<{ period: string; is_closed: number }>).map((item) => ({
          period: item.period,
          is_closed: item.is_closed
        }))
      )
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

  useEffect(() => {
    setRecordBrowser(null)
    setDetailModal(null)
  }, [currentLedger?.id])

  const createBackup = async (): Promise<void> => {
    if (!currentLedger || !canOperate) return
    if (!backupPeriod) {
      setMessage({ type: 'error', text: '当前没有已结账会计期间可用于备份。' })
      return
    }

    setMessage(null)
    const result = await window.api.backup.create({
      ledgerId: currentLedger.id,
      period: backupPeriod
    })

    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '创建备份失败' })
      return
    }

    setMessage({
      type: 'success',
      text: result.directoryPath
        ? `系统备份包已创建到：${result.directoryPath}`
        : '系统备份包已创建。'
    })
    await loadData()
  }

  const validateBackup = async (backupId: number): Promise<void> => {
    setMessage(null)
    const result = await window.api.backup.validate(backupId)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '备份校验失败' })
      return
    }

    setMessage({ type: 'success', text: '备份包校验通过。' })
    await loadData()
  }

  const deleteBackup = async (backup: BackupRow): Promise<void> => {
    if (!window.confirm(`确认删除备份“${getBackupPackageName(backup.backup_path)}”吗？仅旧版本允许删除。`)) {
      return
    }

    setMessage(null)
    let result = await window.api.backup.delete({ backupId: backup.id })
    if (!result.success && result.requiresRecordDeletionConfirmation) {
      const packageLabel = result.packagePath || getBackupPackageName(backup.backup_path)
      if (!window.confirm(`路径下备份包已不存在：${packageLabel}\n是否删除本条记录？`)) {
        return
      }

      result = await window.api.backup.delete({
        backupId: backup.id,
        deleteRecordOnly: true
      })
    }

    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '删除备份失败' })
      return
    }

    setMessage({
      type: 'success',
      text: result.deletedPhysicalPackage ? '旧版本备份及其实体包已删除。' : '路径下备份包已不存在，空壳记录已删除。'
    })
    await loadData()
  }

  const restoreBackup = async (backupId: number): Promise<void> => {
    if (!confirmRecordedRestore()) return

    setMessage(null)
    const result = await window.api.backup.restore({ backupId })
    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '整库恢复失败' })
      return
    }

    setMessage({ type: 'success', text: '整库恢复已启动，应用即将重启。' })
  }

  const restoreBackupFromPath = async (): Promise<void> => {
    if (!confirmPathRestore()) return

    setMessage(null)
    const result = await window.api.backup.restore()
    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '从自选路径整库恢复失败' })
      return
    }

    setMessage({ type: 'success', text: '已从自选路径启动整库恢复，应用即将重启。' })
  }

  const createArchive = async (): Promise<void> => {
    if (!currentLedger || !canOperate) return
    if (!archiveYear) {
      setMessage({ type: 'error', text: '当前没有可归档的已结账年度。' })
      return
    }

    setMessage(null)
    const result = await window.api.archive.export({
      ledgerId: currentLedger.id,
      fiscalYear: archiveYear
    })

    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '创建电子档案导出失败' })
      return
    }

    setMessage({
      type: 'success',
      text: result.directoryPath
        ? `电子档案已导出到：${result.directoryPath}`
        : '电子档案导出已生成。'
    })
    await loadData()
  }

  const validateArchive = async (exportId: number): Promise<void> => {
    setMessage(null)
    const result = await window.api.archive.validate(exportId)
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '电子档案校验失败' })
      return
    }

    setMessage({ type: 'success', text: '电子档案导出包校验通过。' })
    await loadData()
  }

  const deleteArchive = async (archive: ArchiveRow): Promise<void> => {
    if (!window.confirm(`确认删除归档“${getArchivePackageName(archive.export_path)}”吗？仅旧版本允许删除。`)) {
      return
    }

    setMessage(null)
    let result = await window.api.archive.delete({ exportId: archive.id })
    if (!result.success && result.requiresRecordDeletionConfirmation) {
      const packageLabel = result.packagePath || getArchivePackageName(archive.export_path)
      if (!window.confirm(`路径下档案包已不存在：${packageLabel}\n是否删除本条记录？`)) {
        return
      }

      result = await window.api.archive.delete({
        exportId: archive.id,
        deleteRecordOnly: true
      })
    }

    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '删除电子档案失败' })
      return
    }

    setMessage({
      type: 'success',
      text: result.deletedPhysicalPackage ? '旧版本电子档案及其实体包已删除。' : '路径下档案包已不存在，空壳记录已删除。'
    })
    await loadData()
  }

  const openBackupDetail = (backup: BackupRow): void => {
    setDetailModal({
      title: getBackupPackageName(backup.backup_path),
      rows: [
        { label: '包件名称', value: getBackupPackageName(backup.backup_path) },
        { label: '创建时间', value: backup.created_at },
        { label: '备份期间', value: backup.backup_period ?? '未指定' },
        { label: '归属年度', value: backup.fiscal_year ?? '未指定' },
        { label: '状态', value: backup.status },
        { label: '校验时间', value: backup.validated_at ?? '未校验' },
        { label: '文件大小', value: formatFileSize(backup.file_size) },
        { label: '校验值', value: backup.checksum },
        { label: '备份文件', value: backup.backup_path },
        { label: 'Manifest', value: backup.manifest_path ?? '无' }
      ]
    })
  }

  const openArchiveDetail = (archive: ArchiveRow): void => {
    setDetailModal({
      title: getArchivePackageName(archive.export_path),
      rows: [
        { label: '包件名称', value: getArchivePackageName(archive.export_path) },
        { label: '创建时间', value: archive.created_at },
        { label: '归档年度', value: archive.fiscal_year },
        { label: '状态', value: archive.status },
        { label: '校验时间', value: archive.validated_at ?? '未校验' },
        { label: '项目数量', value: String(archive.item_count) },
        { label: '校验值', value: archive.checksum ?? '无' },
        { label: '导出目录', value: archive.export_path },
        { label: 'Manifest', value: archive.manifest_path }
      ]
    })
  }

  const renderBackupCard = (backup: BackupRow): JSX.Element => {
    const canDelete = !latestBackupIds.has(backup.id)
    return (
      <div
        key={backup.id}
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-glass-border-light)' }}
      >
        <div
          className="text-base font-medium text-center"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {formatBackupCardTitle(backup.backup_period)}
        </div>
        <div
          className="mt-2 text-sm text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {backup.created_at}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button className={actionButtonClass} onClick={() => openBackupDetail(backup)}>
            详细信息
          </button>
          <button className={actionButtonClass} onClick={() => void validateBackup(backup.id)}>
            校验
          </button>
          <button className={actionButtonClass} onClick={() => void restoreBackup(backup.id)}>
            整库恢复
          </button>
          <button
            className={actionButtonClass}
            onClick={() => void deleteBackup(backup)}
            disabled={!canDelete}
          >
            删除旧版
          </button>
        </div>
      </div>
    )
  }

  const renderArchiveCard = (archive: ArchiveRow): JSX.Element => {
    const canDelete = !latestArchiveIds.has(archive.id)
    return (
      <div
        key={archive.id}
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-glass-border-light)' }}
      >
        <div
          className="text-base font-medium text-center"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {formatArchiveCardTitle(archive.fiscal_year)}
        </div>
        <div
          className="mt-2 text-sm text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {archive.created_at}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button className={actionButtonClass} onClick={() => openArchiveDetail(archive)}>
            详细信息
          </button>
          <button className={actionButtonClass} onClick={() => void validateArchive(archive.id)}>
            校验
          </button>
          <button className={actionButtonClass} disabled>
            整库恢复
          </button>
          <button
            className={actionButtonClass}
            onClick={() => void deleteArchive(archive)}
            disabled={!canDelete}
          >
            删除旧版
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            合规备份与归档
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            系统备份包属于整库快照；“整库恢复”会覆盖当前所有账套，不是单个账套导入。其他字段统一放进“详细信息”弹框。
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            备份期间
            <select
              className="glass-input px-3 py-2 text-sm"
              value={backupPeriod}
              onChange={(event) => setBackupPeriod(event.target.value)}
              disabled={!canOperate || backupPeriodOptions.length === 0}
            >
              {backupPeriodOptions.length === 0 ? (
                <option value="">暂无已结账期间</option>
              ) : (
                backupPeriodOptions.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            归档年度
            <select
              className="glass-input px-3 py-2 text-sm"
              value={archiveYear}
              onChange={(event) => setArchiveYear(event.target.value)}
              disabled={!canOperate || archiveYearOptions.length === 0}
            >
              {archiveYearOptions.length === 0 ? (
                <option value="">暂无可归档年度</option>
              ) : (
                archiveYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))
              )}
            </select>
          </label>

          <button className="glass-btn-secondary" onClick={() => void createBackup()} disabled={!canOperate}>
            创建备份
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void restoreBackupFromPath()}
            disabled={!canOperate}
          >
            从路径整库恢复
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
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                系统备份包（整库快照）
              </h3>
              {shouldShowExpandButton(backups.length) && (
                <button
                  type="button"
                  className="glass-btn-secondary px-3 py-1 text-xs"
                  onClick={() => setRecordBrowser({ type: 'backup' })}
                >
                  查看更多
                </button>
              )}
            </div>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {backups.length} 条记录
            </span>
          </div>
          <p className="mb-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            整库恢复会用选中的备份包覆盖当前全部账套，不支持把备份包导入为单独的新账套。
          </p>

          <div className="space-y-2 max-h-[56vh] overflow-auto">
            {visibleBackups.map(renderBackupCard)}

            {backups.length === 0 && (
              <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                当前账套暂无备份记录
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel-light p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                电子档案导出
              </h3>
              {shouldShowExpandButton(archives.length) && (
                <button
                  type="button"
                  className="glass-btn-secondary px-3 py-1 text-xs"
                  onClick={() => setRecordBrowser({ type: 'archive' })}
                >
                  查看更多
                </button>
              )}
            </div>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {archives.length} 条记录
            </span>
          </div>

          <div className="space-y-2 max-h-[56vh] overflow-auto">
            {visibleArchives.map(renderArchiveCard)}

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

      {recordBrowser && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.28)' }}
        >
          <div className="glass-panel w-full max-w-5xl max-h-[86vh] p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {recordBrowser.type === 'backup' ? '系统备份包全部记录' : '电子档案导出全部记录'}
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {recordBrowser.type === 'backup'
                    ? '在独立交互框中查看并操作全部系统备份包。'
                    : '在独立交互框中查看并操作全部电子档案导出记录。'}
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-3 py-1 text-xs"
                onClick={() => setRecordBrowser(null)}
              >
                关闭
              </button>
            </div>

            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {recordBrowser.type === 'backup' ? `${backups.length} 条记录` : `${archives.length} 条记录`}
            </div>

            <div className="grid gap-3 md:grid-cols-2 overflow-auto pr-1">
              {recordBrowser.type === 'backup'
                ? backups.map(renderBackupCard)
                : archives.map(renderArchiveCard)}
            </div>

            {recordBrowser.type === 'backup' && backups.length === 0 && (
              <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                当前账套暂无备份记录
              </div>
            )}

            {recordBrowser.type === 'archive' && archives.length === 0 && (
              <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
                当前账套暂无电子档案导出记录
              </div>
            )}
          </div>
        </div>
      )}

      {detailModal && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center px-4"
          style={{ background: 'rgba(15, 23, 42, 0.28)' }}
        >
          <div className="glass-panel w-full max-w-2xl p-5 flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {detailModal.title}
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  包件详细信息
                </p>
              </div>
              <button
                type="button"
                className="glass-btn-secondary px-3 py-1 text-xs"
                onClick={() => setDetailModal(null)}
              >
                关闭
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {detailModal.rows.map((row) => (
                <div key={row.label} className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    {row.label}
                  </div>
                  <div className="text-sm break-all" style={{ color: 'var(--color-text-primary)' }}>
                    {row.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={() => setDetailModal(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

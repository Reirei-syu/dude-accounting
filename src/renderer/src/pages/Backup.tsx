import { useEffect, useMemo, useState, type JSX } from 'react'
import { useLedgerStore } from '../stores/ledgerStore'
import {
  formatArchiveCardTitle,
  getLatestRecordIdsByGroup,
  getVisibleRecordItems,
  shouldShowExpandButton
} from './backupCardLayout'
import { getArchivePackageName, getBackupPackageName } from './backupRecordDisplay'
import { buildValidationFeedback } from './backupValidationFeedback'
import {
  getArchiveYearOptions,
  pickDefaultArchiveYear,
  type SelectablePeriod
} from './backupSelection'

interface BackupRow {
  id: number
  ledger_id: number
  backup_period: string | null
  fiscal_year: string | null
  package_type: 'ledger_backup' | 'system_db_snapshot_legacy'
  package_schema_version: string
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

const getBackupPackageModeLabel = (backup: BackupRow): string =>
  backup.package_type === 'ledger_backup'
    ? backup.package_schema_version === '2.1'
      ? '账套当前状态备份'
      : '账套级备份包'
    : '历史整库备份（legacy）'

const getBackupCardTitle = (backup: BackupRow): string =>
  backup.package_type === 'ledger_backup' && !backup.backup_period && !backup.fiscal_year
    ? getBackupPackageName(backup.backup_path)
    : backup.backup_period
      ? `${backup.backup_period.slice(0, 4)}年${backup.backup_period.slice(5, 7)}月`
      : '历史备份'

const confirmRecordedImport = (): boolean =>
  window.confirm(
    '导入后会把所选账套备份写入当前数据库，并创建一个新的账套，不会覆盖现有账套。该备份还会覆盖当前应用的全局设置与用户偏好；若账套名称已存在，系统会自动追加“（导入）”后缀。是否继续？'
  )

const confirmPathImport = (): boolean =>
  window.confirm(
    '从路径导入会读取你选择的账套备份，并在当前数据库中创建一个新的账套，不会覆盖现有账套，同时会覆盖当前应用的全局设置与用户偏好。是否继续？'
  )

export default function Backup(): JSX.Element {
  const { currentLedger, setLedgers, setCurrentLedger } = useLedgerStore()
  const [archiveYear, setArchiveYear] = useState('')
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [archives, setArchives] = useState<ArchiveRow[]>([])
  const [periods, setPeriods] = useState<SelectablePeriod[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null)
  const [recordBrowser, setRecordBrowser] = useState<RecordBrowserState | null>(null)

  const canOperate = Boolean(window.electron && currentLedger)
  const archiveYearOptions = useMemo(() => getArchiveYearOptions(periods), [periods])
  const latestBackupIds = useMemo(() => getLatestRecordIdsByGroup(backups, () => 'all'), [backups])
  const latestArchiveIds = useMemo(
    () => getLatestRecordIdsByGroup(archives, () => 'all'),
    [archives]
  )
  const visibleBackups = useMemo(() => getVisibleRecordItems(backups, false), [backups])
  const visibleArchives = useMemo(() => getVisibleRecordItems(archives, false), [archives])

  useEffect(() => {
    if (!archiveYearOptions.includes(archiveYear)) {
      setArchiveYear(pickDefaultArchiveYear(periods))
    }
  }, [archiveYear, archiveYearOptions, periods])

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

    setMessage(null)
    const result = await window.api.backup.create({
      ledgerId: currentLedger.id
    })

    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '创建账套备份失败' })
      return
    }

    setMessage({
      type: 'success',
      text: result.directoryPath
        ? `账套备份已创建到：${result.directoryPath}`
        : '账套备份已创建。'
    })
    await loadData()
  }

  const validateBackup = async (backupId: number): Promise<void> => {
    setMessage(null)
    const result = await window.api.backup.validate(backupId)
    const feedback = buildValidationFeedback(result, '账套备份校验通过。', '账套备份校验失败')
    setMessage(feedback.message)
    if (feedback.shouldReload) {
      await loadData()
    }
  }

  const deleteBackup = async (backup: BackupRow): Promise<void> => {
    if (
      !window.confirm(
        `确认删除备份“${getBackupPackageName(backup.backup_path)}”吗？仅旧版本允许删除。`
      )
    ) {
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
      text: result.deletedPhysicalPackage
        ? '旧版本备份及其实体包已删除。'
        : '路径下备份包已不存在，空壳记录已删除。'
    })
    await loadData()
  }

  const importBackup = async (backup: BackupRow): Promise<void> => {
    if (backup.package_type !== 'ledger_backup') {
      setMessage({ type: 'error', text: '历史整库备份不再支持导入为新账套。' })
      return
    }
    if (!confirmRecordedImport()) return

    setMessage(null)
    const result = await window.api.backup.import({ backupId: backup.id })
    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '导入账套备份失败' })
      return
    }

    setMessage({
      type: 'success',
      text: `账套备份已导入：${result.importedLedgerName || '新账套'}`
    })
    const finalLedgers = await window.api.ledger.getAll()
    setLedgers(finalLedgers)
    const importedLedger = finalLedgers.find((ledger) => ledger.id === result.importedLedgerId)
    if (importedLedger) {
      setCurrentLedger(importedLedger)
    }
    await loadData()
  }

  const importBackupFromPath = async (): Promise<void> => {
    if (!confirmPathImport()) return

    setMessage(null)
    const result = await window.api.backup.import()
    if (result.cancelled) return
    if (!result.success) {
      setMessage({ type: 'error', text: result.error || '从路径导入账套备份失败' })
      return
    }

    setMessage({
      type: 'success',
      text: `已从路径导入账套备份：${result.importedLedgerName || '新账套'}`
    })
    const finalLedgers = await window.api.ledger.getAll()
    setLedgers(finalLedgers)
    const importedLedger = finalLedgers.find((ledger) => ledger.id === result.importedLedgerId)
    if (importedLedger) {
      setCurrentLedger(importedLedger)
    }
    await loadData()
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
    const feedback = buildValidationFeedback(result, '电子档案导出包校验通过。', '电子档案校验失败')
    setMessage(feedback.message)
    if (feedback.shouldReload) {
      await loadData()
    }
  }

  const deleteArchive = async (archive: ArchiveRow): Promise<void> => {
    if (
      !window.confirm(
        `确认删除归档“${getArchivePackageName(archive.export_path)}”吗？仅旧版本允许删除。`
      )
    ) {
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
      text: result.deletedPhysicalPackage
        ? '旧版本电子档案及其实体包已删除。'
        : '路径下档案包已不存在，空壳记录已删除。'
    })
    await loadData()
  }

  const openBackupDetail = (backup: BackupRow): void => {
    setDetailModal({
      title: getBackupPackageName(backup.backup_path),
      rows: [
        { label: '包件名称', value: getBackupPackageName(backup.backup_path) },
        { label: '包件类型', value: getBackupPackageModeLabel(backup) },
        { label: '包格式版本', value: backup.package_schema_version },
        { label: '创建时间', value: backup.created_at },
        { label: '备份范围', value: backup.package_schema_version === '2.1' ? '账套当前状态（含全局设置）' : '账套数据' },
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
    const canImport = backup.package_type === 'ledger_backup'
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
          {getBackupCardTitle(backup)}
        </div>
        <div className="mt-2 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
          {backup.created_at}
        </div>
        <div className="mt-1 text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
          {getBackupPackageModeLabel(backup)}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <button className={actionButtonClass} onClick={() => openBackupDetail(backup)}>
            详细信息
          </button>
          <button className={actionButtonClass} onClick={() => void validateBackup(backup.id)}>
            校验
          </button>
          <button
            className={actionButtonClass}
            onClick={() => void importBackup(backup)}
            disabled={!canImport}
          >
            导入新账套
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
        <div className="mt-2 text-sm text-center" style={{ color: 'var(--color-text-muted)' }}>
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
            不支持恢复
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
            账套备份已升级为“当前状态备份”，创建时直接打包账套现状，包括账套数据、自定义设置和关联设置资产；历史整库备份仅保留校验与删除能力。
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
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

          <button
            className="glass-btn-secondary"
            onClick={() => void createBackup()}
            disabled={!canOperate}
          >
            创建备份
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void importBackupFromPath()}
            disabled={!canOperate}
          >
            从路径导入备份
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void createArchive()}
            disabled={!canOperate}
          >
            创建归档
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void loadData()}
            disabled={loading}
          >
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-panel-light p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3
                className="text-base font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                账套备份包
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
            账套当前状态备份支持导入为新账套，并会覆盖当前应用的全局设置与用户偏好；历史整库备份仅保留校验和删除，不再作为新流程入口。
          </p>

          <div className="space-y-2 max-h-[56vh] overflow-auto">
            {visibleBackups.map(renderBackupCard)}

            {backups.length === 0 && (
              <div
                className="text-sm py-8 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                当前账套暂无备份记录
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel-light p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3
                className="text-base font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
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
              <div
                className="text-sm py-8 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
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
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {recordBrowser.type === 'backup' ? '账套备份包全部记录' : '电子档案导出全部记录'}
                </h3>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {recordBrowser.type === 'backup'
                    ? '在独立交互框中查看并操作全部账套备份包；legacy 历史整库备份不会提供导入入口。'
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
              {recordBrowser.type === 'backup'
                ? `${backups.length} 条记录`
                : `${archives.length} 条记录`}
            </div>

            <div className="grid gap-3 md:grid-cols-2 overflow-auto pr-1">
              {recordBrowser.type === 'backup'
                ? backups.map(renderBackupCard)
                : archives.map(renderArchiveCard)}
            </div>

            {recordBrowser.type === 'backup' && backups.length === 0 && (
              <div
                className="text-sm py-8 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
                当前账套暂无备份记录
              </div>
            )}

            {recordBrowser.type === 'archive' && archives.length === 0 && (
              <div
                className="text-sm py-8 text-center"
                style={{ color: 'var(--color-text-muted)' }}
              >
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
                <h3
                  className="text-lg font-semibold"
                  style={{ color: 'var(--color-text-primary)' }}
                >
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

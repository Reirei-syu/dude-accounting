import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'

export type StandardType = 'enterprise' | 'npo'

export interface CustomSubjectTemplateEntry {
  code: string
  name: string
  category: string
  balanceDirection: 1 | -1
  isCashFlow: boolean
  enabled: boolean
  sortOrder: number
  carryForwardTargetCode: string | null
  note: string | null
}

export interface CustomSubjectTemplate {
  standardType: StandardType
  templateName: string
  templateDescription: string | null
  updatedAt: string | null
  entryCount: number
  entries: CustomSubjectTemplateEntry[]
}

export interface StandardSubjectReference {
  code: string
  name: string
  category: string
  balanceDirection: 1 | -1
  categoryLabel: string
  isCashFlow: boolean
}

interface EditableTemplateRow extends CustomSubjectTemplateEntry {
  localId: string
}

type DraftChangeRecord =
  | { kind: 'create'; code: string; name: string }
  | { kind: 'update'; code: string; name: string; fields: string[] }
  | { kind: 'delete'; code: string; name: string }

interface AccountingStandardSubjectTemplateDialogProps {
  open: boolean
  standardType: StandardType | null
  standardLabel: string
  template: CustomSubjectTemplate | null
  referenceSubjects: StandardSubjectReference[]
  isAdmin: boolean
  busyAction: 'clear' | 'download' | 'import' | 'save' | null
  message: { type: 'error' | 'success'; text: string } | null
  onOpenChange: (open: boolean) => void
  onDownloadTemplate: () => Promise<void>
  onImportTemplate: (entries: CustomSubjectTemplateEntry[]) => Promise<void>
  onClearTemplate: () => Promise<void>
  onSaveTemplate: (entries: CustomSubjectTemplateEntry[]) => Promise<void>
}

const CATEGORY_OPTIONS: Record<StandardType, Array<{ label: string; value: string }>> = {
  enterprise: [
    { label: '资产类', value: 'asset' },
    { label: '负债类', value: 'liability' },
    { label: '共同类', value: 'common' },
    { label: '所有者权益类', value: 'equity' },
    { label: '成本类', value: 'cost' },
    { label: '损益类', value: 'profit_loss' }
  ],
  npo: [
    { label: '资产类', value: 'asset' },
    { label: '负债类', value: 'liability' },
    { label: '净资产类', value: 'net_assets' },
    { label: '收入类', value: 'income' },
    { label: '费用类', value: 'expense' }
  ]
}

const RECOMMENDED_COLUMNS = [
  '新增科目后按科目代码自动排序，不再维护单独排序号。',
  '科目类别使用中文下拉项，导入和保存时自动映射到系统内部分类码。',
  '结转目标使用下拉框选择，企业损益类、民非收入/费用类必须选定。',
  '模板下载、批量导入、手动保存、清空模板仅 admin 可执行。'
]

let rowSequence = 0

function createEditableRow(
  standardType: StandardType,
  entry?: Partial<CustomSubjectTemplateEntry>
): EditableTemplateRow {
  rowSequence += 1
  return {
    localId: `template-row-${rowSequence}`,
    code: entry?.code ?? '',
    name: entry?.name ?? '',
    category: entry?.category ?? CATEGORY_OPTIONS[standardType][0].value,
    balanceDirection: entry?.balanceDirection ?? 1,
    isCashFlow: entry?.isCashFlow ?? false,
    enabled: entry?.enabled ?? true,
    sortOrder: entry?.sortOrder ?? rowSequence,
    carryForwardTargetCode: entry?.carryForwardTargetCode ?? null,
    note: entry?.note ?? null
  }
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '尚未导入'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('zh-CN', { hour12: false })
}

function getBalanceDirectionLabel(direction: number): string {
  return direction === 1 ? '借' : '贷'
}

function requiresCarryForwardTarget(standardType: StandardType, category: string): boolean {
  return standardType === 'npo'
    ? category === 'income' || category === 'expense'
    : category === 'profit_loss'
}

function compareByCode(left: { code: string }, right: { code: string }): number {
  const leftCode = left.code.trim()
  const rightCode = right.code.trim()
  if (!leftCode && !rightCode) return 0
  if (!leftCode) return 1
  if (!rightCode) return -1
  return leftCode.localeCompare(rightCode, 'zh-CN')
}

function getAutoFitWidth(value: string, minCh: number, maxCh: number): CSSProperties {
  const length = value.trim().length
  const widthCh = Math.max(minCh, Math.min(maxCh, length + 2))
  return { width: `${widthCh}ch` }
}

function getSelectAutoFitWidth(
  currentValue: string,
  optionLabels: string[],
  minCh: number,
  maxCh: number
): CSSProperties {
  const widestLabel = optionLabels.reduce((widest, option) => {
    return option.trim().length > widest.trim().length ? option : widest
  }, currentValue)
  const length = widestLabel.trim().length
  const widthCh = Math.max(minCh, Math.min(maxCh, length + 6))
  return {
    minWidth: `${widthCh}ch`,
    width: `${widthCh}ch`
  }
}

function buildReferenceTemplateEntry(
  standardType: StandardType,
  referenceSubject: StandardSubjectReference
): CustomSubjectTemplateEntry {
  return {
    code: referenceSubject.code,
    name: referenceSubject.name,
    category: referenceSubject.category,
    balanceDirection: referenceSubject.balanceDirection,
    isCashFlow: referenceSubject.isCashFlow,
    enabled: true,
    sortOrder: 0,
    carryForwardTargetCode: requiresCarryForwardTarget(standardType, referenceSubject.category)
      ? standardType === 'enterprise'
        ? '4103'
        : '3101'
      : null,
    note: null
  }
}

function buildInitialTemplateRows(
  standardType: StandardType,
  referenceSubjects: StandardSubjectReference[],
  savedEntries: CustomSubjectTemplateEntry[]
): EditableTemplateRow[] {
  const savedEntryByCode = new Map(savedEntries.map((entry) => [entry.code, entry]))
  const referenceRows = referenceSubjects.map((referenceSubject) =>
    createEditableRow(
      standardType,
      savedEntryByCode.get(referenceSubject.code) ??
        buildReferenceTemplateEntry(standardType, referenceSubject)
    )
  )
  const extraRows = savedEntries
    .filter((entry) => !referenceSubjects.some((reference) => reference.code === entry.code))
    .map((entry) => createEditableRow(standardType, entry))

  return [...referenceRows, ...extraRows].sort(compareByCode)
}

export default function AccountingStandardSubjectTemplateDialog(
  props: AccountingStandardSubjectTemplateDialogProps
): JSX.Element {
  const {
    open,
    standardType,
    standardLabel,
    template,
    referenceSubjects,
    isAdmin,
    busyAction,
    message,
    onOpenChange,
    onDownloadTemplate,
    onImportTemplate,
    onClearTemplate,
    onSaveTemplate
  } = props

  const [draftRows, setDraftRows] = useState<EditableTemplateRow[]>([])
  const currentStandardType = standardType ?? 'enterprise'
  const entries = template?.entries ?? []
  const categoryOptions = CATEGORY_OPTIONS[currentStandardType]
  const initialTemplateRows = useMemo(
    () => buildInitialTemplateRows(currentStandardType, referenceSubjects, entries),
    [currentStandardType, entries, referenceSubjects]
  )

  useEffect(() => {
    if (!standardType) return
    setDraftRows(initialTemplateRows)
  }, [currentStandardType, initialTemplateRows, standardType, template?.entryCount, template?.updatedAt])

  const sortedDraftRows = useMemo(
    () => draftRows.slice().sort(compareByCode),
    [draftRows]
  )

  const sortedReferenceSubjects = useMemo(
    () => referenceSubjects.slice().sort(compareByCode),
    [referenceSubjects]
  )
  const persistedCodes = useMemo(
    () => new Set(initialTemplateRows.map((entry) => entry.code.trim())),
    [initialTemplateRows]
  )

  const changeRecords = useMemo<DraftChangeRecord[]>(() => {
    const originalByCode = new Map(
      initialTemplateRows.map((entry) => [entry.code.trim(), entry as CustomSubjectTemplateEntry])
    )
    const draftByCode = new Map(
      sortedDraftRows
        .map((row) => ({ code: row.code.trim(), row }))
        .filter((item) => item.code)
        .map((item) => [item.code, item.row])
    )
    const records: DraftChangeRecord[] = []

    for (const row of sortedDraftRows) {
      const code = row.code.trim()
      if (!code) {
        continue
      }

      const original = originalByCode.get(code)
      if (!original) {
        records.push({
          kind: 'create',
          code,
          name: row.name.trim() || '未命名科目'
        })
        continue
      }

      const changedFields: string[] = []
      if (original.name !== row.name.trim()) changedFields.push('名称')
      if (original.category !== row.category) changedFields.push('类别')
      if (original.balanceDirection !== row.balanceDirection) changedFields.push('方向')
      if (original.isCashFlow !== row.isCashFlow) changedFields.push('现金流量科目')
      if (original.enabled !== row.enabled) changedFields.push('启用')
      if ((original.carryForwardTargetCode ?? '') !== (row.carryForwardTargetCode?.trim() ?? '')) {
        changedFields.push('结转目标')
      }
      if ((original.note ?? '') !== (row.note?.trim() ?? '')) changedFields.push('备注')

      if (changedFields.length > 0) {
        records.push({
          kind: 'update',
          code,
          name: row.name.trim() || original.name,
          fields: changedFields
        })
      }
    }

    for (const original of initialTemplateRows) {
      if (!draftByCode.has(original.code)) {
        records.push({
          kind: 'delete',
          code: original.code,
          name: original.name
        })
      }
    }

    return records.sort((left, right) => left.code.localeCompare(right.code, 'zh-CN'))
  }, [initialTemplateRows, sortedDraftRows])

  const existingTemplateRows = useMemo(
    () => sortedDraftRows.filter((row) => persistedCodes.has(row.code.trim())),
    [persistedCodes, sortedDraftRows]
  )

  const newDraftRows = useMemo(
    () => sortedDraftRows.filter((row) => !persistedCodes.has(row.code.trim())),
    [persistedCodes, sortedDraftRows]
  )

  const carryForwardOptions = useMemo(() => {
    const allowedCategories =
      currentStandardType === 'npo' ? new Set(['net_assets']) : new Set(['equity'])
    const draftTargets = sortedDraftRows
      .filter((row) => allowedCategories.has(row.category))
      .map((row) => ({
        code: row.code.trim(),
        name: row.name.trim(),
        source: 'draft' as const
      }))
      .filter((row) => row.code && row.name)
    const referenceTargets = sortedReferenceSubjects
      .filter((row) => allowedCategories.has(row.category))
      .map((row) => ({
        code: row.code,
        name: row.name,
        source: 'reference' as const
      }))

    const merged = [...referenceTargets, ...draftTargets]
    const seen = new Set<string>()
    return merged.filter((item) => {
      if (seen.has(item.code)) {
        return false
      }
      seen.add(item.code)
      return true
    })
  }, [currentStandardType, sortedDraftRows, sortedReferenceSubjects])

  function updateDraftRow(localId: string, patch: Partial<EditableTemplateRow>): void {
    setDraftRows((current) =>
      current.map((row) => {
        if (row.localId !== localId) return row
        const nextRow = { ...row, ...patch }
        if (!requiresCarryForwardTarget(currentStandardType, nextRow.category)) {
          nextRow.carryForwardTargetCode = null
        }
        return nextRow
      })
    )
  }

  function addDraftRow(): void {
    setDraftRows((current) => [...current, createEditableRow(currentStandardType)])
  }

  function removeDraftRow(localId: string): void {
    setDraftRows((current) => current.filter((row) => row.localId !== localId))
  }

  function buildDraftEntries(): CustomSubjectTemplateEntry[] {
    return sortedDraftRows.map((row, index) => ({
      code: row.code.trim(),
      name: row.name.trim(),
      category: row.category,
      balanceDirection: row.balanceDirection,
      isCashFlow: row.isCashFlow,
      enabled: row.enabled,
      sortOrder: index + 1,
      carryForwardTargetCode: row.carryForwardTargetCode?.trim() || null,
      note: row.note?.trim() || null
    }))
  }

  async function handleSave(): Promise<void> {
    await onSaveTemplate(buildDraftEntries())
  }

  function renderEditableRows(rows: EditableTemplateRow[]): JSX.Element {
    return (
      <table className="w-full text-left border-collapse min-w-[980px]">
        <thead>
          <tr
            className="border-b"
            style={{
              borderColor: 'var(--color-glass-border-light)',
              color: 'var(--color-text-primary)'
            }}
          >
            <th className="py-3 px-3 font-semibold">编码</th>
            <th className="py-3 px-3 font-semibold">名称</th>
            <th className="py-3 px-3 font-semibold">类别</th>
            <th className="py-3 px-3 font-semibold">方向</th>
            <th className="py-3 px-3 font-semibold">现金流量科目</th>
            <th className="py-3 px-3 font-semibold">启用</th>
            <th className="py-3 px-3 font-semibold">结转目标</th>
            <th className="py-3 px-3 font-semibold">备注</th>
            <th className="py-3 px-3 font-semibold text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const needTarget = requiresCarryForwardTarget(currentStandardType, row.category)
            return (
              <tr
                key={row.localId}
                className="border-b align-top last:border-0"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <td className="py-2 px-3">
                  <input
                    className="glass-input"
                    style={getAutoFitWidth(row.code || '0000', 8, 12)}
                    value={row.code}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { code: event.target.value })
                    }
                    placeholder="4位编码"
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    className="glass-input"
                    style={getAutoFitWidth(row.name || '一级科目名称', 14, 24)}
                    value={row.name}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { name: event.target.value })
                    }
                    placeholder="一级科目名称"
                  />
                </td>
                <td className="py-2 px-3">
                  <select
                    className="glass-input"
                    style={getSelectAutoFitWidth(
                      categoryOptions.find((option) => option.value === row.category)?.label ?? '',
                      categoryOptions.map((option) => option.label),
                      12,
                      18
                    )}
                    value={row.category}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { category: event.target.value })
                    }
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select
                    className="glass-input"
                    style={getSelectAutoFitWidth(
                      getBalanceDirectionLabel(row.balanceDirection),
                      ['借', '贷'],
                      10,
                      12
                    )}
                    value={String(row.balanceDirection)}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, {
                        balanceDirection: Number(event.target.value) as 1 | -1
                      })
                    }
                  >
                    <option value="1">借</option>
                    <option value="-1">贷</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select
                    className="glass-input"
                    style={getSelectAutoFitWidth(
                      row.isCashFlow ? '是' : '否',
                      ['是', '否'],
                      12,
                      14
                    )}
                    value={row.isCashFlow ? '1' : '0'}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { isCashFlow: event.target.value === '1' })
                    }
                  >
                    <option value="0">否</option>
                    <option value="1">是</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select
                    className="glass-input"
                    style={getSelectAutoFitWidth(
                      row.enabled ? '是' : '否',
                      ['是', '否'],
                      10,
                      12
                    )}
                    value={row.enabled ? '1' : '0'}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { enabled: event.target.value === '1' })
                    }
                  >
                    <option value="1">是</option>
                    <option value="0">否</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  {(() => {
                    const selectedCarryForwardLabel =
                      carryForwardOptions.find(
                        (option) => option.code === row.carryForwardTargetCode
                      )
                        ? `${row.carryForwardTargetCode} ${
                            carryForwardOptions.find(
                              (option) => option.code === row.carryForwardTargetCode
                            )?.name ?? ''
                          }`
                        : row.carryForwardTargetCode ?? ''
                    const carryForwardOptionLabels = [
                      needTarget ? '请选择结转目标' : '不适用',
                      ...carryForwardOptions.map((option) => `${option.code} ${option.name}`)
                    ]

                    return (
                  <select
                    className="glass-input"
                    style={getSelectAutoFitWidth(
                      selectedCarryForwardLabel,
                      carryForwardOptionLabels,
                      16,
                      44
                    )}
                    value={row.carryForwardTargetCode ?? ''}
                    disabled={!isAdmin || !needTarget}
                    onChange={(event) =>
                      updateDraftRow(row.localId, {
                        carryForwardTargetCode: event.target.value || null
                      })
                    }
                  >
                    <option value="">{needTarget ? '请选择结转目标' : '不适用'}</option>
                    {carryForwardOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.code} {option.name}
                      </option>
                    ))}
                  </select>
                    )
                  })()}
                </td>
                <td className="py-2 px-3">
                  <input
                    className="glass-input"
                    style={getAutoFitWidth(row.note || '备注说明', 12, 28)}
                    value={row.note ?? ''}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      updateDraftRow(row.localId, { note: event.target.value })
                    }
                    placeholder="备注说明"
                  />
                </td>
                <td className="py-2 px-3 text-right">
                  {isAdmin ? (
                    <button
                      type="button"
                      className="text-sm hover:underline"
                      style={{ color: 'var(--color-danger)' }}
                      onClick={() => removeDraftRow(row.localId)}
                    >
                      删除
                    </button>
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      {getBalanceDirectionLabel(row.balanceDirection)}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(1320px,calc(100vw-24px))] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Dialog.Title className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {standardLabel}自定义一级科目模板
              </Dialog.Title>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                模板仅影响新建账套或无业务数据账套的准则重建，不会直接覆盖已有业务账套。
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={() => void onDownloadTemplate()}
              >
                {busyAction === 'download' ? '生成中...' : '模板下载'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={() => void onImportTemplate(buildDraftEntries())}
              >
                {busyAction === 'import' ? '导入中...' : '批量导入'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={addDraftRow}
              >
                新增科目
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={() => void handleSave()}
              >
                {busyAction === 'save' ? '保存中...' : '保存维护'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null || entries.length === 0}
                onClick={() => void onClearTemplate()}
                style={{
                  color:
                    !isAdmin || entries.length === 0
                      ? 'var(--color-text-muted)'
                      : 'var(--color-danger)'
                }}
              >
                {busyAction === 'clear' ? '清空中...' : '清空模板'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                onClick={() => onOpenChange(false)}
              >
                关闭
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 mt-5">
            <section className="glass-panel-light p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-3 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>模板名称：</span>
                    <strong style={{ color: 'var(--color-text-primary)' }}>
                      {template?.templateName ?? '-'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>最近导入：</span>
                    <strong style={{ color: 'var(--color-text-primary)' }}>
                      {formatUpdatedAt(template?.updatedAt ?? null)}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--color-text-muted)' }}>当前条目数：</span>
                    <strong style={{ color: 'var(--color-text-primary)' }}>
                      {template?.entryCount ?? 0}
                    </strong>
                  </div>
                </div>

                <div className="max-w-[560px]">
                  <div className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                    维护要点
                  </div>
                  <ul className="flex flex-col gap-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {RECOMMENDED_COLUMNS.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {!isAdmin && (
                <div
                  className="rounded-xl px-3 py-3 text-sm mt-4"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    color: 'var(--color-danger)'
                  }}
                >
                  模板一级科目维护仅允许 admin 账号执行。
                </div>
              )}
            </section>

            <section className="glass-panel overflow-hidden flex flex-col">
              <div
                className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    手动维护记录
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    这里显示当前待保存的新增、修改、删除记录。
                  </div>
                </div>
              </div>

              <div className="px-4 py-4">
                {changeRecords.length === 0 ? (
                  <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    当前没有待保存的维护记录。
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {changeRecords.map((record) => (
                      <div
                        key={`${record.kind}-${record.code}`}
                        className="rounded-xl px-3 py-3 text-sm"
                        style={{ backgroundColor: 'rgba(15, 23, 42, 0.05)' }}
                      >
                        <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                          {record.code} {record.name}
                        </div>
                        <div className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {record.kind === 'create'
                            ? '新增科目'
                            : record.kind === 'delete'
                              ? '删除科目'
                              : `修改字段：${record.fields.join('、')}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {newDraftRows.length > 0 && (
                  <div className="mt-4">
                    <div
                      className="text-sm font-semibold mb-2"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      待新增科目
                    </div>
                    <div className="overflow-x-auto">{renderEditableRows(newDraftRows)}</div>
                  </div>
                )}
              </div>
            </section>

            <section className="glass-panel overflow-hidden flex flex-col">
              <div
                className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap"
                style={{ borderColor: 'var(--color-glass-border-light)' }}
              >
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    当前模板科目
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    当前模板下已经存在的一级科目会列示在这里，可直接手动进行修改维护。
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-x-auto">
                {existingTemplateRows.length === 0 ? (
                  <div className="py-14 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                    当前模板还没有已保存科目，可先新增科目并保存，或执行批量导入。
                  </div>
                ) : (
                  renderEditableRows(existingTemplateRows)
                )}
              </div>
            </section>
          </div>

          {message && (
            <div
              className="text-sm mt-4 px-1"
              style={{
                color: message.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
              }}
            >
              {message.text}
            </div>
          )}

          <div className="flex justify-end pt-5">
            <button type="button" className="glass-btn-secondary" onClick={() => onOpenChange(false)}>
              关闭
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

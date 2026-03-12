import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import type {
  CustomSubjectTemplate,
  CustomSubjectTemplateEntry,
  StandardSubjectReference,
  StandardType
} from './AccountingStandardSubjectTemplateDialog'

export interface IndependentCustomTemplateSummary extends CustomSubjectTemplate {
  id: string
  baseStandardType: StandardType
}

interface CustomTemplateDialogProps {
  open: boolean
  template: IndependentCustomTemplateSummary | null
  defaultBaseStandardType: StandardType
  referenceSubjects: StandardSubjectReference[]
  isAdmin: boolean
  busyAction: 'clear' | 'delete' | 'download' | 'import' | 'save' | null
  message: { type: 'error' | 'success'; text: string } | null
  onOpenChange: (open: boolean) => void
  onDownloadTemplate: () => Promise<void>
  onImportTemplate: (payload: {
    templateId?: string
    baseStandardType: StandardType
    templateName: string
    templateDescription: string | null
    entries: CustomSubjectTemplateEntry[]
  }) => Promise<void>
  onClearTemplate: () => Promise<void>
  onDeleteTemplate: () => Promise<void>
  onSaveTemplate: (payload: {
    templateId?: string
    baseStandardType: StandardType
    templateName: string
    templateDescription: string | null
    entries: CustomSubjectTemplateEntry[]
  }) => Promise<void>
}

interface EditableRow extends CustomSubjectTemplateEntry {
  localId: string
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

let rowId = 0

function createEditableRow(
  standardType: StandardType,
  entry?: Partial<CustomSubjectTemplateEntry>
): EditableRow {
  rowId += 1
  return {
    localId: `custom-template-row-${rowId}`,
    code: entry?.code ?? '',
    name: entry?.name ?? '',
    category: entry?.category ?? CATEGORY_OPTIONS[standardType][0].value,
    balanceDirection: entry?.balanceDirection ?? 1,
    isCashFlow: entry?.isCashFlow ?? false,
    enabled: entry?.enabled ?? true,
    sortOrder: entry?.sortOrder ?? rowId,
    carryForwardTargetCode: entry?.carryForwardTargetCode ?? null,
    note: entry?.note ?? null
  }
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

function requiresCarryForwardTarget(standardType: StandardType, category: string): boolean {
  return standardType === 'npo'
    ? category === 'income' || category === 'expense'
    : category === 'profit_loss'
}

function getBalanceDirectionLabel(direction: number): string {
  return direction === 1 ? '借' : '贷'
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '尚未保存'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('zh-CN', { hour12: false })
}

export default function AccountingStandardCustomTemplateDialog(
  props: CustomTemplateDialogProps
): JSX.Element {
  const {
    open,
    template,
    defaultBaseStandardType,
    referenceSubjects,
    isAdmin,
    busyAction,
    message,
    onOpenChange,
    onDownloadTemplate,
    onImportTemplate,
    onClearTemplate,
    onDeleteTemplate,
    onSaveTemplate
  } = props

  const currentStandardType = template?.baseStandardType ?? defaultBaseStandardType
  const categoryOptions = CATEGORY_OPTIONS[currentStandardType]
  const [templateName, setTemplateName] = useState(template?.templateName ?? '')
  const [templateDescription, setTemplateDescription] = useState(template?.templateDescription ?? '')
  const [rows, setRows] = useState<EditableRow[]>([])

  useEffect(() => {
    setTemplateName(template?.templateName ?? '')
    setTemplateDescription(template?.templateDescription ?? '')
    setRows(
      (template?.entries ?? [])
        .map((entry) => createEditableRow(currentStandardType, entry))
        .sort(compareByCode)
    )
  }, [currentStandardType, template?.id, template?.templateDescription, template?.templateName, template?.updatedAt])

  const carryForwardOptions = useMemo(() => {
    const allowedCategories =
      currentStandardType === 'npo' ? new Set(['net_assets']) : new Set(['equity'])
    return referenceSubjects.filter((item) => allowedCategories.has(item.category))
  }, [currentStandardType, referenceSubjects])

  const sortedRows = useMemo(() => rows.slice().sort(compareByCode), [rows])

  function updateRow(localId: string, patch: Partial<EditableRow>): void {
    setRows((current) =>
      current.map((row) => {
        if (row.localId !== localId) return row
        const next = { ...row, ...patch }
        if (!requiresCarryForwardTarget(currentStandardType, next.category)) {
          next.carryForwardTargetCode = null
        }
        return next
      })
    )
  }

  function addRow(): void {
    setRows((current) => [...current, createEditableRow(currentStandardType)])
  }

  function removeRow(localId: string): void {
    setRows((current) => current.filter((row) => row.localId !== localId))
  }

  function buildPayload(): {
    templateId?: string
    baseStandardType: StandardType
    templateName: string
    templateDescription: string | null
    entries: CustomSubjectTemplateEntry[]
  } {
    return {
      templateId: template?.id,
      baseStandardType: currentStandardType,
      templateName: templateName.trim() || '未命名自定义模板',
      templateDescription: templateDescription.trim() || null,
      entries: sortedRows.map((row, index) => ({
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
  }

  async function handleSave(): Promise<void> {
    await onSaveTemplate(buildPayload())
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(1240px,calc(100vw-24px))] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
        >
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Dialog.Title className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                {template ? `维护自定义模板：${template.templateName}` : '新增自定义模板'}
              </Dialog.Title>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                自定义模板独立于系统预设模板保存，不会写回企业或民非系统模板。
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
                onClick={() => void onImportTemplate(buildPayload())}
              >
                {busyAction === 'import' ? '导入中...' : '批量导入'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={addRow}
              >
                新增科目
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null}
                onClick={() => void handleSave()}
              >
                {busyAction === 'save' ? '保存中...' : '保存'}
              </button>
              <button
                type="button"
                className="glass-btn-secondary"
                disabled={!isAdmin || busyAction !== null || sortedRows.length === 0}
                onClick={() => void onClearTemplate()}
                style={{
                  color:
                    !isAdmin || sortedRows.length === 0
                      ? 'var(--color-text-muted)'
                      : 'var(--color-danger)'
                }}
              >
                {busyAction === 'clear' ? '清空中...' : '清空模板'}
              </button>
              {template ? (
                <button
                  type="button"
                  className="glass-btn-secondary"
                  disabled={!isAdmin || busyAction !== null}
                  onClick={() => void onDeleteTemplate()}
                  style={{
                    color: !isAdmin ? 'var(--color-text-muted)' : 'var(--color-danger)'
                  }}
                >
                  {busyAction === 'delete' ? '删除中...' : '删除模板'}
                </button>
              ) : null}
              <button type="button" className="glass-btn-secondary" onClick={() => onOpenChange(false)}>
                关闭
              </button>
            </div>
          </div>

          <div className="glass-panel-light p-4 mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  模板名称
                </label>
                <input
                  className="glass-input"
                  value={templateName}
                  disabled={!isAdmin}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="请输入模板名称"
                />
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  最近保存：{formatUpdatedAt(template?.updatedAt ?? null)}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  模板说明
                </label>
                <textarea
                  className="glass-input min-h-[92px] resize-y"
                  value={templateDescription}
                  disabled={!isAdmin}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                  placeholder="请输入模板说明，例如适用行业、使用边界、命名规则"
                />
              </div>
            </div>
          </div>

          <section className="glass-panel overflow-hidden flex flex-col mt-4">
            <div
              className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap"
              style={{ borderColor: 'var(--color-glass-border-light)' }}
            >
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  当前自定义模板科目
                </div>
                <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  这里只显示自行添加的一级科目；“清空模板”会一键删除这里的全部科目。
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto max-h-[520px]">
              {sortedRows.length === 0 ? (
                <div className="py-14 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  当前还没有自定义新增科目，可先模板下载、批量导入，或直接手动新增科目。
                </div>
              ) : (
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
                    {sortedRows.map((row) => {
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
                                updateRow(row.localId, { code: event.target.value })
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
                                updateRow(row.localId, { name: event.target.value })
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
                                updateRow(row.localId, { category: event.target.value })
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
                                updateRow(row.localId, {
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
                                updateRow(row.localId, { isCashFlow: event.target.value === '1' })
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
                                updateRow(row.localId, { enabled: event.target.value === '1' })
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
                                updateRow(row.localId, {
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
                                updateRow(row.localId, { note: event.target.value })
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
                                onClick={() => removeRow(row.localId)}
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
              )}
            </div>
          </section>

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

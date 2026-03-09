import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLedgerStore } from '../stores/ledgerStore'

type LedgerStandardType = 'enterprise' | 'npo'

type CarryForwardRule = {
  id: number
  fromSubjectCode: string
  fromSubjectName: string
  toSubjectCode: string
  toSubjectName: string
}

type SubjectRow = {
  code: string
  name: string
  category: string
  parent_code: string | null
  level: number
}

type MessageState = {
  type: 'error' | 'success'
  text: string
}

const TARGET_ROOT_PREFIXES: Record<LedgerStandardType, string[]> = {
  enterprise: ['4103'],
  npo: ['3101', '3102']
}

function isCodeWithinPrefixes(code: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => code === prefix || code.startsWith(prefix))
}

function buildHasChildrenCodes(subjects: SubjectRow[]): Set<string> {
  const hasChildrenCodes = new Set<string>()

  for (const subject of subjects) {
    const hasChildren = subjects.some(
      (candidate) => candidate.code !== subject.code && candidate.code.startsWith(subject.code)
    )
    if (hasChildren) {
      hasChildrenCodes.add(subject.code)
    }
  }

  return hasChildrenCodes
}

function getLedgerTypeLabel(standardType: LedgerStandardType): string {
  return standardType === 'npo' ? '民非' : '企业'
}

function formatSubjectLabel(subject: Pick<SubjectRow, 'code' | 'name'>): string {
  return `${subject.code} ${subject.name}`.trim()
}

function formatSubjectList(subjects: Array<Pick<SubjectRow, 'code' | 'name'>>): string {
  return subjects.map((subject) => formatSubjectLabel(subject)).join('、')
}

function getPreferredTargetCode(
  standardType: LedgerStandardType,
  fromSubjectCode: string,
  targetSubjects: SubjectRow[]
): string {
  const targetRootPrefix =
    standardType === 'npo' && fromSubjectCode.endsWith('02')
      ? '3102'
      : TARGET_ROOT_PREFIXES[standardType][0]

  return (
    targetSubjects.find(
      (subject) => subject.code === targetRootPrefix || subject.code.startsWith(targetRootPrefix)
    )?.code ?? ''
  )
}

function buildTargetOptions(
  currentTargetCode: string,
  targetSubjects: SubjectRow[]
): Array<{ code: string; label: string }> {
  const baseOptions = targetSubjects.map((target) => ({
    code: target.code,
    label: formatSubjectLabel(target)
  }))

  if (!currentTargetCode || baseOptions.some((option) => option.code === currentTargetCode)) {
    return baseOptions
  }

  return [
    {
      code: currentTargetCode,
      label: `[无效] ${currentTargetCode}（请重新选择）`
    },
    ...baseOptions
  ]
}

export default function PLCarryForward(): JSX.Element {
  const currentLedger = useLedgerStore((state) => state.currentLedger)

  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [rules, setRules] = useState<CarryForwardRule[]>([])
  const [draftTargets, setDraftTargets] = useState<Record<string, string>>({})
  const [initialTargets, setInitialTargets] = useState<Record<string, string>>({})
  const [batchTargetCode, setBatchTargetCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<MessageState | null>(null)
  const [isCustomEditorOpen, setIsCustomEditorOpen] = useState(false)
  const [editorTargets, setEditorTargets] = useState<Record<string, string>>({})

  const hasChildrenCodes = useMemo(() => buildHasChildrenCodes(subjects), [subjects])

  const sourceSubjects = useMemo(() => {
    return subjects
      .filter((subject) => subject.category === 'profit_loss' && !hasChildrenCodes.has(subject.code))
      .sort((left, right) => left.code.localeCompare(right.code))
  }, [hasChildrenCodes, subjects])

  const targetSubjects = useMemo(() => {
    if (!currentLedger) return []

    return subjects
      .filter(
        (subject) =>
          subject.category === 'equity' &&
          !hasChildrenCodes.has(subject.code) &&
          isCodeWithinPrefixes(subject.code, TARGET_ROOT_PREFIXES[currentLedger.standard_type])
      )
      .sort((left, right) => left.code.localeCompare(right.code))
  }, [currentLedger, hasChildrenCodes, subjects])

  const targetByCode = useMemo(() => {
    return new Map(targetSubjects.map((subject) => [subject.code, subject]))
  }, [targetSubjects])

  const missingTargetSubjects = useMemo(() => {
    return sourceSubjects.filter((subject) => !draftTargets[subject.code])
  }, [draftTargets, sourceSubjects])

  const invalidTargetSubjects = useMemo(() => {
    return sourceSubjects.filter((subject) => {
      const targetCode = draftTargets[subject.code]
      return Boolean(targetCode) && !targetByCode.has(targetCode)
    })
  }, [draftTargets, sourceSubjects, targetByCode])

  const isDirty = useMemo(() => {
    return sourceSubjects.some(
      (subject) => (draftTargets[subject.code] ?? '') !== (initialTargets[subject.code] ?? '')
    )
  }, [draftTargets, initialTargets, sourceSubjects])

  const loadData = useCallback(
    async (preserveMessage = false): Promise<void> => {
      if (!currentLedger || !window.electron) {
        setSubjects([])
        setRules([])
        setDraftTargets({})
        setInitialTargets({})
        setBatchTargetCode('')
        return
      }

      setLoading(true)
      if (!preserveMessage) {
        setMessage(null)
      }

      try {
        const [nextSubjects, nextRules] = await Promise.all([
          window.api.subject.getAll(currentLedger.id),
          window.api.plCarryForward.listRules(currentLedger.id)
        ])

        const typedSubjects = nextSubjects as SubjectRow[]
        const typedRules = nextRules as CarryForwardRule[]
        const ruleBySourceCode = new Map(
          typedRules.map((rule) => [rule.fromSubjectCode, rule.toSubjectCode])
        )
        const nextHasChildrenCodes = buildHasChildrenCodes(typedSubjects)
        const nextSourceSubjects = typedSubjects
          .filter(
            (subject) =>
              subject.category === 'profit_loss' && !nextHasChildrenCodes.has(subject.code)
          )
          .sort((left, right) => left.code.localeCompare(right.code))

        const nextDraftTargets = Object.fromEntries(
          nextSourceSubjects.map((subject) => [
            subject.code,
            ruleBySourceCode.get(subject.code) ?? ''
          ])
        )

        setSubjects(typedSubjects)
        setRules(typedRules)
        setDraftTargets(nextDraftTargets)
        setInitialTargets(nextDraftTargets)
        setBatchTargetCode('')
      } catch (error) {
        setSubjects([])
        setRules([])
        setDraftTargets({})
        setInitialTargets({})
        setBatchTargetCode('')
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '加载损益结转规则失败'
        })
      } finally {
        setLoading(false)
      }
    },
    [currentLedger]
  )

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (batchTargetCode && !targetByCode.has(batchTargetCode)) {
      setBatchTargetCode('')
    }
  }, [batchTargetCode, targetByCode])

  const handleTargetChange = (fromSubjectCode: string, toSubjectCode: string): void => {
    setDraftTargets((current) => ({
      ...current,
      [fromSubjectCode]: toSubjectCode
    }))
    setMessage(null)
  }

  const handleApplyBatchTarget = (): void => {
    if (!batchTargetCode) {
      setMessage({ type: 'error', text: '请先选择要批量应用的结转目标科目' })
      return
    }

    setDraftTargets(
      Object.fromEntries(sourceSubjects.map((subject) => [subject.code, batchTargetCode]))
    )
    setMessage(null)
  }

  const handleRestoreDefault = (): void => {
    if (!currentLedger) return

    setDraftTargets(
      Object.fromEntries(
        sourceSubjects.map((subject) => [
          subject.code,
          getPreferredTargetCode(currentLedger.standard_type, subject.code, targetSubjects)
        ])
      )
    )
    setMessage(null)
  }

  const openCustomEditor = (): void => {
    setEditorTargets(
      Object.fromEntries(
        sourceSubjects.map((subject) => [subject.code, draftTargets[subject.code] ?? ''])
      )
    )
    setIsCustomEditorOpen(true)
    setMessage(null)
  }

  const closeCustomEditor = (): void => {
    setIsCustomEditorOpen(false)
    setEditorTargets({})
  }

  const handleApplyCustomEditor = (): void => {
    setDraftTargets(
      Object.fromEntries(
        sourceSubjects.map((subject) => [subject.code, editorTargets[subject.code] ?? ''])
      )
    )
    closeCustomEditor()
    setMessage({
      type: 'success',
      text: '已应用自定义编辑结果，请继续点击“保存规则”提交到账套'
    })
  }

  const handleSave = async (): Promise<void> => {
    if (!currentLedger) {
      setMessage({ type: 'error', text: '请先选择账套' })
      return
    }

    if (!window.electron) {
      setMessage({ type: 'error', text: '浏览器预览模式不支持账套设置操作' })
      return
    }

    if (targetSubjects.length === 0) {
      setMessage({
        type: 'error',
        text: '当前账套没有可用的末级结转目标科目，请先补齐本年利润或净资产明细科目'
      })
      return
    }

    if (missingTargetSubjects.length > 0) {
      setMessage({
        type: 'error',
        text: `以下损益科目尚未选择结转目标：${formatSubjectList(missingTargetSubjects)}`
      })
      return
    }

    if (invalidTargetSubjects.length > 0) {
      setMessage({
        type: 'error',
        text: `存在无效结转目标，请重新选择后保存：${formatSubjectList(invalidTargetSubjects)}`
      })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const result = await window.api.plCarryForward.saveRules({
        ledgerId: currentLedger.id,
        rules: sourceSubjects.map((subject) => ({
          fromSubjectCode: subject.code,
          toSubjectCode: draftTargets[subject.code] ?? ''
        }))
      })

      if (!result.success) {
        setMessage({ type: 'error', text: result.error || '保存损益结转规则失败' })
        return
      }

      await loadData(true)
      setMessage({
        type: 'success',
        text: `期末损益结转规则已保存，共更新 ${result.savedCount ?? sourceSubjects.length} 条规则`
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存损益结转规则失败'
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            期末损益结转设置
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            为末级损益类科目维护结转目标。系统执行损益结转时，会严格按这里保存的规则生成结转凭证。
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="glass-btn-secondary"
            onClick={handleRestoreDefault}
            disabled={!currentLedger || loading || saving || sourceSubjects.length === 0}
          >
            恢复默认建议
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => void loadData()}
            disabled={!currentLedger || loading || saving}
          >
            {loading ? '刷新中...' : '刷新规则'}
          </button>
          <button
            className="glass-btn-primary"
            onClick={() => void handleSave()}
            disabled={!currentLedger || loading || saving || !isDirty}
          >
            {saving ? '保存中...' : '保存规则'}
          </button>
          <button
            className="glass-btn-secondary"
            onClick={openCustomEditor}
            disabled={!currentLedger || loading || saving || sourceSubjects.length === 0}
          >
            自定义编辑
          </button>
        </div>
      </div>

      {!currentLedger && (
        <div
          className="glass-panel-light px-4 py-6 text-sm"
          style={{ color: 'var(--color-text-muted)' }}
        >
          请先选择账套后维护损益结转规则。
        </div>
      )}

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

      {currentLedger && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="glass-panel-light px-4 py-3 text-sm space-y-2">
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>当前账套：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {currentLedger.name}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>账套类型：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {getLedgerTypeLabel(currentLedger.standard_type)}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>末级损益科目：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {sourceSubjects.length}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>已保存规则：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {rules.length}
                </span>
              </div>
            </div>

            <div className="glass-panel-light px-4 py-3 text-sm space-y-2">
              <div>
                <span style={{ color: 'var(--color-text-muted)' }}>可选结转目标：</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                  {targetSubjects.length}
                </span>
              </div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                {currentLedger.standard_type === 'npo'
                  ? '民非账套仅允许结转到非限定性净资产或限定性净资产及其末级明细。'
                  : '企业账套仅允许结转到本年利润及其末级明细。'}
              </div>
            </div>

            <div className="glass-panel-light px-4 py-3 text-sm space-y-3">
              <div style={{ color: 'var(--color-text-muted)' }}>
                批量应用同一目标科目时，可先选择科目再一键写入全部规则。
              </div>
              <div className="flex gap-2 flex-wrap">
                <select
                  className="glass-input min-w-[240px] flex-1"
                  value={batchTargetCode}
                  onChange={(event) => setBatchTargetCode(event.target.value)}
                  disabled={loading || saving || targetSubjects.length === 0}
                >
                  <option value="">请选择批量目标科目</option>
                  {targetSubjects.map((subject) => (
                    <option key={subject.code} value={subject.code}>
                      {formatSubjectLabel(subject)}
                    </option>
                  ))}
                </select>
                <button
                  className="glass-btn-secondary"
                  onClick={handleApplyBatchTarget}
                  disabled={loading || saving || sourceSubjects.length === 0}
                >
                  应用到全部
                </button>
              </div>
            </div>
          </div>

          {invalidTargetSubjects.length > 0 && (
            <div
              className="glass-panel-light px-4 py-3 text-sm"
              style={{ color: '#b45309' }}
            >
              检测到 {invalidTargetSubjects.length}{' '}
              条现有规则的结转目标已不是允许的末级科目，请重新选择后保存。
            </div>
          )}

          <div className="glass-panel flex-1 overflow-hidden flex flex-col">
            <div
              className="px-4 py-3 border-b text-sm"
              style={{
                borderColor: 'var(--color-glass-border-light)',
                color: 'var(--color-text-muted)'
              }}
            >
              仅末级损益科目参与设置。若你在“会计科目设置”中新增了自定义末级损益科目，需要在这里补齐结转目标后，期末损益结转才会完整覆盖。
              如需逐个科目单独维护，请使用顶部“自定义编辑”按钮进入独立交互框。
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
                    <th className="py-2 px-3 font-semibold">末级损益科目</th>
                    <th className="py-2 px-3 font-semibold">结转目标科目</th>
                    <th className="py-2 px-3 font-semibold">当前状态</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceSubjects.map((subject) => {
                    const currentTargetCode = draftTargets[subject.code] ?? ''
                    const currentTarget = targetByCode.get(currentTargetCode)
                    const hasInvalidTarget = Boolean(currentTargetCode) && !currentTarget
                    const rowOptions = buildTargetOptions(currentTargetCode, targetSubjects)

                    return (
                      <tr
                        key={subject.code}
                        className="border-b last:border-0 hover:bg-white/10 transition-colors"
                        style={{
                          borderColor: 'var(--color-glass-border-light)',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <td className="py-2 px-3">{formatSubjectLabel(subject)}</td>
                        <td className="py-2 px-3 min-w-[320px]">
                          <select
                            className="glass-input w-full"
                            value={currentTargetCode}
                            onChange={(event) =>
                              handleTargetChange(subject.code, event.target.value)
                            }
                            disabled={loading || saving}
                          >
                            <option value="">请选择结转目标科目</option>
                            {rowOptions.map((option) => (
                              <option key={`${subject.code}-${option.code}`} value={option.code}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3 text-sm">
                          {!currentTargetCode ? (
                            <span style={{ color: 'var(--color-danger)' }}>待配置</span>
                          ) : hasInvalidTarget ? (
                            <span style={{ color: '#b45309' }}>目标失效，需重选</span>
                          ) : (
                            <span style={{ color: 'var(--color-success)' }}>已配置</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {!loading && sourceSubjects.length === 0 && (
                <div
                  className="py-12 text-center text-sm"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  当前账套暂无可配置的末级损益科目。
                </div>
              )}
            </div>
          </div>

          <Dialog.Root open={isCustomEditorOpen} onOpenChange={(open) => !open && closeCustomEditor()}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" />
              <Dialog.Content
                className="glass-panel fixed top-1/2 left-1/2 z-50 w-[min(1080px,calc(100vw-32px))] max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 p-6 focus:outline-none flex flex-col"
                style={{ backgroundColor: 'rgba(255, 255, 255, 0.9)' }}
              >
                <Dialog.Title
                  className="text-lg font-bold mb-4"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  期末结转规则自定义编辑
                </Dialog.Title>

                <div
                  className="glass-panel-light px-4 py-3 text-sm mb-4"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  在独立交互框中逐个维护每个末级损益科目的期末结转规则。点击“应用到页面草稿”后，再回到主页面使用“保存规则”统一提交到账套。
                </div>

                <div className="flex-1 overflow-auto pr-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr
                        className="border-b"
                        style={{
                          borderColor: 'var(--color-glass-border-light)',
                          color: 'var(--color-text-primary)'
                        }}
                      >
                        <th className="py-2 px-3 font-semibold">末级损益科目</th>
                        <th className="py-2 px-3 font-semibold">期末结转目标</th>
                        <th className="py-2 px-3 font-semibold">状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sourceSubjects.map((subject) => {
                        const currentTargetCode = editorTargets[subject.code] ?? ''
                        const hasInvalidTarget =
                          Boolean(currentTargetCode) && !targetByCode.has(currentTargetCode)

                        return (
                          <tr
                            key={`editor-${subject.code}`}
                            className="border-b last:border-0"
                            style={{
                              borderColor: 'var(--color-glass-border-light)',
                              color: 'var(--color-text-primary)'
                            }}
                          >
                            <td className="py-2 px-3">{formatSubjectLabel(subject)}</td>
                            <td className="py-2 px-3 min-w-[360px]">
                              <select
                                className="glass-input w-full"
                                value={currentTargetCode}
                                onChange={(event) =>
                                  setEditorTargets((current) => ({
                                    ...current,
                                    [subject.code]: event.target.value
                                  }))
                                }
                                disabled={loading || saving}
                              >
                                <option value="">请选择结转目标科目</option>
                                {buildTargetOptions(currentTargetCode, targetSubjects).map(
                                  (option) => (
                                    <option
                                      key={`editor-${subject.code}-${option.code}`}
                                      value={option.code}
                                    >
                                      {option.label}
                                    </option>
                                  )
                                )}
                              </select>
                            </td>
                            <td className="py-2 px-3 text-sm">
                              {!currentTargetCode ? (
                                <span style={{ color: 'var(--color-danger)' }}>待配置</span>
                              ) : hasInvalidTarget ? (
                                <span style={{ color: '#b45309' }}>目标失效，需重选</span>
                              ) : (
                                <span style={{ color: 'var(--color-success)' }}>已配置</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button type="button" className="glass-btn-secondary" onClick={closeCustomEditor}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="glass-btn-primary"
                    onClick={handleApplyCustomEditor}
                  >
                    应用到页面草稿
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </>
      )}
    </div>
  )
}

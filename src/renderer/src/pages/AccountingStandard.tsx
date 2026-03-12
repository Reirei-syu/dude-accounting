import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import AccountingStandardCustomTemplateDialog, {
  type IndependentCustomTemplateSummary
} from './AccountingStandardCustomTemplateDialog'
import AccountingStandardSubjectTemplateDialog, {
  type CustomSubjectTemplateEntry,
  type CustomSubjectTemplate,
  type StandardSubjectReference,
  type StandardType
} from './AccountingStandardSubjectTemplateDialog'
import { mergeSubjectTemplateEntries } from './subjectTemplateMerge'
import { useAuthStore } from '../stores/authStore'
import { useLedgerStore } from '../stores/ledgerStore'

interface TemplateSummary {
  standardType: StandardType
  name: string
  subjectCount: number
  topLevelCount: number
  hasRestrictedSubAccounts: boolean
}

const STANDARD_LABEL: Record<StandardType, string> = {
  enterprise: '企业会计准则（CAS）',
  npo: '民间非营利组织会计制度'
}

const TEMPLATE_HIGHLIGHTS: Record<StandardType, string[]> = {
  enterprise: ['完整企业科目体系', '企业财务报表列报口径', '标准损益结转至本年利润'],
  npo: ['双净资产（限定/非限定）', '受托代理资产与负债配套', '收入自动预置限定/非限定二级']
}

const EMPTY_CUSTOM_TEMPLATE: Record<StandardType, CustomSubjectTemplate> = {
  enterprise: {
    standardType: 'enterprise',
    templateName: '企业一级科目模板',
    templateDescription: null,
    updatedAt: null,
    entryCount: 0,
    entries: []
  },
  npo: {
    standardType: 'npo',
    templateName: '民非一级科目模板',
    templateDescription: null,
    updatedAt: null,
    entryCount: 0,
    entries: []
  }
}

export default function AccountingStandard(): JSX.Element {
  const currentUser = useAuthStore((state) => state.user)
  const currentLedger = useLedgerStore((state) => state.currentLedger)
  const setCurrentLedger = useLedgerStore((state) => state.setCurrentLedger)
  const setLedgers = useLedgerStore((state) => state.setLedgers)

  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [customTemplates, setCustomTemplates] =
    useState<Record<StandardType, CustomSubjectTemplate>>(EMPTY_CUSTOM_TEMPLATE)
  const [independentCustomTemplates, setIndependentCustomTemplates] = useState<
    IndependentCustomTemplateSummary[]
  >([])
  const [referenceSubjects, setReferenceSubjects] = useState<
    Record<StandardType, StandardSubjectReference[]>
  >({
    enterprise: [],
    npo: []
  })
  const [refreshing, setRefreshing] = useState(false)
  const [applyingType, setApplyingType] = useState<StandardType | null>(null)
  const [pageMessage, setPageMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  )
  const [isCustomTemplateDialogOpen, setIsCustomTemplateDialogOpen] = useState(false)
  const [customDialogDefaultStandardType, setCustomDialogDefaultStandardType] =
    useState<StandardType>('enterprise')
  const [editingIndependentTemplateId, setEditingIndependentTemplateId] = useState<string | null>(null)
  const [customDialogBusyAction, setCustomDialogBusyAction] =
    useState<'clear' | 'delete' | 'download' | 'import' | 'save' | null>(null)
  const [customDialogMessage, setCustomDialogMessage] = useState<{
    type: 'error' | 'success'
    text: string
  } | null>(null)
  const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false)
  const [dialogStandardType, setDialogStandardType] = useState<StandardType | null>(null)
  const [dialogBusyAction, setDialogBusyAction] =
    useState<'clear' | 'download' | 'import' | 'save' | null>(null)
  const [dialogMessage, setDialogMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(
    null
  )

  const currentType = (currentLedger?.standard_type || 'enterprise') as StandardType
  const currentTypeLabel = STANDARD_LABEL[currentType]
  const canManageTemplate = currentUser?.isAdmin === true

  const loadIndependentCustomTemplates = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setIndependentCustomTemplates([])
      return
    }

    const result = await window.api.settings.listIndependentCustomSubjectTemplates()
    setIndependentCustomTemplates(result as IndependentCustomTemplateSummary[])
  }, [])

  const loadStandardTemplates = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setTemplates([])
      return
    }

    const result = await window.api.ledger.getStandardTemplates()
    setTemplates(result as TemplateSummary[])
  }, [])

  const loadCustomTemplates = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setCustomTemplates(EMPTY_CUSTOM_TEMPLATE)
      return
    }

    const [enterprise, npo] = await Promise.all([
      window.api.settings.getSubjectTemplate('enterprise'),
      window.api.settings.getSubjectTemplate('npo')
    ])

    setCustomTemplates({
      enterprise: enterprise as CustomSubjectTemplate,
      npo: npo as CustomSubjectTemplate
    })
  }, [])

  const loadReferenceSubjects = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setReferenceSubjects({ enterprise: [], npo: [] })
      return
    }

    const [enterprise, npo] = await Promise.all([
      window.api.settings.getSubjectTemplateReference('enterprise'),
      window.api.settings.getSubjectTemplateReference('npo')
    ])

    setReferenceSubjects({
      enterprise: enterprise as StandardSubjectReference[],
      npo: npo as StandardSubjectReference[]
    })
  }, [])

  const refreshAll = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all([
        loadStandardTemplates(),
        loadCustomTemplates(),
        loadReferenceSubjects(),
        loadIndependentCustomTemplates()
      ])
    } catch (error) {
      setPageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '加载会计准则配置失败'
      })
    } finally {
      setRefreshing(false)
    }
  }, [loadCustomTemplates, loadIndependentCustomTemplates, loadReferenceSubjects, loadStandardTemplates])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      void refreshAll()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [refreshAll])

  const templateMap = useMemo(() => {
    const nextMap: Record<string, TemplateSummary> = {}
    for (const item of templates) {
      nextMap[item.standardType] = item
    }
    return nextMap
  }, [templates])

  const dialogTemplate = dialogStandardType ? customTemplates[dialogStandardType] : null
  const customDialogTemplate =
    independentCustomTemplates.find((item) => item.id === editingIndependentTemplateId) ?? null

  const closeTemplateDialog = useCallback((): void => {
    setIsTemplateDialogOpen(false)
    setDialogBusyAction(null)
    setDialogMessage(null)
  }, [])

  const openTemplateDialog = useCallback((standardType: StandardType): void => {
    setDialogStandardType(standardType)
    setIsTemplateDialogOpen(true)
    setDialogBusyAction(null)
    setDialogMessage(null)
  }, [])

  const closeCustomTemplateDialog = useCallback((): void => {
    setIsCustomTemplateDialogOpen(false)
    setCustomDialogBusyAction(null)
    setCustomDialogMessage(null)
  }, [])

  const openCustomTemplateDialog = useCallback((standardType: StandardType): void => {
    setEditingIndependentTemplateId(null)
    setCustomDialogDefaultStandardType(standardType)
    setIsCustomTemplateDialogOpen(true)
    setCustomDialogBusyAction(null)
    setCustomDialogMessage(null)
  }, [])

  const openIndependentTemplateEditor = useCallback(
    (templateId: string, baseStandardType: StandardType): void => {
      setEditingIndependentTemplateId(templateId)
      setCustomDialogDefaultStandardType(baseStandardType)
      setIsCustomTemplateDialogOpen(true)
      setCustomDialogBusyAction(null)
      setCustomDialogMessage(null)
    },
    []
  )

  const applyTemplate = async (standardType: StandardType): Promise<void> => {
    setPageMessage(null)

    if (!currentLedger) {
      setPageMessage({ type: 'error', text: '请先选择账套' })
      return
    }
    if (!window.electron) {
      setPageMessage({ type: 'error', text: '浏览器预览模式不支持会计准则切换' })
      return
    }
    if (standardType === currentType) {
      setPageMessage({ type: 'success', text: `当前账套已是${STANDARD_LABEL[standardType]}` })
      return
    }

    const customEntryCount = customTemplates[standardType]?.entryCount ?? 0
    const confirmed = window.confirm(
      `将当前账套切换为“${STANDARD_LABEL[standardType]}”模板。\n\n该操作会重建系统科目与系统结转规则${customEntryCount > 0 ? `，并附加 ${customEntryCount} 个自定义一级科目` : ''}。\n为保证账务一致性，已有业务数据的账套会被拒绝切换。\n\n是否继续？`
    )
    if (!confirmed) {
      return
    }

    setApplyingType(standardType)
    try {
      const result = await window.api.ledger.applyStandardTemplate({
        ledgerId: currentLedger.id,
        standardType
      })
      if (!result.success) {
        setPageMessage({ type: 'error', text: result.error || '应用准则模板失败' })
        return
      }

      const ledgers = await window.api.ledger.getAll()
      setLedgers(ledgers)
      const updatedLedger = ledgers.find((ledger) => ledger.id === currentLedger.id) || null
      setCurrentLedger(updatedLedger)

      setPageMessage({
        type: 'success',
        text: `已应用${STANDARD_LABEL[standardType]}模板，当前账套科目数：${result.subjectCount ?? '-'}`
      })
    } catch (error) {
      setPageMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '应用准则模板失败'
      })
    } finally {
      setApplyingType(null)
    }
  }

  const handleDownloadTemplate = useCallback(async (): Promise<void> => {
    if (!dialogStandardType || !window.electron) {
      setDialogMessage({ type: 'error', text: '当前环境不支持模板下载' })
      return
    }

    setDialogBusyAction('download')
    setDialogMessage(null)
    try {
      const result = await window.api.settings.downloadSubjectTemplate(dialogStandardType)
      if (result.cancelled) {
        return
      }
      if (!result.success) {
        setDialogMessage({ type: 'error', text: result.error || '下载导入模板失败' })
        return
      }
      setDialogMessage({
        type: 'success',
        text: `模板已生成：${result.filePath ?? '保存成功'}`
      })
    } catch (error) {
      setDialogMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '下载导入模板失败'
      })
    } finally {
      setDialogBusyAction(null)
    }
  }, [dialogStandardType])

  const handleImportTemplate = useCallback(
    async (currentEntries: CustomSubjectTemplateEntry[]): Promise<void> => {
      if (!dialogStandardType || !window.electron) {
        setDialogMessage({ type: 'error', text: '当前环境不支持模板导入' })
        return
      }

      setDialogBusyAction('import')
      setDialogMessage(null)
      try {
        const parsed = await window.api.settings.parseSubjectTemplateImport(dialogStandardType)
        if (parsed.cancelled) {
          return
        }
        if (!parsed.success || !parsed.template) {
          setDialogMessage({ type: 'error', text: parsed.error || '导入一级科目模板失败' })
          return
        }

        const mergedEntries = mergeSubjectTemplateEntries(currentEntries, parsed.template.entries)
        const result = await window.api.settings.saveSubjectTemplate({
          standardType: dialogStandardType,
          templateName: customTemplates[dialogStandardType]?.templateName,
          templateDescription: customTemplates[dialogStandardType]?.templateDescription ?? null,
          entries: mergedEntries
        })
        if (!result.success) {
          setDialogMessage({ type: 'error', text: result.error || '导入一级科目模板失败' })
          return
        }

        await loadCustomTemplates()
        setDialogMessage({
          type: 'success',
          text: `已合并导入 ${parsed.template.entryCount} 个一级科目模板条目`
        })
      } catch (error) {
        setDialogMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '导入一级科目模板失败'
        })
      } finally {
        setDialogBusyAction(null)
      }
    },
    [customTemplates, dialogStandardType, loadCustomTemplates]
  )

  const handleClearTemplate = useCallback(async (): Promise<void> => {
    if (!dialogStandardType || !window.electron) {
      setDialogMessage({ type: 'error', text: '当前环境不支持模板清空' })
      return
    }

    if (!window.confirm(`确定清空“${STANDARD_LABEL[dialogStandardType]}”的自定义一级科目模板吗？`)) {
      return
    }

    setDialogBusyAction('clear')
    setDialogMessage(null)
    try {
      const result = await window.api.settings.clearSubjectTemplate(dialogStandardType)
      if (!result.success) {
        setDialogMessage({ type: 'error', text: result.error || '清空一级科目模板失败' })
        return
      }

      await loadCustomTemplates()
      setDialogMessage({ type: 'success', text: '当前准则的自定义一级科目模板已清空' })
    } catch (error) {
      setDialogMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '清空一级科目模板失败'
      })
    } finally {
      setDialogBusyAction(null)
    }
  }, [dialogStandardType, loadCustomTemplates])

  const handleSaveTemplate = useCallback(
    async (
      entries: Array<{
        code: string
        name: string
        category: string
        balanceDirection: 1 | -1
        isCashFlow: boolean
        enabled: boolean
        sortOrder: number
        carryForwardTargetCode: string | null
        note: string | null
      }>
    ): Promise<void> => {
      if (!dialogStandardType || !window.electron) {
        setDialogMessage({ type: 'error', text: '当前环境不支持模板维护' })
        return
      }
      if (!canManageTemplate) {
        setDialogMessage({ type: 'error', text: '仅 admin 账号可维护一级科目模板' })
        return
      }

      setDialogBusyAction('save')
      setDialogMessage(null)
      try {
        const result = await window.api.settings.saveSubjectTemplate({
          standardType: dialogStandardType,
          templateName: customTemplates[dialogStandardType]?.templateName,
          entries
        })
        if (!result.success) {
          setDialogMessage({ type: 'error', text: result.error || '保存一级科目模板失败' })
          return
        }

        await loadCustomTemplates()
        setDialogMessage({
          type: 'success',
          text: `已保存 ${result.template?.entryCount ?? entries.length} 个模板条目`
        })
      } catch (error) {
        setDialogMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '保存一级科目模板失败'
        })
      } finally {
        setDialogBusyAction(null)
      }
    },
    [canManageTemplate, customTemplates, dialogStandardType, loadCustomTemplates]
  )

  const handleCustomTemplateDownload = useCallback(async (): Promise<void> => {
    if (!window.electron) {
      setCustomDialogMessage({ type: 'error', text: '当前环境不支持模板下载' })
      return
    }

    const baseStandardType = customDialogTemplate?.baseStandardType ?? customDialogDefaultStandardType
    setCustomDialogBusyAction('download')
    setCustomDialogMessage(null)
    try {
      const result = await window.api.settings.downloadSubjectTemplate(baseStandardType)
      if (result.cancelled) return
      if (!result.success) {
        setCustomDialogMessage({ type: 'error', text: result.error || '下载模板失败' })
        return
      }
      setCustomDialogMessage({
        type: 'success',
        text: `模板已生成：${result.filePath ?? '保存成功'}`
      })
    } catch (error) {
      setCustomDialogMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '下载模板失败'
      })
    } finally {
      setCustomDialogBusyAction(null)
    }
  }, [customDialogDefaultStandardType, customDialogTemplate])

  const handleCustomTemplateImport = useCallback(
    async (payload: {
      templateId?: string
      baseStandardType: StandardType
      templateName: string
      templateDescription: string | null
      entries: CustomSubjectTemplateEntry[]
    }): Promise<void> => {
      if (!window.electron) {
        setCustomDialogMessage({ type: 'error', text: '当前环境不支持模板导入' })
        return
      }

      setCustomDialogBusyAction('import')
      setCustomDialogMessage(null)
      try {
        const parsed = await window.api.settings.parseSubjectTemplateImport(payload.baseStandardType)
        if (parsed.cancelled) return
        if (!parsed.success || !parsed.template) {
          setCustomDialogMessage({ type: 'error', text: parsed.error || '批量导入失败' })
          return
        }

        const mergedEntries = mergeSubjectTemplateEntries(payload.entries, parsed.template.entries)
        const result = await window.api.settings.saveIndependentCustomSubjectTemplate({
          templateId: payload.templateId,
          baseStandardType: payload.baseStandardType,
          templateName: payload.templateName,
          templateDescription: payload.templateDescription,
          entries: mergedEntries
        })

        if (!result.success) {
          setCustomDialogMessage({ type: 'error', text: result.error || '批量导入失败' })
          return
        }

        await loadIndependentCustomTemplates()
        setCustomDialogMessage({
          type: 'success',
          text: `已合并导入 ${parsed.template.entryCount} 个自定义新增科目`
        })
      } catch (error) {
        setCustomDialogMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '批量导入失败'
        })
      } finally {
        setCustomDialogBusyAction(null)
      }
    },
    [loadIndependentCustomTemplates]
  )

  const handleCustomTemplateClear = useCallback(async (): Promise<void> => {
    if (!customDialogTemplate || !window.electron) {
      setCustomDialogMessage({ type: 'error', text: '当前环境不支持模板清空' })
      return
    }

    if (!window.confirm('确定一键删除自行添加的科目吗？')) {
      return
    }

    setCustomDialogBusyAction('clear')
    setCustomDialogMessage(null)
    try {
      const result = await window.api.settings.clearIndependentCustomSubjectTemplateEntries(
        customDialogTemplate.id
      )

      if (!result.success) {
        setCustomDialogMessage({ type: 'error', text: result.error || '清空模板失败' })
        return
      }

      await loadIndependentCustomTemplates()
      setCustomDialogMessage({ type: 'success', text: '已一键删除自行添加的科目' })
    } catch (error) {
      setCustomDialogMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '清空模板失败'
      })
    } finally {
      setCustomDialogBusyAction(null)
    }
  }, [customDialogTemplate, loadIndependentCustomTemplates])

  const handleCustomTemplateDelete = useCallback(async (): Promise<void> => {
    if (!customDialogTemplate || !window.electron) {
      setCustomDialogMessage({ type: 'error', text: '当前环境不支持删除自定义模板' })
      return
    }

    if (!window.confirm(`确定删除自定义模板“${customDialogTemplate.templateName}”吗？删除后不可恢复。`)) {
      return
    }

    setCustomDialogBusyAction('delete')
    setCustomDialogMessage(null)
    try {
      const result = await window.api.settings.deleteIndependentCustomSubjectTemplate(
        customDialogTemplate.id
      )

      if (!result.success) {
        setCustomDialogMessage({ type: 'error', text: result.error || '删除自定义模板失败' })
        return
      }

      await loadIndependentCustomTemplates()
      closeCustomTemplateDialog()
      setEditingIndependentTemplateId(null)
      setPageMessage({
        type: 'success',
        text: `已删除自定义模板：${customDialogTemplate.templateName}`
      })
    } catch (error) {
      setCustomDialogMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '删除自定义模板失败'
      })
    } finally {
      setCustomDialogBusyAction(null)
    }
  }, [closeCustomTemplateDialog, customDialogTemplate, loadIndependentCustomTemplates])

  const handleCustomTemplateSave = useCallback(
    async (payload: {
      templateId?: string
      baseStandardType: StandardType
      templateName: string
      templateDescription: string | null
      entries: Array<{
        code: string
        name: string
        category: string
        balanceDirection: 1 | -1
        isCashFlow: boolean
        enabled: boolean
        sortOrder: number
        carryForwardTargetCode: string | null
        note: string | null
      }>
    }): Promise<void> => {
      if (!window.electron) {
        setCustomDialogMessage({ type: 'error', text: '当前环境不支持自定义模板维护' })
        return
      }
      if (!canManageTemplate) {
        setCustomDialogMessage({ type: 'error', text: '仅 admin 账号可维护自定义模板' })
        return
      }

      setCustomDialogBusyAction('save')
      setCustomDialogMessage(null)
      try {
        const result = await window.api.settings.saveIndependentCustomSubjectTemplate({
          templateId: payload.templateId,
          baseStandardType: payload.baseStandardType,
          templateName: payload.templateName,
          templateDescription: payload.templateDescription,
          entries: payload.entries
        })

        if (!result.success) {
          setCustomDialogMessage({ type: 'error', text: result.error || '保存自定义模板失败' })
          return
        }

        await loadIndependentCustomTemplates()
        if (result.template?.id) {
          setEditingIndependentTemplateId(result.template.id)
          setCustomDialogDefaultStandardType(result.template.baseStandardType)
        }
        setCustomDialogMessage({
          type: 'success',
          text: `已保存 ${payload.entries.length} 个自定义新增科目`
        })
      } catch (error) {
        setCustomDialogMessage({
          type: 'error',
          text: error instanceof Error ? error.message : '保存自定义模板失败'
        })
      } finally {
        setCustomDialogBusyAction(null)
      }
    },
    [canManageTemplate, loadIndependentCustomTemplates]
  )

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            会计准则设置
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            当前仅支持 `enterprise` 与 `npo` 两类账套；自定义一级科目模板只做现有准则口径扩展。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="glass-btn-secondary" onClick={() => void refreshAll()} disabled={refreshing}>
            {refreshing ? '刷新中...' : '刷新模板'}
          </button>
          <button
            className="glass-btn-secondary"
            onClick={() => openCustomTemplateDialog(currentType)}
          >
            自定义模板
          </button>
        </div>
      </div>

      <div className="glass-panel-light p-4">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          当前账套：
          <strong style={{ color: 'var(--color-text-primary)' }}>
            {currentLedger ? ` ${currentLedger.name}` : ' 未选择'}
          </strong>
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          当前准则：
          <strong style={{ color: 'var(--color-text-primary)' }}>{currentTypeLabel}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(['enterprise', 'npo'] as StandardType[]).map((type) => {
          const template = templateMap[type]
          const customTemplate = customTemplates[type]
          const isCurrent = currentType === type
          const applyDisabled = !currentLedger || applyingType !== null

          return (
            <section key={type} className="glass-panel p-4 flex flex-col gap-4">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {STANDARD_LABEL[type]}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                    {type === 'enterprise'
                      ? '一般企业会计主体，适用于民营医院等企业性质账套。'
                      : '社会团体、基金会、社会服务机构等民间非营利组织。'}
                  </p>
                </div>
                {isCurrent && (
                  <span
                    className="px-2 py-1 rounded text-xs font-semibold"
                    style={{
                      color: 'var(--color-secondary)',
                      backgroundColor: 'rgba(30, 58, 138, 0.12)'
                    }}
                  >
                    当前使用
                  </span>
                )}
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    系统科目总数
                  </div>
                  <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {template ? template.subjectCount : '-'}
                  </div>
                </div>
                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    系统一级科目数
                  </div>
                  <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {template ? template.topLevelCount : '-'}
                  </div>
                </div>
                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    自定义一级科目
                  </div>
                  <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {customTemplate?.entryCount ?? 0}
                  </div>
                </div>
                <div className="glass-panel-light p-3">
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                    最近导入
                  </div>
                  <div className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {customTemplate?.updatedAt
                      ? new Date(customTemplate.updatedAt).toLocaleDateString('zh-CN')
                      : '未导入'}
                  </div>
                </div>
              </div>

              <ul className="text-sm flex flex-col gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                {TEMPLATE_HIGHLIGHTS[type].map((item) => (
                  <li key={item}>• {item}</li>
                ))}
                <li>• 自定义一级科目模板仅影响新建账套与空账套模板重建</li>
              </ul>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="glass-btn-secondary"
                  disabled={applyDisabled || isCurrent}
                  onClick={() => void applyTemplate(type)}
                >
                  {applyingType === type ? '应用中...' : isCurrent ? '当前已应用' : '应用此模板'}
                </button>
                <button className="glass-btn-secondary" onClick={() => openTemplateDialog(type)}>
                  模板维护
                </button>
              </div>
            </section>
          )
        })}
      </div>

      <div className="glass-panel p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              自定义模板
            </h3>
            <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
              独立于系统预设模板保存，可按名称单独维护。
            </p>
          </div>
        </div>

        {independentCustomTemplates.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
            还没有独立的自定义模板，点击顶部“自定义模板”可以新建。
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {independentCustomTemplates.map((template) => (
              <section key={template.id} className="glass-panel-light p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div
                      className="text-lg font-semibold"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {template.templateName}
                    </div>
                    <div className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                      基础口径：{STANDARD_LABEL[template.baseStandardType]}
                    </div>
                  </div>
                </div>

                <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <p>模板说明：{template.templateDescription || '未填写'}</p>
                  <p>新增科目数：{template.entryCount}</p>
                  <p>
                    最近保存：
                    {template.updatedAt
                      ? new Date(template.updatedAt).toLocaleString('zh-CN', { hour12: false })
                      : '未保存'}
                  </p>
                </div>

                <div>
                  <button
                    className="glass-btn-secondary"
                    onClick={() => openIndependentTemplateEditor(template.id, template.baseStandardType)}
                  >
                    模板维护
                  </button>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {pageMessage && (
        <div
          className="text-sm px-1"
          aria-live="polite"
          style={{
            color: pageMessage.type === 'error' ? 'var(--color-danger)' : 'var(--color-success)'
          }}
        >
          {pageMessage.text}
        </div>
      )}

      <AccountingStandardSubjectTemplateDialog
        open={isTemplateDialogOpen}
        standardType={dialogStandardType}
        standardLabel={dialogStandardType ? `${STANDARD_LABEL[dialogStandardType]} ` : ''}
        template={dialogTemplate}
        referenceSubjects={dialogStandardType ? referenceSubjects[dialogStandardType] : []}
        isAdmin={canManageTemplate}
        busyAction={dialogBusyAction}
        message={dialogMessage}
        onOpenChange={(open) => {
          if (!open) {
            closeTemplateDialog()
          }
        }}
        onDownloadTemplate={handleDownloadTemplate}
        onImportTemplate={handleImportTemplate}
        onClearTemplate={handleClearTemplate}
        onSaveTemplate={handleSaveTemplate}
      />

      <AccountingStandardCustomTemplateDialog
        open={isCustomTemplateDialogOpen}
        template={customDialogTemplate}
        referenceSubjects={
          referenceSubjects[customDialogTemplate?.baseStandardType ?? customDialogDefaultStandardType]
        }
        defaultBaseStandardType={customDialogDefaultStandardType}
        isAdmin={canManageTemplate}
        busyAction={customDialogBusyAction}
        message={customDialogMessage}
        onOpenChange={(open) => {
          if (!open) {
            closeCustomTemplateDialog()
          }
        }}
        onDownloadTemplate={handleCustomTemplateDownload}
        onImportTemplate={handleCustomTemplateImport}
        onClearTemplate={handleCustomTemplateClear}
        onDeleteTemplate={handleCustomTemplateDelete}
        onSaveTemplate={handleCustomTemplateSave}
      />
    </div>
  )
}

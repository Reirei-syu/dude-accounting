import path from 'node:path'
import type Database from 'better-sqlite3'
import ExcelJS from 'exceljs'
import {
  getCarryForwardSourceCategories,
  getCarryForwardTargetCategories,
  type AccountingStandardType,
  type SubjectCategory
} from '../database/subjectCategoryRules'
import { ENTERPRISE_SUBJECTS, NPO_SUBJECTS } from '../database/seed'
import { ensureDirectory } from './fileIntegrity'

const TEMPLATE_VERSION = 1

const TEMPLATE_NAME_BY_STANDARD: Record<AccountingStandardType, string> = {
  enterprise: '企业一级科目模板',
  npo: '民非一级科目模板'
}

const IMPORT_TEMPLATE_NAME_BY_STANDARD: Record<AccountingStandardType, string> = {
  enterprise: '企业一级科目导入模板',
  npo: '民非一级科目导入模板'
}

const ALLOWED_CATEGORIES: Record<AccountingStandardType, SubjectCategory[]> = {
  enterprise: ['asset', 'liability', 'common', 'equity', 'cost', 'profit_loss'],
  npo: ['asset', 'liability', 'net_assets', 'income', 'expense']
}

const CATEGORY_OPTIONS: Record<
  AccountingStandardType,
  Array<{ label: string; value: SubjectCategory }>
> = {
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

const TEMPLATE_HEADERS = [
  '科目编码',
  '科目名称',
  '科目类别',
  '余额方向',
  '现金流量科目',
  '是否启用',
  '期末结转目标科目',
  '备注'
] as const

const OPTION_SHEET_NAME = '选项数据'

const TEMPLATE_EXAMPLES: Record<AccountingStandardType, Array<CustomTopLevelSubjectTemplateEntry>> = {
  enterprise: [
    {
      code: '1991',
      name: '医疗专项设备',
      category: 'asset',
      balanceDirection: 1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 10,
      carryForwardTargetCode: null,
      note: '示例：医院可按设备管理需要扩展'
    },
    {
      code: '2991',
      name: '应付医护绩效',
      category: 'liability',
      balanceDirection: -1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 20,
      carryForwardTargetCode: null,
      note: '示例：医疗服务企业个性化负债科目'
    },
    {
      code: '6991',
      name: '专科项目成本',
      category: 'profit_loss',
      balanceDirection: 1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 30,
      carryForwardTargetCode: '4103',
      note: '示例：损益类需指定结转到本年利润'
    }
  ],
  npo: [
    {
      code: '1911',
      name: '专项救助物资',
      category: 'asset',
      balanceDirection: 1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 10,
      carryForwardTargetCode: null,
      note: '示例：慈善组织专项物资管理'
    },
    {
      code: '4911',
      name: '专项筹款收入',
      category: 'income',
      balanceDirection: -1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 20,
      carryForwardTargetCode: '3102',
      note: '示例：限定性收入可结转至限定性净资产'
    },
    {
      code: '5911',
      name: '专项项目支出',
      category: 'expense',
      balanceDirection: 1,
      isCashFlow: false,
      enabled: true,
      sortOrder: 30,
      carryForwardTargetCode: '3102',
      note: '示例：费用类需指定净资产结转目标'
    }
  ]
}

export interface CustomTopLevelSubjectTemplateEntry {
  code: string
  name: string
  category: SubjectCategory
  balanceDirection: 1 | -1
  isCashFlow: boolean
  enabled: boolean
  sortOrder: number
  carryForwardTargetCode: string | null
  note: string | null
}

interface StoredSubjectTemplatePayload {
  version: number
  standardType: AccountingStandardType
  templateName: string
  templateDescription: string | null
  updatedAt: string
  entries: CustomTopLevelSubjectTemplateEntry[]
}

interface StoredIndependentCustomTemplatePayload {
  id: string
  baseStandardType: AccountingStandardType
  templateName: string
  templateDescription: string | null
  updatedAt: string
  entries: CustomTopLevelSubjectTemplateEntry[]
}

interface StoredIndependentCustomTemplateCatalog {
  version: number
  templates: StoredIndependentCustomTemplatePayload[]
}

export interface CustomTopLevelSubjectTemplate {
  standardType: AccountingStandardType
  templateName: string
  templateDescription: string | null
  updatedAt: string | null
  entryCount: number
  entries: CustomTopLevelSubjectTemplateEntry[]
}

export interface StandardTopLevelSubjectReference {
  code: string
  name: string
  category: SubjectCategory
  balanceDirection: 1 | -1
  categoryLabel: string
  isCashFlow: boolean
}

const buildSettingKey = (standardType: AccountingStandardType): string =>
  `subject_template.${standardType}`

const INDEPENDENT_CUSTOM_TEMPLATE_SETTING_KEY = 'subject_template.custom_catalog'

const normalizeRequiredText = (value: unknown, fieldName: string): string => {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(`${fieldName}不能为空`)
  }
  return normalized
}

const normalizeSubjectCode = (value: unknown): string => {
  const normalized = normalizeRequiredText(value, '科目编码')
  if (!/^\d{4}$/.test(normalized)) {
    throw new Error('一级科目编码必须为 4 位数字')
  }
  return normalized
}

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : null
}

const normalizeCategory = (
  standardType: AccountingStandardType,
  value: unknown
): SubjectCategory => {
  const normalized = normalizeRequiredText(value, '科目类别')
  const matchedOption = CATEGORY_OPTIONS[standardType].find(
    (option) => option.value === normalized || option.label === normalized
  )
  const category = matchedOption?.value ?? (normalized as SubjectCategory)
  if (!ALLOWED_CATEGORIES[standardType].includes(category)) {
    throw new Error(`科目类别 ${normalized} 不适用于当前账套类型`)
  }
  return category
}

const normalizeBalanceDirection = (value: unknown): 1 | -1 => {
  const normalized = String(value ?? '').trim()
  if (normalized === '借' || normalized === '1') {
    return 1
  }
  if (normalized === '贷' || normalized === '-1') {
    return -1
  }
  throw new Error('余额方向仅支持“借”或“贷”')
}

const normalizeBoolean = (value: unknown, fieldName: string): boolean => {
  const normalized = String(value ?? '').trim()
  if (normalized === '' || normalized === '否' || normalized === 'false' || normalized === '0') {
    return false
  }
  if (normalized === '是' || normalized === 'true' || normalized === '1') {
    return true
  }
  throw new Error(`${fieldName}仅支持“是”或“否”`)
}

const normalizeSortOrder = (value: unknown, fallback: number): number => {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return fallback
  }
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('排序号必须为正整数')
  }
  return parsed
}

const compareByCode = (left: { code: string }, right: { code: string }): number => {
  const leftCode = left.code.trim()
  const rightCode = right.code.trim()
  if (!leftCode && !rightCode) return 0
  if (!leftCode) return 1
  if (!rightCode) return -1
  return leftCode.localeCompare(rightCode, 'zh-CN')
}

const requiresCarryForwardTarget = (
  standardType: AccountingStandardType,
  category: SubjectCategory
): boolean => getCarryForwardSourceCategories(standardType).includes(category)

const getCarryForwardTargetReferences = (
  standardType: AccountingStandardType
): StandardTopLevelSubjectReference[] => {
  const allowedCategories = new Set(getCarryForwardTargetCategories(standardType))
  return getStandardTopLevelSubjectReferences(standardType).filter((item) =>
    allowedCategories.has(item.category)
  )
}

const formatCarryForwardTargetOption = (
  reference: Pick<StandardTopLevelSubjectReference, 'code' | 'name'>
): string => `${reference.code} ${reference.name}`

const normalizeCarryForwardTargetCode = (
  standardType: AccountingStandardType,
  category: SubjectCategory,
  value: unknown
): string | null => {
  const normalized = normalizeOptionalText(value)
  if (!requiresCarryForwardTarget(standardType, category)) {
    return null
  }
  if (!normalized) {
    throw new Error(
      standardType === 'npo'
        ? '民非收入或费用类科目必须指定期末结转目标科目'
        : '损益类科目必须指定期末结转目标科目'
    )
  }

  const carryForwardTargets = getCarryForwardTargetReferences(standardType)
  const matchedReference = carryForwardTargets.find(
    (item) =>
      normalized === item.code ||
      normalized === item.name ||
      normalized === formatCarryForwardTargetOption(item)
  )
  const candidateCode =
    matchedReference?.code ?? normalized.match(/^(\d{4})(?:\s+.+)?$/)?.[1] ?? normalized

  if (!/^\d{4}$/.test(candidateCode)) {
    throw new Error('期末结转目标科目必须为 4 位数字编码')
  }
  return candidateCode
}

const normalizeTemplateEntry = (
  standardType: AccountingStandardType,
  entry: Partial<CustomTopLevelSubjectTemplateEntry>,
  index: number
): CustomTopLevelSubjectTemplateEntry => {
  const code = normalizeSubjectCode(entry.code)
  const category = normalizeCategory(standardType, entry.category)

  return {
    code,
    name: normalizeRequiredText(entry.name, '科目名称'),
    category,
    balanceDirection: normalizeBalanceDirection(entry.balanceDirection),
    isCashFlow: typeof entry.isCashFlow === 'boolean' ? entry.isCashFlow : normalizeBoolean(entry.isCashFlow, '是否现金科目'),
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : normalizeBoolean(entry.enabled, '是否启用'),
    sortOrder: normalizeSortOrder(entry.sortOrder, index + 1),
    carryForwardTargetCode: normalizeCarryForwardTargetCode(
      standardType,
      category,
      entry.carryForwardTargetCode
    ),
    note: normalizeOptionalText(entry.note)
  }
}

const assertUniqueCodes = (entries: CustomTopLevelSubjectTemplateEntry[]): void => {
  const codeSet = new Set<string>()
  for (const entry of entries) {
    if (codeSet.has(entry.code)) {
      throw new Error(`科目编码 ${entry.code} 在导入模板中重复`)
    }
    codeSet.add(entry.code)
  }
}

const sortEntriesByCode = (
  entries: CustomTopLevelSubjectTemplateEntry[]
): CustomTopLevelSubjectTemplateEntry[] =>
  entries
    .slice()
    .sort(compareByCode)
    .map((entry, index) => ({
      ...entry,
      sortOrder: index + 1
    }))

const buildStoredPayload = (
  standardType: AccountingStandardType,
  templateName: string,
  templateDescription: string | null,
  entries: CustomTopLevelSubjectTemplateEntry[]
): StoredSubjectTemplatePayload => ({
  version: TEMPLATE_VERSION,
  standardType,
  templateName: templateName.trim() || TEMPLATE_NAME_BY_STANDARD[standardType],
  templateDescription: normalizeOptionalText(templateDescription),
  updatedAt: new Date().toISOString(),
  entries: sortEntriesByCode(entries)
})

const normalizeStoredPayload = (
  standardType: AccountingStandardType,
  payload: unknown
): CustomTopLevelSubjectTemplate => {
  const source = typeof payload === 'object' && payload ? (payload as Partial<StoredSubjectTemplatePayload>) : {}
  const entries = Array.isArray(source.entries)
    ? source.entries.map((entry, index) =>
        normalizeTemplateEntry(
          standardType,
          entry as Partial<CustomTopLevelSubjectTemplateEntry>,
          index
        )
      )
    : []
  assertUniqueCodes(entries)

  return {
    standardType,
    templateName: normalizeOptionalText(source.templateName) ?? TEMPLATE_NAME_BY_STANDARD[standardType],
    templateDescription: normalizeOptionalText(source.templateDescription),
    updatedAt: normalizeOptionalText(source.updatedAt),
    entryCount: entries.length,
    entries: sortEntriesByCode(entries)
  }
}

export const getStandardTopLevelSubjectReferences = (
  standardType: AccountingStandardType
): StandardTopLevelSubjectReference[] =>
  (standardType === 'npo' ? NPO_SUBJECTS : ENTERPRISE_SUBJECTS)
    .filter((subject) => !subject.parent_code)
    .map((subject) => {
      const categoryOption = CATEGORY_OPTIONS[standardType].find(
        (option) => option.value === subject.category
      )
      return {
        code: subject.code,
        name: subject.name,
        category: subject.category,
        balanceDirection: subject.balance_direction as 1 | -1,
        categoryLabel: categoryOption?.label ?? subject.category,
        isCashFlow: Boolean(subject.is_cash_flow)
      }
    })
    .sort(compareByCode)

export const getCustomTopLevelSubjectTemplate = (
  db: Database.Database,
  standardType: AccountingStandardType
): CustomTopLevelSubjectTemplate => {
  const row = db
    .prepare('SELECT value FROM system_settings WHERE key = ?')
    .get(buildSettingKey(standardType)) as { value: string } | undefined

  if (!row?.value) {
    return {
      standardType,
      templateName: TEMPLATE_NAME_BY_STANDARD[standardType],
      templateDescription: null,
      updatedAt: null,
      entryCount: 0,
      entries: []
    }
  }

  try {
    return normalizeStoredPayload(standardType, JSON.parse(row.value))
  } catch {
    return {
      standardType,
      templateName: TEMPLATE_NAME_BY_STANDARD[standardType],
      templateDescription: null,
      updatedAt: null,
      entryCount: 0,
      entries: []
    }
  }
}

export const saveCustomTopLevelSubjectTemplate = (
  db: Database.Database,
  payload: {
    standardType: AccountingStandardType
    templateName?: string
    templateDescription?: string | null
    entries: Array<Partial<CustomTopLevelSubjectTemplateEntry>>
  }
): CustomTopLevelSubjectTemplate => {
  const normalizedEntries = payload.entries.map((entry, index) =>
    normalizeTemplateEntry(payload.standardType, entry, index)
  )
  assertUniqueCodes(normalizedEntries)

  const stored = buildStoredPayload(
    payload.standardType,
    payload.templateName ?? TEMPLATE_NAME_BY_STANDARD[payload.standardType],
    payload.templateDescription ?? null,
    normalizedEntries
  )

  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(buildSettingKey(payload.standardType), JSON.stringify(stored))

  return {
    standardType: payload.standardType,
    templateName: stored.templateName,
    templateDescription: stored.templateDescription,
    updatedAt: stored.updatedAt,
    entryCount: stored.entries.length,
    entries: sortEntriesByCode(stored.entries)
  }
}

export interface IndependentCustomSubjectTemplate {
  id: string
  baseStandardType: AccountingStandardType
  templateName: string
  templateDescription: string | null
  updatedAt: string
  entryCount: number
  entries: CustomTopLevelSubjectTemplateEntry[]
}

function createIndependentTemplateId(): string {
  return `custom-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readIndependentCustomTemplateCatalog(
  db: Database.Database
): StoredIndependentCustomTemplateCatalog {
  const row = db
    .prepare('SELECT value FROM system_settings WHERE key = ?')
    .get(INDEPENDENT_CUSTOM_TEMPLATE_SETTING_KEY) as { value: string } | undefined

  if (!row?.value) {
    return { version: TEMPLATE_VERSION, templates: [] }
  }

  try {
    const parsed = JSON.parse(row.value) as Partial<StoredIndependentCustomTemplateCatalog>
    return {
      version: TEMPLATE_VERSION,
      templates: Array.isArray(parsed.templates) ? parsed.templates : []
    }
  } catch {
    return { version: TEMPLATE_VERSION, templates: [] }
  }
}

function writeIndependentCustomTemplateCatalog(
  db: Database.Database,
  catalog: StoredIndependentCustomTemplateCatalog
): void {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(INDEPENDENT_CUSTOM_TEMPLATE_SETTING_KEY, JSON.stringify(catalog))
}

function normalizeIndependentCustomTemplate(
  payload: StoredIndependentCustomTemplatePayload
): IndependentCustomSubjectTemplate {
  const entries = sortEntriesByCode(
    (payload.entries ?? []).map((entry, index) => {
      return normalizeTemplateEntry(payload.baseStandardType, entry, index)
    })
  )

  return {
    id: payload.id,
    baseStandardType: payload.baseStandardType,
    templateName: normalizeRequiredText(payload.templateName, '模板名称'),
    templateDescription: normalizeOptionalText(payload.templateDescription),
    updatedAt: payload.updatedAt,
    entryCount: entries.length,
    entries
  }
}

export function listIndependentCustomSubjectTemplates(
  db: Database.Database
): IndependentCustomSubjectTemplate[] {
  const catalog = readIndependentCustomTemplateCatalog(db)
  return catalog.templates
    .map((template) => normalizeIndependentCustomTemplate(template))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function getIndependentCustomSubjectTemplate(
  db: Database.Database,
  templateId: string
): IndependentCustomSubjectTemplate | null {
  const catalog = readIndependentCustomTemplateCatalog(db)
  const found = catalog.templates.find((template) => template.id === templateId)
  return found ? normalizeIndependentCustomTemplate(found) : null
}

export function saveIndependentCustomSubjectTemplate(
  db: Database.Database,
  payload: {
    templateId?: string
    baseStandardType: AccountingStandardType
    templateName: string
    templateDescription?: string | null
    entries: Array<Partial<CustomTopLevelSubjectTemplateEntry>>
  }
): IndependentCustomSubjectTemplate {
  const normalizedEntries = sortEntriesByCode(
    payload.entries.map((entry, index) => {
      return normalizeTemplateEntry(payload.baseStandardType, entry, index)
    })
  )
  assertUniqueCodes(normalizedEntries)

  const catalog = readIndependentCustomTemplateCatalog(db)
  const templateId = payload.templateId ?? createIndependentTemplateId()
  const nextTemplate: StoredIndependentCustomTemplatePayload = {
    id: templateId,
    baseStandardType: payload.baseStandardType,
    templateName: normalizeRequiredText(payload.templateName, '模板名称'),
    templateDescription: normalizeOptionalText(payload.templateDescription),
    updatedAt: new Date().toISOString(),
    entries: normalizedEntries
  }

  const nextTemplates = catalog.templates.filter((template) => template.id !== templateId)
  nextTemplates.push(nextTemplate)
  writeIndependentCustomTemplateCatalog(db, {
    version: TEMPLATE_VERSION,
    templates: nextTemplates
  })

  return normalizeIndependentCustomTemplate(nextTemplate)
}

export function clearIndependentCustomSubjectTemplateEntries(
  db: Database.Database,
  templateId: string
): IndependentCustomSubjectTemplate {
  const catalog = readIndependentCustomTemplateCatalog(db)
  const current = catalog.templates.find((template) => template.id === templateId)
  if (!current) {
    throw new Error('自定义模板不存在')
  }

  const clearedTemplate: StoredIndependentCustomTemplatePayload = {
    ...current,
    updatedAt: new Date().toISOString(),
    entries: []
  }

  const nextTemplates = catalog.templates.map((template) =>
    template.id === templateId ? clearedTemplate : template
  )
  writeIndependentCustomTemplateCatalog(db, {
    version: TEMPLATE_VERSION,
    templates: nextTemplates
  })

  return normalizeIndependentCustomTemplate(clearedTemplate)
}

export function deleteIndependentCustomSubjectTemplate(
  db: Database.Database,
  templateId: string
): IndependentCustomSubjectTemplate {
  const catalog = readIndependentCustomTemplateCatalog(db)
  const current = catalog.templates.find((template) => template.id === templateId)
  if (!current) {
    throw new Error('自定义模板不存在')
  }

  const nextTemplates = catalog.templates.filter((template) => template.id !== templateId)
  writeIndependentCustomTemplateCatalog(db, {
    version: TEMPLATE_VERSION,
    templates: nextTemplates
  })

  return normalizeIndependentCustomTemplate(current)
}

export const clearCustomTopLevelSubjectTemplate = (
  db: Database.Database,
  standardType: AccountingStandardType
): void => {
  db.prepare('DELETE FROM system_settings WHERE key = ?').run(buildSettingKey(standardType))
}

export const applyCustomTopLevelSubjectTemplate = (
  db: Database.Database,
  ledgerId: number,
  standardType: AccountingStandardType
): number => {
  const template = getCustomTopLevelSubjectTemplate(db, standardType)
  if (template.entryCount === 0) {
    return 0
  }

  const insertSubject = db.prepare(
    `INSERT OR IGNORE INTO subjects
      (ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system)
     VALUES (?, ?, ?, NULL, ?, ?, 0, ?, 1, 0)`
  )
  const updateSubject = db.prepare(
    `UPDATE subjects
        SET name = ?, category = ?, balance_direction = ?, is_cash_flow = ?
      WHERE ledger_id = ? AND code = ?`
  )
  const selectSubject = db.prepare(
    `SELECT id, is_system
       FROM subjects
      WHERE ledger_id = ? AND code = ?
      LIMIT 1`
  )
  const selectCarryForwardRule = db.prepare(
    `SELECT id
       FROM pl_carry_forward_rules
      WHERE ledger_id = ? AND from_subject_code = ?
      LIMIT 1`
  )
  const deleteCarryForwardRule = db.prepare(
    `DELETE FROM pl_carry_forward_rules
      WHERE ledger_id = ? AND from_subject_code = ?`
  )
  const insertCarryForwardRule = db.prepare(
    `INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code)
     VALUES (?, ?, ?)`
  )

  let appliedCount = 0
  const enabledEntries = template.entries.filter((entry) => entry.enabled)
  for (const entry of enabledEntries) {
    const existingSubject = selectSubject.get(ledgerId, entry.code) as
      | { id: number; is_system: number }
      | undefined

    if (existingSubject) {
      updateSubject.run(
        entry.name,
        entry.category,
        entry.balanceDirection,
        entry.isCashFlow ? 1 : 0,
        ledgerId,
        entry.code
      )
      appliedCount += 1
    } else {
      const result = insertSubject.run(
        ledgerId,
        entry.code,
        entry.name,
        entry.category,
        entry.balanceDirection,
        entry.isCashFlow ? 1 : 0
      )
      if (Number(result.changes ?? 0) > 0) {
        appliedCount += 1
      }
    }

    deleteCarryForwardRule.run(ledgerId, entry.code)

    if (!requiresCarryForwardTarget(standardType, entry.category) || !entry.carryForwardTargetCode) {
      continue
    }

    const existingRule = selectCarryForwardRule.get(ledgerId, entry.code)
    if (!existingRule) {
      insertCarryForwardRule.run(ledgerId, entry.code, entry.carryForwardTargetCode)
    }
  }

  return appliedCount
}

export const writeCustomTopLevelSubjectImportTemplate = async (
  filePath: string,
  standardType: AccountingStandardType
): Promise<string> => {
  const workbook = new ExcelJS.Workbook()
  const instructionSheet = workbook.addWorksheet('导入说明')
  instructionSheet.addRow([IMPORT_TEMPLATE_NAME_BY_STANDARD[standardType]])
  instructionSheet.addRow([`适用账套类型：${standardType}`])
  instructionSheet.addRow(['仅支持导入一级科目，科目编码为 4 位数字。'])
  instructionSheet.addRow(['科目类别请直接使用下拉框选择中文类别，导入时系统会自动映射到内部分类编码。'])
  instructionSheet.addRow(['余额方向填写“借”或“贷”；是否字段填写“是”或“否”。'])
  instructionSheet.addRow(['损益类/收入类/费用类科目必须通过下拉选择期末结转目标科目，显示内容为“科目代码 + 科目名称”，导入时系统会自动转译为内部科目代码。'])
  instructionSheet.addRow(['可参考“填写示例”工作表中的样例，再将自己的正式数据填写到“一级科目模板”工作表。'])
  instructionSheet.columns = [{ width: 72 }]

  const templateSheet = workbook.addWorksheet('一级科目模板')
  templateSheet.addRow([IMPORT_TEMPLATE_NAME_BY_STANDARD[standardType]])
  templateSheet.addRow([...TEMPLATE_HEADERS])
  templateSheet.columns = TEMPLATE_HEADERS.map(() => ({ width: 18 }))

  const optionSheet = workbook.addWorksheet(OPTION_SHEET_NAME)
  const carryForwardTargets = getCarryForwardTargetReferences(standardType)

  CATEGORY_OPTIONS[standardType].forEach((option, index) => {
    optionSheet.getCell(`A${index + 1}`).value = option.label
  })
  ;['借', '贷'].forEach((value, index) => {
    optionSheet.getCell(`B${index + 1}`).value = value
  })
  ;['是', '否'].forEach((value, index) => {
    optionSheet.getCell(`C${index + 1}`).value = value
    optionSheet.getCell(`D${index + 1}`).value = value
  })
  carryForwardTargets.forEach((value, index) => {
    optionSheet.getCell(`E${index + 1}`).value = formatCarryForwardTargetOption(value)
  })
  optionSheet.state = 'veryHidden'

  const categoryListFormula = `'${OPTION_SHEET_NAME}'!$A$1:$A$${CATEGORY_OPTIONS[standardType].length}`
  const balanceDirectionFormula = `'${OPTION_SHEET_NAME}'!$B$1:$B$2`
  const booleanFormula = `'${OPTION_SHEET_NAME}'!$C$1:$C$2`
  const enabledFormula = `'${OPTION_SHEET_NAME}'!$D$1:$D$2`
  const carryForwardFormula = `'${OPTION_SHEET_NAME}'!$E$1:$E$${Math.max(carryForwardTargets.length, 1)}`
  for (let rowNumber = 3; rowNumber <= 200; rowNumber += 1) {
    templateSheet.getCell(`C${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [categoryListFormula]
    }
    templateSheet.getCell(`D${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [balanceDirectionFormula]
    }
    templateSheet.getCell(`E${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [booleanFormula]
    }
    templateSheet.getCell(`F${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [enabledFormula]
    }
    templateSheet.getCell(`G${rowNumber}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [carryForwardFormula]
    }
  }

  const exampleSheet = workbook.addWorksheet('填写示例')
  exampleSheet.addRow([`${IMPORT_TEMPLATE_NAME_BY_STANDARD[standardType]}示例`])
  exampleSheet.addRow([...TEMPLATE_HEADERS])
  for (const entry of TEMPLATE_EXAMPLES[standardType]) {
    exampleSheet.addRow([
      entry.code,
      entry.name,
      CATEGORY_OPTIONS[standardType].find((option) => option.value === entry.category)?.label ??
      entry.category,
      entry.balanceDirection === 1 ? '借' : '贷',
      entry.isCashFlow ? '是' : '否',
      entry.enabled ? '是' : '否',
      entry.carryForwardTargetCode
        ? formatCarryForwardTargetOption({
            code: entry.carryForwardTargetCode,
            name:
              getCarryForwardTargetReferences(standardType).find(
                (item) => item.code === entry.carryForwardTargetCode
              )?.name ?? ''
          }).trim()
        : '',
      entry.note ?? ''
    ])
  }
  exampleSheet.columns = TEMPLATE_HEADERS.map(() => ({ width: 22 }))

  ensureDirectory(path.dirname(filePath))
  await workbook.xlsx.writeFile(filePath)
  return filePath
}

export const readCustomTopLevelSubjectTemplateImport = async (
  filePath: string,
  standardType: AccountingStandardType
): Promise<CustomTopLevelSubjectTemplate> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const templateSheet = workbook.getWorksheet('一级科目模板')
  if (!templateSheet) {
    throw new Error('导入文件缺少“一级科目模板”工作表')
  }

  const entries: CustomTopLevelSubjectTemplateEntry[] = []
  for (let rowNumber = 3; rowNumber <= templateSheet.rowCount; rowNumber += 1) {
    const row = templateSheet.getRow(rowNumber)
    const values = Array.from({ length: TEMPLATE_HEADERS.length }, (_, index) =>
      row.getCell(index + 1).text.trim()
    )

    if (values.every((value) => value === '')) {
      continue
    }

    entries.push(
      normalizeTemplateEntry(
        standardType,
        {
          code: values[0],
          name: values[1],
          category: values[2] as SubjectCategory,
          balanceDirection: values[3] as unknown as 1 | -1,
          isCashFlow: values[4] as unknown as boolean,
          enabled: values[5] as unknown as boolean,
          sortOrder: entries.length + 1,
          carryForwardTargetCode: values[6],
          note: values[7]
        },
        entries.length
      )
    )
  }

  assertUniqueCodes(entries)

  return {
    standardType,
    templateName: IMPORT_TEMPLATE_NAME_BY_STANDARD[standardType],
    templateDescription: null,
    updatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: sortEntriesByCode(entries)
  }
}

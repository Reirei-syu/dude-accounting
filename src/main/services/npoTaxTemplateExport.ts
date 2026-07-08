import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type Database from 'better-sqlite3'
import {
  buildReportSnapshotContentForExport,
  type ReportSnapshotContent,
  type ReportSnapshotTableRow
} from './reporting'

export type TaxTemplateDeclarationType = 'monthly' | 'quarterly' | 'annual'

export interface ResolveNpoTaxTemplatePeriodInput {
  declarationType: TaxTemplateDeclarationType
  year: number
  month?: number
  quarter?: number
}

export interface NpoTaxTemplatePeriod {
  declarationType: TaxTemplateDeclarationType
  year: number
  month?: number
  quarter?: number
  startPeriod: string
  endPeriod: string
  startDate: string
  endDate: string
}

export interface ExportNpoTaxTemplateInput extends ResolveNpoTaxTemplatePeriodInput {
  ledgerId: number
  outputPath: string
  overwrite?: boolean
  templatePath?: string
  now?: string | Date
}

export interface ExportNpoTaxTemplateResult {
  filePath: string
  ledgerId: number
  declarationType: TaxTemplateDeclarationType
  startDate: string
  endDate: string
  templateVersion: string
}

interface TaxTemplateLedgerRow {
  id: number
  name: string
  standard_type: 'enterprise' | 'npo'
  start_period: string
  current_period: string
  taxpayer_identification_number: string
}

type FormulaCellValue = {
  formula?: string
  result?: unknown
}

export const NPO_TAX_TEMPLATE_VERSION = 'npo-tax-template-v1'
export const TAX_TEMPLATE_OUTPUT_DIR_PREFERENCE_KEY = 'tax_template_export_last_dir'

const REQUIRED_SHEETS = ['资产负债表', '业务活动表', '现金流量表'] as const
const MONEY_SCALE = 100
const WSL_DRIVE_PATH_PATTERN = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    throw new Error('申报年度不合法')
  }
}

function getMonthEndDate(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function periodOf(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function toWindowsSeparators(value: string): string {
  return value.replace(/\//g, '\\')
}

export function normalizeTaxTemplateOutputPath(filePath: string): string {
  if (process.platform !== 'win32') {
    return filePath
  }

  const driveMatch = filePath.match(WSL_DRIVE_PATH_PATTERN)
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase()
    const rest = driveMatch[2] ? toWindowsSeparators(driveMatch[2]) : ''
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`
  }

  const distroName = process.env.DUDEACC_WSL_DISTRO_NAME?.trim()
  if (distroName && filePath.startsWith('/') && !filePath.startsWith('//')) {
    return `\\\\wsl.localhost\\${distroName}${toWindowsSeparators(filePath)}`
  }

  return filePath
}

export function resolveNpoTaxTemplatePeriod(
  input: ResolveNpoTaxTemplatePeriodInput
): NpoTaxTemplatePeriod {
  assertYear(input.year)

  if (input.declarationType === 'monthly') {
    const month = input.month
    if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('月报需要指定 1-12 的月份')
    }

    return {
      declarationType: input.declarationType,
      year: input.year,
      month,
      startPeriod: periodOf(input.year, month),
      endPeriod: periodOf(input.year, month),
      startDate: `${periodOf(input.year, month)}-01`,
      endDate: getMonthEndDate(input.year, month)
    }
  }

  if (input.declarationType === 'quarterly') {
    const quarter = input.quarter
    if (typeof quarter !== 'number' || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      throw new Error('季报需要指定 1-4 的季度')
    }
    const startMonth = (quarter - 1) * 3 + 1
    const endMonth = startMonth + 2

    return {
      declarationType: input.declarationType,
      year: input.year,
      quarter,
      startPeriod: periodOf(input.year, startMonth),
      endPeriod: periodOf(input.year, endMonth),
      startDate: `${periodOf(input.year, startMonth)}-01`,
      endDate: getMonthEndDate(input.year, endMonth)
    }
  }

  if (input.declarationType === 'annual') {
    return {
      declarationType: input.declarationType,
      year: input.year,
      startPeriod: `${input.year}-01`,
      endPeriod: `${input.year}-12`,
      startDate: `${input.year}-01-01`,
      endDate: `${input.year}-12-31`
    }
  }

  throw new Error('申报类型不合法')
}

export function getDefaultTaxTemplateOutputDir(documentsPath: string): string {
  return path.join(documentsPath, 'Dude Accounting', '税务模板')
}

export function getPreferredTaxTemplateOutputDir(
  db: Database.Database,
  userId: number,
  documentsPath: string
): string {
  const row = db
    .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(userId, TAX_TEMPLATE_OUTPUT_DIR_PREFERENCE_KEY) as { value: string } | undefined

  return row?.value || getDefaultTaxTemplateOutputDir(documentsPath)
}

export function rememberTaxTemplateOutputDir(
  db: Database.Database,
  userId: number,
  directoryPath: string
): void {
  writeTaxTemplateOutputDirPreference(db, userId, directoryPath)
}

export function rememberTaxTemplateOutputDirectory(
  db: Database.Database,
  userId: number,
  directoryPath: string
): void {
  writeTaxTemplateOutputDirPreference(db, userId, directoryPath)
}

export function rememberTaxTemplateOutputFile(
  db: Database.Database,
  userId: number,
  filePath: string
): void {
  writeTaxTemplateOutputDirPreference(db, userId, path.dirname(filePath))
}

function writeTaxTemplateOutputDirPreference(
  db: Database.Database,
  userId: number,
  directoryPath: string
): void {
  db.prepare(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, TAX_TEMPLATE_OUTPUT_DIR_PREFERENCE_KEY, directoryPath)
}

function resolveTemplatePath(templatePath?: string): string {
  if (templatePath) {
    return templatePath
  }

  const runtimeResourcesPath = (process as typeof process & { resourcesPath?: string }).resourcesPath
  const relativePath = path.join('resources', 'tax-templates', 'npo', 'npo-tax-template-v1.xlsx')
  const candidates = [
    path.join(process.cwd(), relativePath),
    runtimeResourcesPath ? path.join(runtimeResourcesPath, relativePath) : '',
    runtimeResourcesPath
      ? path.join(runtimeResourcesPath, 'app.asar.unpacked', relativePath)
      : '',
    path.resolve(__dirname, '..', '..', '..', relativePath)
  ].filter(Boolean)

  const matchedPath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!matchedPath) {
    throw new Error('未找到民非税务模板资源')
  }
  return matchedPath
}

function getTaxTemplateLedger(db: Database.Database, ledgerId: number): TaxTemplateLedgerRow {
  const ledger = db
    .prepare(
      `SELECT id, name, standard_type, start_period, current_period, taxpayer_identification_number
       FROM ledgers
       WHERE id = ?`
    )
    .get(ledgerId) as TaxTemplateLedgerRow | undefined

  if (!ledger) {
    throw new Error('账套不存在')
  }
  if (ledger.standard_type !== 'npo') {
    throw new Error('税务模板仅支持民间非营利组织账套')
  }
  if (!ledger.name.trim()) {
    throw new Error('纳税人名称不能为空')
  }
  if (!ledger.taxpayer_identification_number.trim()) {
    throw new Error('纳税人识别号不能为空')
  }

  return {
    ...ledger,
    name: ledger.name.trim(),
    taxpayer_identification_number: ledger.taxpayer_identification_number.trim()
  }
}

function cellHasFormula(cell: ExcelJS.Cell): boolean {
  const value = cell.value as FormulaCellValue | null
  return typeof value === 'object' && value !== null && typeof value.formula === 'string'
}

function setAmountCell(cell: ExcelJS.Cell, amountCents: number | null | undefined): void {
  if (cellHasFormula(cell)) {
    return
  }
  cell.value = roundCurrency((amountCents ?? 0) / MONEY_SCALE)
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getCellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((item) => item.text).join('')
    if ('text' in value) return String(value.text)
    if ('result' in value && value.result !== undefined) return String(value.result)
    if ('formula' in value) return String(value.formula)
  }
  return String(value)
}

function normalizeLabel(label: string): string {
  return label
    .replace(/\s+/g, '')
    .replace(/^（[一二三四五六七八九十]+）/, '')
    .replace(/[()（）]/g, '')
    .replace(/^[一二三四五六七八九十]+[、.．]/, '')
    .replace(/^其中[:：]/, '')
    .replace(/[：:]+$/, '')
    .replace(/[，,、]/g, '')
}

function tableRowsByLabel(content: ReportSnapshotContent): Map<string, ReportSnapshotTableRow> {
  const map = new Map<string, ReportSnapshotTableRow>()
  for (const table of content.tables ?? []) {
    for (const row of table.rows) {
      const label = row.cells[0]?.value
      if (typeof label !== 'string' || !label.trim()) {
        continue
      }
      map.set(normalizeLabel(label), row)
    }
  }
  return map
}

function getAmount(row: ReportSnapshotTableRow | undefined, cellIndex: number): number {
  const value = row?.cells[cellIndex]?.value
  return typeof value === 'number' ? value : 0
}

function getMappedRow(
  map: Map<string, ReportSnapshotTableRow>,
  label: string,
  aliases: Map<string, string>
): ReportSnapshotTableRow | undefined {
  const key = normalizeLabel(label)
  return map.get(aliases.get(key) ?? key)
}

function assertSheetText(sheet: ExcelJS.Worksheet, address: string, expected: string): void {
  if (!getCellText(sheet.getCell(address)).includes(expected)) {
    throw new Error(`税务模板结构不匹配：${sheet.name}!${address}`)
  }
}

function validateTemplate(workbook: ExcelJS.Workbook): {
  balanceSheet: ExcelJS.Worksheet
  activitySheet: ExcelJS.Worksheet
  cashflowSheet: ExcelJS.Worksheet
} {
  const missingSheet = REQUIRED_SHEETS.find((sheetName) => !workbook.getWorksheet(sheetName))
  if (missingSheet) {
    throw new Error(`税务模板结构不匹配：缺少 ${missingSheet}`)
  }

  const balanceSheet = workbook.getWorksheet('资产负债表')!
  const activitySheet = workbook.getWorksheet('业务活动表')!
  const cashflowSheet = workbook.getWorksheet('现金流量表')!

  assertSheetText(balanceSheet, 'B3', '纳税人识别号')
  assertSheetText(balanceSheet, 'F3', '纳税人名称')
  assertSheetText(balanceSheet, 'B4', '所属期起')
  assertSheetText(balanceSheet, 'F4', '所属期止')
  assertSheetText(activitySheet, 'B10', '提供服务收入')
  assertSheetText(cashflowSheet, 'B10', '提供服务收到的现金')

  return { balanceSheet, activitySheet, cashflowSheet }
}

function fillIdentity(
  balanceSheet: ExcelJS.Worksheet,
  ledger: TaxTemplateLedgerRow,
  period: NpoTaxTemplatePeriod
): void {
  balanceSheet.getCell('C3').value = ledger.taxpayer_identification_number
  balanceSheet.getCell('G3').value = ledger.name
  balanceSheet.getCell('C4').value = period.startDate
  balanceSheet.getCell('G4').value = period.endDate
}

function setFormulaResult(cell: ExcelJS.Cell, result: string): void {
  const value = cell.value as FormulaCellValue | null
  if (typeof value === 'object' && value !== null && typeof value.formula === 'string') {
    const formulaValue = value as ExcelJS.CellFormulaValue
    cell.value = {
      ...formulaValue,
      result
    }
  }
}

function refreshIdentityFormulaCaches(
  activitySheet: ExcelJS.Worksheet,
  cashflowSheet: ExcelJS.Worksheet,
  ledger: TaxTemplateLedgerRow,
  period: NpoTaxTemplatePeriod
): void {
  setFormulaResult(activitySheet.getCell('C3'), ledger.taxpayer_identification_number)
  setFormulaResult(activitySheet.getCell('G3'), ledger.name)
  setFormulaResult(activitySheet.getCell('C4'), period.startDate)
  setFormulaResult(activitySheet.getCell('G4'), period.endDate)
  setFormulaResult(cashflowSheet.getCell('C3'), ledger.taxpayer_identification_number)
  setFormulaResult(cashflowSheet.getCell('C4'), ledger.name)
  setFormulaResult(cashflowSheet.getCell('C5'), period.startDate)
  setFormulaResult(cashflowSheet.getCell('E5'), period.endDate)
}

function fillBalanceSheet(
  sheet: ExcelJS.Worksheet,
  content: ReportSnapshotContent,
  aliases: Map<string, string>
): void {
  const rows = tableRowsByLabel(content)
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const leftRow = getMappedRow(rows, getCellText(sheet.getCell(`B${rowNumber}`)), aliases)
    if (leftRow) {
      setAmountCell(sheet.getCell(`D${rowNumber}`), getAmount(leftRow, 1))
      setAmountCell(sheet.getCell(`E${rowNumber}`), getAmount(leftRow, 2))
    }

    const rightRow = getMappedRow(rows, getCellText(sheet.getCell(`F${rowNumber}`)), aliases)
    if (rightRow) {
      setAmountCell(sheet.getCell(`H${rowNumber}`), getAmount(rightRow, 4))
      setAmountCell(sheet.getCell(`I${rowNumber}`), getAmount(rightRow, 5))
    }
  }
}

function fillActivitySheet(
  sheet: ExcelJS.Worksheet,
  content: ReportSnapshotContent,
  aliases: Map<string, string>
): void {
  const rows = tableRowsByLabel(content)
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const label = getCellText(sheet.getCell(`B${rowNumber}`))
    const row = getMappedRow(rows, label, aliases)
    if (!row) {
      continue
    }
    setAmountCell(sheet.getCell(`D${rowNumber}`), getAmount(row, 1))
    setAmountCell(sheet.getCell(`E${rowNumber}`), getAmount(row, 2))
    setAmountCell(sheet.getCell(`G${rowNumber}`), getAmount(row, 4))
    setAmountCell(sheet.getCell(`H${rowNumber}`), getAmount(row, 5))
  }
}

function fillCashflowSheet(
  sheet: ExcelJS.Worksheet,
  content: ReportSnapshotContent,
  aliases: Map<string, string>
): void {
  const rows = tableRowsByLabel(content)
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = getMappedRow(rows, getCellText(sheet.getCell(`B${rowNumber}`)), aliases)
    if (!row) {
      continue
    }
    setAmountCell(sheet.getCell(`E${rowNumber}`), getAmount(row, 1))
  }
}

function buildLabelAliases(): Map<string, string> {
  const aliases = new Map<string, string>()
  const set = (fromTemplate: string, toReport: string): void => {
    aliases.set(normalizeLabel(fromTemplate), normalizeLabel(toReport))
  }

  set('一年内到期的长期债权投资', '一年内到期的长期投资')
  set('文物文化资产', '文物资源')
  set('无形资产', '无形资产净值')
  set('应付工资', '应付职工薪酬')
  set('应交税金', '应交税费')
  set('预计负债', '预计负债')
  set('限定性净资产转为非限定性净资产', '限定性净资产转为非限定性净资产')
  set('净资产变动额若为净资产减少额以“-”号填列', '净资产变动额减少以“-”号填列')
  set('处置固定资产和无形资产所收回的现金', '处置固定资产、无形资产和其他非流动资产收回的现金')
  set('购建固定资产和无形资产所支付的现金', '购建固定资产、无形资产和其他非流动资产支付的现金')
  set('四、汇率变动对现金的影响额', '汇率变动对现金及现金等价物的影响')

  return aliases
}

function setWorkbookRecalculation(workbook: ExcelJS.Workbook): void {
  const mutableWorkbook = workbook as ExcelJS.Workbook & {
    calcProperties?: {
      fullCalcOnLoad?: boolean
      forceFullCalc?: boolean
    }
  }
  mutableWorkbook.calcProperties = {
    ...(mutableWorkbook.calcProperties ?? {}),
    fullCalcOnLoad: true,
    forceFullCalc: true
  }
}

export function buildNpoTaxTemplateFileName(
  ledgerName: string,
  period: NpoTaxTemplatePeriod
): string {
  const declarationLabel =
    period.declarationType === 'monthly'
      ? `${period.year}年${period.month}月`
      : period.declarationType === 'quarterly'
        ? `${period.year}年第${period.quarter}季度`
        : `${period.year}年年报`
  const safeLedgerName = ledgerName.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
  return `${safeLedgerName}_税务模板_${declarationLabel}_${period.startDate}_${period.endDate}.xlsx`
}

export function buildUniqueTaxTemplateOutputPath(directoryPath: string, fileName: string): string {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name} (${index})${parsed.ext}`)
    index += 1
  }
  return candidate
}

export async function exportNpoTaxTemplate(
  db: Database.Database,
  input: ExportNpoTaxTemplateInput
): Promise<ExportNpoTaxTemplateResult> {
  const ledger = getTaxTemplateLedger(db, input.ledgerId)
  const period = resolveNpoTaxTemplatePeriod(input)
  const outputPath = path.resolve(normalizeTaxTemplateOutputPath(input.outputPath))

  if (path.extname(outputPath).toLowerCase() !== '.xlsx') {
    throw new Error('税务模板输出路径必须是 .xlsx 文件')
  }
  if (!input.overwrite && fs.existsSync(outputPath)) {
    throw new Error('输出文件已存在，请更换文件名或启用覆盖')
  }

  const generatedAt = input.now ?? new Date()
  const balanceContent = buildReportSnapshotContentForExport(db, {
    ledgerId: input.ledgerId,
    reportType: 'balance_sheet',
    month: period.endPeriod,
    includeUnpostedVouchers: false,
    now: generatedAt
  })
  const activityContent = buildReportSnapshotContentForExport(
    db,
    {
      ledgerId: input.ledgerId,
      reportType: 'activity_statement',
      startPeriod: period.startPeriod,
      endPeriod: period.endPeriod,
      includeUnpostedVouchers: false,
      now: generatedAt
    },
    { activityCurrentPeriod: null }
  )
  const cashflowContent = buildReportSnapshotContentForExport(db, {
    ledgerId: input.ledgerId,
    reportType: 'cashflow_statement',
    startPeriod: period.startPeriod,
    endPeriod: period.endPeriod,
    includeUnpostedVouchers: false,
    now: generatedAt
  })

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(resolveTemplatePath(input.templatePath))
  const { balanceSheet, activitySheet, cashflowSheet } = validateTemplate(workbook)
  const aliases = buildLabelAliases()

  fillIdentity(balanceSheet, ledger, period)
  refreshIdentityFormulaCaches(activitySheet, cashflowSheet, ledger, period)
  fillBalanceSheet(balanceSheet, balanceContent, aliases)
  fillActivitySheet(activitySheet, activityContent, aliases)
  fillCashflowSheet(cashflowSheet, cashflowContent, aliases)
  setWorkbookRecalculation(workbook)

  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  await workbook.xlsx.writeFile(outputPath)

  return {
    filePath: outputPath,
    ledgerId: input.ledgerId,
    declarationType: input.declarationType,
    startDate: period.startDate,
    endDate: period.endDate,
    templateVersion: NPO_TAX_TEMPLATE_VERSION
  }
}

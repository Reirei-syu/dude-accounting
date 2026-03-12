import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyCustomTopLevelSubjectTemplate,
  clearIndependentCustomSubjectTemplateEntries,
  deleteIndependentCustomSubjectTemplate,
  getCustomTopLevelSubjectTemplate,
  getIndependentCustomSubjectTemplate,
  getStandardTopLevelSubjectReferences,
  listIndependentCustomSubjectTemplates,
  readCustomTopLevelSubjectTemplateImport,
  saveIndependentCustomSubjectTemplate,
  saveCustomTopLevelSubjectTemplate,
  writeCustomTopLevelSubjectImportTemplate
} from './subjectTemplate'

type SubjectRow = {
  id: number
  ledger_id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  balance_direction: number
  level: number
  is_system: number
}

type CarryForwardRuleRow = {
  id: number
  ledger_id: number
  from_subject_code: string
  to_subject_code: string
}

class FakeDatabase {
  settings = new Map<string, string>()
  subjects: SubjectRow[] = []
  carryForwardRules: CarryForwardRuleRow[] = []
  private nextSubjectId = 10
  private nextCarryForwardRuleId = 10

  prepare(sql: string): {
    get: (...params: unknown[]) => unknown
    run: (...params: unknown[]) => { changes?: number }
  } {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key) => {
          const value = this.settings.get(String(key))
          return value === undefined ? undefined : { value }
        },
        run: () => ({})
      }
    }

    if (
      normalized ===
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ) {
      return {
        get: () => undefined,
        run: (key, value) => {
          this.settings.set(String(key), String(value))
          return { changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM system_settings WHERE key = ?') {
      return {
        get: () => undefined,
        run: (key) => {
          const existed = this.settings.delete(String(key))
          return { changes: existed ? 1 : 0 }
        }
      }
    }

    if (
      normalized ===
      'INSERT OR IGNORE INTO subjects (ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, 1, 0)'
    ) {
      return {
        get: () => undefined,
        run: (ledgerId, code, name, category, balanceDirection, isCashFlow) => {
          const exists = this.subjects.some(
            (subject) =>
              subject.ledger_id === Number(ledgerId) && subject.code === String(code)
          )
          if (exists) {
            return { changes: 0 }
          }
          this.subjects.push({
            id: this.nextSubjectId++,
            ledger_id: Number(ledgerId),
            code: String(code),
            name: String(name),
            parent_code: null,
            category: String(category),
            balance_direction: Number(balanceDirection),
            level: 1,
            is_system: 0
          })
          void isCashFlow
          return { changes: 1 }
        }
      }
    }

    if (normalized === 'SELECT id, is_system FROM subjects WHERE ledger_id = ? AND code = ? LIMIT 1') {
      return {
        get: (ledgerId, code) =>
          this.subjects.find(
            (subject) =>
              subject.ledger_id === Number(ledgerId) && subject.code === String(code)
          ),
        run: () => ({})
      }
    }

    if (
      normalized ===
      'UPDATE subjects SET name = ?, category = ?, balance_direction = ?, is_cash_flow = ? WHERE ledger_id = ? AND code = ?'
    ) {
      return {
        get: () => undefined,
        run: (name, category, balanceDirection, isCashFlow, ledgerId, code) => {
          const row = this.subjects.find(
            (subject) =>
              subject.ledger_id === Number(ledgerId) && subject.code === String(code)
          )
          if (row) {
            row.name = String(name)
            row.category = String(category)
            row.balance_direction = Number(balanceDirection)
            void isCashFlow
          }
          return { changes: row ? 1 : 0 }
        }
      }
    }

    if (
      normalized ===
      'SELECT id FROM pl_carry_forward_rules WHERE ledger_id = ? AND from_subject_code = ? LIMIT 1'
    ) {
      return {
        get: (ledgerId, fromSubjectCode) =>
          this.carryForwardRules.find(
            (rule) =>
              rule.ledger_id === Number(ledgerId) &&
              rule.from_subject_code === String(fromSubjectCode)
          ),
        run: () => ({})
      }
    }

    if (
      normalized ===
      'INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code) VALUES (?, ?, ?)'
    ) {
      return {
        get: () => undefined,
        run: (ledgerId, fromSubjectCode, toSubjectCode) => {
          this.carryForwardRules.push({
            id: this.nextCarryForwardRuleId++,
            ledger_id: Number(ledgerId),
            from_subject_code: String(fromSubjectCode),
            to_subject_code: String(toSubjectCode)
          })
          return { changes: 1 }
        }
      }
    }

    if (normalized === 'DELETE FROM pl_carry_forward_rules WHERE ledger_id = ? AND from_subject_code = ?') {
      return {
        get: () => undefined,
        run: (ledgerId, fromSubjectCode) => {
          const before = this.carryForwardRules.length
          this.carryForwardRules = this.carryForwardRules.filter(
            (rule) =>
              !(
                rule.ledger_id === Number(ledgerId) &&
                rule.from_subject_code === String(fromSubjectCode)
              )
          )
          return { changes: before - this.carryForwardRules.length }
        }
      }
    }

    throw new Error(`Unhandled SQL in fake database: ${normalized}`)
  }

  close(): void {
    this.settings.clear()
  }
}

function createTestDb(): FakeDatabase {
  return new FakeDatabase()
}

describe('subject template service', () => {
  let db: FakeDatabase
  let tempDir: string | null = null

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(() => {
    db.close()
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = null
  })

  it('stores and reads enterprise custom top-level subject templates in system settings', () => {
    const saved = saveCustomTopLevelSubjectTemplate(db as never, {
      standardType: 'enterprise',
      templateName: '民营医院扩展',
      entries: [
        {
          code: '1619',
          name: '周转医疗设备',
          category: 'asset',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          sortOrder: 10,
          carryForwardTargetCode: null,
          note: '导入建议稿'
        },
        {
          code: '6608',
          name: '医疗业务成本',
          category: 'profit_loss',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          sortOrder: 20,
          carryForwardTargetCode: '4103',
          note: null
        }
      ]
    })

    expect(saved.templateName).toBe('民营医院扩展')
    expect(saved.entries).toHaveLength(2)
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    expect(getCustomTopLevelSubjectTemplate(db as never, 'enterprise')).toMatchObject({
      standardType: 'enterprise',
      templateName: '民营医院扩展',
      entryCount: 2,
      entries: [
        {
          code: '1619',
          name: '周转医疗设备',
          category: 'asset',
          balanceDirection: 1,
          sortOrder: 1
        },
        {
          code: '6608',
          name: '医疗业务成本',
          category: 'profit_loss',
          carryForwardTargetCode: '4103'
        }
      ]
    })
  })

  it('rejects duplicate top-level subject codes within the same template payload', () => {
    expect(() =>
      saveCustomTopLevelSubjectTemplate(db as never, {
        standardType: 'enterprise',
        templateName: '重复编码模板',
        entries: [
          {
            code: '1991',
            name: '示例一',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 10,
            carryForwardTargetCode: null,
            note: null
          },
          {
            code: '1991',
            name: '示例二',
            category: 'asset',
            balanceDirection: 1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 20,
            carryForwardTargetCode: null,
            note: null
          }
        ]
      })
    ).toThrow('科目编码 1991 在导入模板中重复')
  })

  it('allows saving overrides for built-in top-level subjects', () => {
    const saved = saveCustomTopLevelSubjectTemplate(db as never, {
      standardType: 'enterprise',
      templateName: '企业一级科目模板',
      entries: [
          {
            code: '1001',
            name: '库存现金-模板维护',
            category: '资产类' as never,
            balanceDirection: 1,
            isCashFlow: true,
            enabled: true,
          carryForwardTargetCode: null,
          note: '覆盖内置一级科目名称'
        }
      ]
    })

    expect(saved.entryCount).toBe(1)
    expect(saved.entries[0]).toMatchObject({
      code: '1001',
      name: '库存现金-模板维护',
      category: 'asset',
      isCashFlow: true
    })
  })

  it('stores independent custom templates separately from standard template overrides', () => {
    const saved = saveIndependentCustomSubjectTemplate(db as never, {
      baseStandardType: 'enterprise',
      templateName: '医院模板A',
      templateDescription: '门诊与住院扩展科目',
      entries: [
        {
          code: '1991',
          name: '医疗专项设备',
          category: 'asset',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          carryForwardTargetCode: null,
          note: '自定义模板新增'
        }
      ]
    })

    expect(saved.id).toContain('custom-template-')
    expect(saved.templateName).toBe('医院模板A')
    expect(saved.entryCount).toBe(1)
    expect(getCustomTopLevelSubjectTemplate(db as never, 'enterprise').entryCount).toBe(0)

    const list = listIndependentCustomSubjectTemplates(db as never)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: saved.id,
      baseStandardType: 'enterprise',
      templateName: '医院模板A',
      templateDescription: '门诊与住院扩展科目'
    })

    expect(getIndependentCustomSubjectTemplate(db as never, saved.id)?.entries[0]).toMatchObject({
      code: '1991',
      name: '医疗专项设备'
    })
  })

  it('clears only independently added subjects for a custom template', () => {
    const saved = saveIndependentCustomSubjectTemplate(db as never, {
      baseStandardType: 'npo',
      templateName: '慈善模板A',
      templateDescription: '公益募捐专项模板',
      entries: [
        {
          code: '4911',
          name: '专项筹款收入',
          category: 'income',
          balanceDirection: -1,
          isCashFlow: false,
          enabled: true,
          carryForwardTargetCode: '3102',
          note: null
        }
      ]
    })

    const cleared = clearIndependentCustomSubjectTemplateEntries(db as never, saved.id)
    expect(cleared.templateName).toBe('慈善模板A')
    expect(cleared.templateDescription).toBe('公益募捐专项模板')
    expect(cleared.entryCount).toBe(0)
    expect(cleared.entries).toEqual([])
  })

  it('deletes only independent custom templates without affecting system preset templates', () => {
    saveCustomTopLevelSubjectTemplate(db as never, {
      standardType: 'enterprise',
      templateName: '企业一级科目模板',
      entries: [
        {
          code: '1991',
          name: '医院专用设备',
          category: 'asset',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          sortOrder: 1,
          carryForwardTargetCode: null,
          note: null
        }
      ]
    })

    const customTemplate = saveIndependentCustomSubjectTemplate(db as never, {
      baseStandardType: 'enterprise',
      templateName: '医院模板B',
      templateDescription: '待删除模板',
      entries: [
        {
          code: '2991',
          name: '应付医护绩效',
          category: 'liability',
          balanceDirection: -1,
          isCashFlow: false,
          enabled: true,
          carryForwardTargetCode: null,
          note: null
        }
      ]
    })

    const deleted = deleteIndependentCustomSubjectTemplate(db as never, customTemplate.id)
    expect(deleted.id).toBe(customTemplate.id)
    expect(getIndependentCustomSubjectTemplate(db as never, customTemplate.id)).toBeNull()
    expect(listIndependentCustomSubjectTemplates(db as never)).toEqual([])
    expect(getCustomTopLevelSubjectTemplate(db as never, 'enterprise').entryCount).toBe(1)
  })

  it('requires NPO income and expense subjects to declare carry-forward targets', () => {
    expect(() =>
      saveCustomTopLevelSubjectTemplate(db as never, {
        standardType: 'npo',
        templateName: '慈善组织扩展',
        entries: [
          {
            code: '4911',
            name: '专项筹款收入',
            category: 'income',
            balanceDirection: -1,
            isCashFlow: false,
            enabled: true,
            sortOrder: 10,
            carryForwardTargetCode: null,
            note: null
          }
        ]
      })
    ).toThrow('民非收入或费用类科目必须指定期末结转目标科目')
  })

  it('lists built-in top-level subjects for manual maintenance reference', () => {
    const references = getStandardTopLevelSubjectReferences('enterprise')
    expect(references.some((item) => item.code === '1001' && item.name === '库存现金')).toBe(true)
    expect(references.some((item) => item.code === '4103' && item.name === '本年利润')).toBe(true)
    expect(references.find((item) => item.code === '1001')?.isCashFlow).toBe(true)
    expect(references.every((item) => item.code.length === 4)).toBe(true)
  })

  it('writes an import template workbook and parses filled rows back into subject entries', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-subject-template-'))
    const templatePath = path.join(tempDir, 'enterprise-template.xlsx')

    await writeCustomTopLevelSubjectImportTemplate(templatePath, 'enterprise')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(templatePath)

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '导入说明',
      '一级科目模板',
      '选项数据',
      '填写示例'
    ])

    const templateSheet = workbook.getWorksheet('一级科目模板')
    const optionSheet = workbook.getWorksheet('选项数据')
    expect(templateSheet?.getRow(2).values).toContain('科目编码')
    expect(templateSheet?.getRow(2).values).toContain('期末结转目标科目')
    expect(templateSheet?.getRow(2).values).not.toContain('排序号')
    expect(optionSheet?.state).toBe('veryHidden')
    expect(templateSheet?.getCell('C3').dataValidation.formulae?.[0]).toContain("'选项数据'!$A$1:$A$")
    expect(templateSheet?.getCell('D3').dataValidation.type).toBe('list')
    expect(templateSheet?.getCell('E3').dataValidation.type).toBe('list')
    expect(templateSheet?.getCell('F3').dataValidation.type).toBe('list')
    expect(templateSheet?.getCell('G3').dataValidation.type).toBe('list')
    expect(optionSheet?.getCell('A1').text).toBe('资产类')
    expect(optionSheet?.getCell('B1').text).toBe('借')
    expect(optionSheet?.getCell('C1').text).toBe('是')
    expect(optionSheet?.getCell('D2').text).toBe('否')
    expect(optionSheet?.getCell('E1').text).toMatch(/^\d{4}\s+\S+/)

    const exampleSheet = workbook.getWorksheet('填写示例')
    expect(exampleSheet?.getRow(2).values).toContain('科目编码')
    expect(exampleSheet?.getRow(3).getCell(1).text).toBe('1991')
    expect(exampleSheet?.getRow(3).getCell(2).text).toBe('医疗专项设备')
    expect(exampleSheet?.getRow(3).getCell(3).text).toBe('资产类')
    expect(exampleSheet?.getRow(4).getCell(1).text).toBe('2991')
    expect(exampleSheet?.getRow(5).getCell(1).text).toBe('6991')
    expect(exampleSheet?.getRow(5).getCell(7).text).toBe('4103 本年利润')

    templateSheet?.addRow([
      '1619',
      '周转医疗设备',
      '资产类',
      '借',
      '否',
      '是',
      '',
      '民营医院资产补充'
    ])
    templateSheet?.addRow(['6608', '医疗业务成本', '损益类', '借', '否', '是', '4103 本年利润', ''])
    await workbook.xlsx.writeFile(templatePath)

    const parsed = await readCustomTopLevelSubjectTemplateImport(templatePath, 'enterprise')
    expect(parsed.templateName).toBe('企业一级科目导入模板')
    expect(parsed.entries).toEqual([
      {
        code: '1619',
        name: '周转医疗设备',
        category: 'asset',
        balanceDirection: 1,
        isCashFlow: false,
        enabled: true,
        sortOrder: 1,
        carryForwardTargetCode: null,
        note: '民营医院资产补充'
      },
      {
        code: '6608',
        name: '医疗业务成本',
        category: 'profit_loss',
        balanceDirection: 1,
        isCashFlow: false,
        enabled: true,
        sortOrder: 2,
        carryForwardTargetCode: '4103',
        note: null
      }
    ])
  })

  it('applies custom top-level subjects to ledgers and creates carry-forward rules', () => {
    db.subjects.push({
      id: 1,
      ledger_id: 1,
      code: '4103',
      name: '本年利润',
      parent_code: null,
      category: 'equity',
      balance_direction: -1,
      level: 1,
      is_system: 1
    })

    saveCustomTopLevelSubjectTemplate(db as never, {
      standardType: 'enterprise',
      templateName: '民营医院扩展',
      entries: [
        {
          code: '1619',
          name: '周转医疗设备',
          category: 'asset',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          sortOrder: 10,
          carryForwardTargetCode: null,
          note: null
        },
        {
          code: '6608',
          name: '医疗业务成本',
          category: 'profit_loss',
          balanceDirection: 1,
          isCashFlow: false,
          enabled: true,
          sortOrder: 20,
          carryForwardTargetCode: '4103',
          note: null
        }
      ]
    })

    const appliedCount = applyCustomTopLevelSubjectTemplate(db as never, 1, 'enterprise')
    expect(appliedCount).toBe(2)

    expect(
      db.subjects
        .slice()
        .sort((left, right) => left.code.localeCompare(right.code))
        .map((subject) => ({
          code: subject.code,
          name: subject.name,
          parent_code: subject.parent_code,
          category: subject.category,
          balance_direction: subject.balance_direction,
          level: subject.level,
          is_system: subject.is_system
        }))
    ).toEqual([
      {
        code: '1619',
        name: '周转医疗设备',
        parent_code: null,
        category: 'asset',
        balance_direction: 1,
        level: 1,
        is_system: 0
      },
      {
        code: '4103',
        name: '本年利润',
        parent_code: null,
        category: 'equity',
        balance_direction: -1,
        level: 1,
        is_system: 1
      },
      {
        code: '6608',
        name: '医疗业务成本',
        parent_code: null,
        category: 'profit_loss',
        balance_direction: 1,
        level: 1,
        is_system: 0
      }
    ])

    expect(
      db.carryForwardRules.map((rule) => ({
        from_subject_code: rule.from_subject_code,
        to_subject_code: rule.to_subject_code
      }))
    ).toEqual([{ from_subject_code: '6608', to_subject_code: '4103' }])
  })
})

import type Database from 'better-sqlite3'

export const AUXILIARY_CATEGORY_VALUES = [
  'customer',
  'supplier',
  'employee',
  'project',
  'department',
  'custom'
] as const

type AuxiliaryCategory = (typeof AUXILIARY_CATEGORY_VALUES)[number]

type SubjectRecord = {
  id: number
  ledger_id: number
  code: string
  name: string
  parent_code: string | null
  category: string
  balance_direction: number
  has_auxiliary: number
  is_cash_flow: number
  level: number
  is_system: number
}

type AuxiliaryItemRecord = {
  id: number
  ledger_id: number
  category: string
  code: string
  name: string
}

type SubjectAuxiliaryCustomLink = {
  subject_id: number
  auxiliary_item_id: number
}

function requireLedger(db: Database.Database, ledgerId: number): void {
  const ledger = db.prepare(`SELECT id FROM ledgers WHERE id = ?`).get(ledgerId) as
    | { id: number }
    | undefined
  if (!ledger) {
    throw new Error('账套不存在')
  }
}

function requireSubjectById(db: Database.Database, subjectId: number): SubjectRecord {
  const subject = db.prepare(`SELECT * FROM subjects WHERE id = ?`).get(subjectId) as
    | SubjectRecord
    | undefined
  if (!subject) {
    throw new Error('科目不存在')
  }
  return subject
}

function normalizeText(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${fieldName}不能为空`)
  }
  return normalized
}

function normalizeAuxiliaryCategories(categories: string[]): AuxiliaryCategory[] {
  const normalized = Array.from(
    new Set(
      categories
        .map((category) => category.trim())
        .filter((category): category is AuxiliaryCategory =>
          AUXILIARY_CATEGORY_VALUES.includes(category as AuxiliaryCategory)
        )
    )
  )

  if (normalized.length !== categories.filter((item) => item.trim()).length) {
    throw new Error('辅助项类别不合法')
  }

  return normalized
}

function replaceSubjectAuxiliaryCategories(
  db: Database.Database,
  subjectId: number,
  categories: AuxiliaryCategory[]
): void {
  const replace = db.transaction((nextCategories: AuxiliaryCategory[]) => {
    db.prepare(`DELETE FROM subject_auxiliary_categories WHERE subject_id = ?`).run(subjectId)

    const insert = db.prepare(
      `INSERT INTO subject_auxiliary_categories (subject_id, category) VALUES (?, ?)`
    )
    for (const category of nextCategories) {
      insert.run(subjectId, category)
    }
  })

  replace(categories)
}

function replaceSubjectAuxiliaryCustomItems(
  db: Database.Database,
  subjectId: number,
  auxiliaryItemIds: number[]
): void {
  const replace = db.transaction((nextItemIds: number[]) => {
    db.prepare(`DELETE FROM subject_auxiliary_custom_items WHERE subject_id = ?`).run(subjectId)

    if (nextItemIds.length === 0) {
      return
    }

    const insert = db.prepare(
      `INSERT INTO subject_auxiliary_custom_items (subject_id, auxiliary_item_id) VALUES (?, ?)`
    )
    for (const itemId of nextItemIds) {
      insert.run(subjectId, itemId)
    }
  })

  replace(auxiliaryItemIds)
}

function normalizeCustomAuxiliaryItemIds(
  db: Database.Database,
  ledgerId: number,
  itemIds: number[]
): number[] {
  const normalized = Array.from(
    new Set(
      itemIds
        .map((itemId) => Number(itemId))
        .filter((itemId) => Number.isFinite(itemId) && itemId > 0)
    )
  )

  if (normalized.length === 0) {
    return []
  }

  const customItems = listAuxiliaryItems(db, ledgerId, 'custom')
  const validIds = new Set(customItems.map((item) => item.id))
  if (normalized.some((itemId) => !validIds.has(itemId))) {
    throw new Error('自定义辅助项明细不合法')
  }

  return normalized
}

export function listSubjects(
  db: Database.Database,
  ledgerId: number
): Array<
  SubjectRecord & {
    auxiliary_categories: AuxiliaryCategory[]
    auxiliary_custom_items: AuxiliaryItemRecord[]
  }
> {
  requireLedger(db, ledgerId)

  const subjects = db
    .prepare(`SELECT * FROM subjects WHERE ledger_id = ? ORDER BY code`)
    .all(ledgerId) as SubjectRecord[]

  if (subjects.length === 0) {
    return []
  }

  const categoryRows = db
    .prepare(
      `SELECT sac.subject_id, sac.category
       FROM subject_auxiliary_categories sac
       INNER JOIN subjects s ON s.id = sac.subject_id
       WHERE s.ledger_id = ?
       ORDER BY sac.category`
    )
    .all(ledgerId) as Array<{ subject_id: number; category: AuxiliaryCategory }>

  const grouped = new Map<number, AuxiliaryCategory[]>()
  for (const row of categoryRows) {
    const current = grouped.get(row.subject_id) ?? []
    current.push(row.category)
    grouped.set(row.subject_id, current)
  }

  const customLinkRows = db
    .prepare(
      `SELECT saci.subject_id, saci.auxiliary_item_id
       FROM subject_auxiliary_custom_items saci
       INNER JOIN subjects s ON s.id = saci.subject_id
       WHERE s.ledger_id = ?
       ORDER BY saci.auxiliary_item_id`
    )
    .all(ledgerId) as SubjectAuxiliaryCustomLink[]

  const customItems = listAuxiliaryItems(db, ledgerId, 'custom')
  const customItemById = new Map(customItems.map((item) => [item.id, item]))
  const customGrouped = new Map<number, AuxiliaryItemRecord[]>()
  for (const row of customLinkRows) {
    const item = customItemById.get(row.auxiliary_item_id)
    if (!item) {
      continue
    }
    const current = customGrouped.get(row.subject_id) ?? []
    current.push(item)
    customGrouped.set(row.subject_id, current)
  }

  return subjects.map((subject) => ({
    ...subject,
    auxiliary_categories: grouped.get(subject.id) ?? [],
    auxiliary_custom_items: customGrouped.get(subject.id) ?? []
  }))
}

export function createSubject(
  db: Database.Database,
  data: {
    ledgerId: number
    parentCode: string | null
    code: string
    name: string
    auxiliaryCategories: string[]
    customAuxiliaryItemIds?: number[]
    isCashFlow: boolean
  }
): number {
  requireLedger(db, data.ledgerId)

  if (!data.parentCode) {
    throw new Error('新建科目必须选择上级科目')
  }

  const parent = db
    .prepare(`SELECT * FROM subjects WHERE ledger_id = ? AND code = ?`)
    .get(data.ledgerId, data.parentCode) as SubjectRecord | undefined
  if (!parent) {
    throw new Error('上级科目不存在')
  }

  const code = normalizeText(data.code, '科目编码')
  const name = normalizeText(data.name, '科目名称')
  const auxiliaryCategories = normalizeAuxiliaryCategories(data.auxiliaryCategories)
  const customAuxiliaryItemIds = auxiliaryCategories.includes('custom')
    ? normalizeCustomAuxiliaryItemIds(db, data.ledgerId, data.customAuxiliaryItemIds ?? [])
    : []

  if (auxiliaryCategories.includes('custom') && customAuxiliaryItemIds.length === 0) {
    throw new Error('自定义辅助项至少选择一个明细')
  }

  if (!code.startsWith(parent.code) || code === parent.code) {
    throw new Error('明细科目编码必须以上级科目编码开头')
  }

  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO subjects
          (ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        data.ledgerId,
        code,
        name,
        parent.code,
        parent.category,
        parent.balance_direction,
        auxiliaryCategories.length > 0 ? 1 : 0,
        data.isCashFlow ? 1 : 0,
        parent.level + 1
      )

    const subjectId = Number(result.lastInsertRowid)
    replaceSubjectAuxiliaryCategories(db, subjectId, auxiliaryCategories)
    replaceSubjectAuxiliaryCustomItems(db, subjectId, customAuxiliaryItemIds)
    return subjectId
  })

  return insert()
}

export function updateSubject(
  db: Database.Database,
  data: {
    subjectId: number
    name?: string
    auxiliaryCategories?: string[]
    customAuxiliaryItemIds?: number[]
    isCashFlow?: boolean
  }
): void {
  const subject = requireSubjectById(db, data.subjectId)
  const nextName = data.name !== undefined ? normalizeText(data.name, '科目名称') : subject.name

  if (subject.is_system === 1 && nextName !== subject.name) {
    throw new Error('系统科目不允许修改名称')
  }

  const normalizedCategories =
    data.auxiliaryCategories !== undefined
      ? normalizeAuxiliaryCategories(data.auxiliaryCategories)
      : undefined
  const normalizedCustomItemIds =
    normalizedCategories !== undefined
      ? normalizedCategories.includes('custom')
        ? normalizeCustomAuxiliaryItemIds(db, subject.ledger_id, data.customAuxiliaryItemIds ?? [])
        : []
      : undefined

  if (normalizedCategories?.includes('custom') && (normalizedCustomItemIds?.length ?? 0) === 0) {
    throw new Error('自定义辅助项至少选择一个明细')
  }

  const update = db.transaction(() => {
    db.prepare(
      `UPDATE subjects
       SET name = ?, has_auxiliary = ?, is_cash_flow = ?
       WHERE id = ?`
    ).run(
      nextName,
      normalizedCategories ? (normalizedCategories.length > 0 ? 1 : 0) : subject.has_auxiliary,
      data.isCashFlow !== undefined ? (data.isCashFlow ? 1 : 0) : subject.is_cash_flow,
      data.subjectId
    )

    if (normalizedCategories !== undefined) {
      replaceSubjectAuxiliaryCategories(db, data.subjectId, normalizedCategories)
      replaceSubjectAuxiliaryCustomItems(db, data.subjectId, normalizedCustomItemIds ?? [])
    }
  })

  update()
}

export function createAuxiliaryItem(
  db: Database.Database,
  data: {
    ledgerId: number
    category: string
    code: string
    name: string
  }
): number {
  requireLedger(db, data.ledgerId)
  const categories = normalizeAuxiliaryCategories([data.category])
  const code = normalizeText(data.code, '辅助账编码')
  const name = normalizeText(data.name, '辅助账名称')

  const result = db
    .prepare(`INSERT INTO auxiliary_items (ledger_id, category, code, name) VALUES (?, ?, ?, ?)`)
    .run(data.ledgerId, categories[0], code, name)

  return Number(result.lastInsertRowid)
}

export function listAuxiliaryItems(
  db: Database.Database,
  ledgerId: number,
  category?: string
): AuxiliaryItemRecord[] {
  requireLedger(db, ledgerId)

  if (category !== undefined) {
    const [normalizedCategory] = normalizeAuxiliaryCategories([category])
    return db
      .prepare(`SELECT * FROM auxiliary_items WHERE ledger_id = ? AND category = ? ORDER BY code`)
      .all(ledgerId, normalizedCategory) as AuxiliaryItemRecord[]
  }

  return db
    .prepare(`SELECT * FROM auxiliary_items WHERE ledger_id = ? ORDER BY category, code`)
    .all(ledgerId) as AuxiliaryItemRecord[]
}

export function updateAuxiliaryItem(
  db: Database.Database,
  data: {
    id: number
    code?: string
    name?: string
  }
): void {
  const item = db.prepare(`SELECT * FROM auxiliary_items WHERE id = ?`).get(data.id) as
    | AuxiliaryItemRecord
    | undefined
  if (!item) {
    throw new Error('辅助账不存在')
  }

  const nextCode = data.code !== undefined ? normalizeText(data.code, '辅助账编码') : item.code
  const nextName = data.name !== undefined ? normalizeText(data.name, '辅助账名称') : item.name

  db.prepare(`UPDATE auxiliary_items SET code = ?, name = ? WHERE id = ?`).run(
    nextCode,
    nextName,
    data.id
  )
}

export function deleteAuxiliaryItem(db: Database.Database, id: number): void {
  const used = db
    .prepare(`SELECT id FROM voucher_entries WHERE auxiliary_item_id = ? LIMIT 1`)
    .get(id)
  if (used) {
    throw new Error('该辅助账已被凭证使用，无法删除')
  }

  db.prepare(`DELETE FROM auxiliary_items WHERE id = ?`).run(id)
}

export interface MergeableSubjectTemplateEntry {
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

function compareByCode(left: { code: string }, right: { code: string }): number {
  const leftCode = left.code.trim()
  const rightCode = right.code.trim()
  if (!leftCode && !rightCode) return 0
  if (!leftCode) return 1
  if (!rightCode) return -1
  return leftCode.localeCompare(rightCode, 'zh-CN')
}

export function mergeSubjectTemplateEntries<T extends MergeableSubjectTemplateEntry>(
  currentEntries: T[],
  importedEntries: T[]
): T[] {
  const mergedEntries = new Map<string, T>()

  for (const entry of currentEntries) {
    const code = entry.code.trim()
    if (!code) continue
    mergedEntries.set(code, {
      ...entry,
      code,
      name: entry.name.trim(),
      carryForwardTargetCode: entry.carryForwardTargetCode?.trim() || null,
      note: entry.note?.trim() || null
    })
  }

  for (const entry of importedEntries) {
    const code = entry.code.trim()
    if (!code) continue
    mergedEntries.set(code, {
      ...entry,
      code,
      name: entry.name.trim(),
      carryForwardTargetCode: entry.carryForwardTargetCode?.trim() || null,
      note: entry.note?.trim() || null
    })
  }

  return Array.from(mergedEntries.values())
    .sort(compareByCode)
    .map((entry, index) => ({
      ...entry,
      sortOrder: index + 1
    }))
}

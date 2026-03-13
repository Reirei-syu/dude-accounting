export function formatBackupCardTitle(period: string | null): string {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    return '未设置期间'
  }

  const [year, month] = period.split('-')
  return `${year}年${month}月`
}

export function formatArchiveCardTitle(fiscalYear: string | null): string {
  if (!fiscalYear || !/^\d{4}$/.test(fiscalYear)) {
    return '未设置年度'
  }

  return `${fiscalYear}年`
}

export function getLatestRecordIdsByGroup<T extends { id: number }>(
  items: T[],
  getGroupKey: (item: T) => string
): Set<number> {
  const latestByGroup = new Map<string, number>()

  for (const item of items) {
    const groupKey = getGroupKey(item)
    const current = latestByGroup.get(groupKey)
    if (current === undefined || item.id > current) {
      latestByGroup.set(groupKey, item.id)
    }
  }

  return new Set(latestByGroup.values())
}

export function getVisibleRecordItems<T>(
  items: T[],
  expanded: boolean,
  defaultVisibleCount = 2
): T[] {
  if (expanded) {
    return items
  }

  return items.slice(0, defaultVisibleCount)
}

export function shouldShowExpandButton(totalCount: number, defaultVisibleCount = 2): boolean {
  return totalCount > defaultVisibleCount
}

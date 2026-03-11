export interface SubjectOption {
  code: string
  name: string
}

export interface AuxiliaryItemOption {
  id: number
  category: string
  code: string
  name: string
}

export interface SubjectWithAuxiliary {
  code: string
  name: string
  has_auxiliary: number
  auxiliary_categories?: string[]
  auxiliary_custom_items?: AuxiliaryItemOption[]
}

export function getPeriodDateRange(period: string): {
  startDate: string
  endDate: string
} {
  const [yearText, monthText] = period.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

  return {
    startDate: `${period}-01`,
    endDate
  }
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getCurrentYearDateRange(now: Date = new Date()): {
  startDate: string
  endDate: string
} {
  const currentYear = now.getFullYear()

  return {
    startDate: `${currentYear}-01-01`,
    endDate: formatDateInputValue(now)
  }
}

export function getLeafSubjects(subjects: SubjectOption[]): SubjectOption[] {
  return subjects.filter(
    (subject) =>
      !subjects.some(
        (candidate) =>
          candidate.code !== subject.code && candidate.code.startsWith(`${subject.code}`)
      )
  )
}

export function getBalanceSideLabel(balanceSide: 'debit' | 'credit' | 'flat'): string {
  if (balanceSide === 'debit') {
    return '借'
  }

  if (balanceSide === 'credit') {
    return '贷'
  }

  return '平'
}

export function filterSubjectRowsByCodeRange<T extends { subject_code: string }>(
  rows: T[],
  startCode: string,
  endCode: string
): T[] {
  const normalizedStartCode = startCode.trim()
  const normalizedEndCode = endCode.trim()

  return rows.filter((row) => {
    if (normalizedStartCode && row.subject_code < normalizedStartCode) {
      return false
    }

    if (normalizedEndCode && row.subject_code > normalizedEndCode) {
      return false
    }

    return true
  })
}

export function resolveAuxiliaryItemsForSubject(
  subject: SubjectWithAuxiliary | undefined,
  allAuxiliaryItems: AuxiliaryItemOption[]
): AuxiliaryItemOption[] {
  if (!subject) {
    return []
  }

  const categories = new Set(subject.auxiliary_categories ?? [])
  const selected = new Map<number, AuxiliaryItemOption>()

  for (const item of allAuxiliaryItems) {
    if (item.category !== 'custom' && categories.has(item.category)) {
      selected.set(item.id, item)
    }
  }

  for (const item of subject.auxiliary_custom_items ?? []) {
    selected.set(item.id, item)
  }

  return Array.from(selected.values()).sort((left, right) => {
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category)
    }
    return left.code.localeCompare(right.code)
  })
}

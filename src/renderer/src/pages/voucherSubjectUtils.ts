export interface VoucherSubjectSearchItem {
  code: string
  name: string
}

function measureVoucherSubjectMatchPriority(
  subject: VoucherSubjectSearchItem,
  normalizedKeyword: string
): number {
  const code = subject.code.toLowerCase()
  const name = subject.name.toLowerCase()

  if (code === normalizedKeyword) return 0
  if (code.startsWith(normalizedKeyword)) return 1
  if (name.startsWith(normalizedKeyword)) return 2
  if (code.includes(normalizedKeyword)) return 3
  if (name.includes(normalizedKeyword)) return 4
  return 5
}

export function filterLeafVoucherSubjectsByKeyword<T extends VoucherSubjectSearchItem>(
  subjects: T[],
  keyword: string,
  hasChildrenCodes: Set<string>
): T[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  if (!normalizedKeyword) {
    return []
  }

  return subjects
    .filter((subject) => !hasChildrenCodes.has(subject.code))
    .filter((subject) => {
      const code = subject.code.toLowerCase()
      const name = subject.name.toLowerCase()
      return code.includes(normalizedKeyword) || name.includes(normalizedKeyword)
    })
    .sort((left, right) => {
      const leftPriority = measureVoucherSubjectMatchPriority(left, normalizedKeyword)
      const rightPriority = measureVoucherSubjectMatchPriority(right, normalizedKeyword)

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }

      if (left.code.length !== right.code.length) {
        return left.code.length - right.code.length
      }

      return left.code.localeCompare(right.code)
    })
    .slice(0, 20)
}

export function buildVoucherSubjectPath<T extends VoucherSubjectSearchItem>(
  subjectCode: string,
  subjectByCode: Map<string, T>,
  logicalParentByCode: Map<string, string | null>
): string {
  const segments: string[] = []
  const visited = new Set<string>()
  let currentCode: string | null = subjectCode

  while (currentCode && !visited.has(currentCode)) {
    visited.add(currentCode)
    const currentSubject = subjectByCode.get(currentCode)
    if (!currentSubject) {
      break
    }

    segments.unshift(`${currentSubject.code} ${currentSubject.name}`.trim())
    currentCode = logicalParentByCode.get(currentCode) ?? null
  }

  return segments.join(' > ')
}

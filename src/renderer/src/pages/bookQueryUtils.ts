export interface SubjectOption {
  code: string
  name: string
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

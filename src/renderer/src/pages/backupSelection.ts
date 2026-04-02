export interface SelectablePeriod {
  period: string
  is_closed: number
}

export function getBackupPeriodOptions(periods: SelectablePeriod[]): string[] {
  return periods
    .map((item) => item.period)
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
}

export function pickDefaultBackupPeriod(periods: SelectablePeriod[]): string {
  return getBackupPeriodOptions(periods)[0] ?? ''
}

export function resolveBackupPeriodSelection(
  periods: SelectablePeriod[],
  currentPeriod?: string | null,
  selectedPeriod?: string | null
): string {
  const options = getBackupPeriodOptions(periods)

  if (selectedPeriod && options.includes(selectedPeriod)) {
    return selectedPeriod
  }

  if (currentPeriod && options.includes(currentPeriod)) {
    return currentPeriod
  }

  return options[0] ?? ''
}

export function getArchiveYearOptions(periods: SelectablePeriod[]): string[] {
  return Array.from(
    new Set(
      periods
        .filter((item) => item.is_closed === 1)
        .map((item) => item.period.slice(0, 4))
        .filter((value) => /^\d{4}$/.test(value))
    )
  ).sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
}

export function pickDefaultArchiveYear(periods: SelectablePeriod[]): string {
  return getArchiveYearOptions(periods)[0] ?? ''
}

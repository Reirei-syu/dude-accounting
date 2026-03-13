function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function getLastSegment(value: string): string {
  const normalized = normalizeSeparators(value.trim())
  if (!normalized) {
    return '未命名包件'
  }

  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? '未命名包件'
}

export function getBackupPackageName(backupPath: string): string {
  const normalized = normalizeSeparators(backupPath.trim())
  if (!normalized) {
    return '未命名包件'
  }

  const segments = normalized.split('/').filter(Boolean)
  if (segments.length <= 1) {
    return getLastSegment(normalized)
  }

  return segments[segments.length - 2] ?? '未命名包件'
}

export function getArchivePackageName(exportPath: string): string {
  return getLastSegment(exportPath)
}

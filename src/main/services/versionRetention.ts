export function assertHistoricalVersionDeletable(
  currentId: number,
  versionIdsDesc: number[],
  label: string
): void {
  if (!versionIdsDesc.includes(currentId)) {
    throw new Error(`${label}记录不存在`)
  }

  if (versionIdsDesc[0] === currentId) {
    throw new Error(`请保留最新${label}，仅允许删除旧版本`)
  }
}

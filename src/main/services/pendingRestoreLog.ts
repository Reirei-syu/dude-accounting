import fs from 'node:fs'
import path from 'node:path'

export interface PendingRestoreLogPayload {
  userId: number
  username: string
  ledgerId: number | null
  targetType: string
  targetId: string | number | null
  backupPath: string
  manifestPath: string | null
  backupMode: 'system_db_snapshot'
}

export function getPendingRestoreLogPath(userDataPath: string): string {
  return path.join(userDataPath, 'pending-restore-log.json')
}

export function writePendingRestoreLog(
  filePath: string,
  payload: PendingRestoreLogPayload
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
}

export function readPendingRestoreLog(filePath: string): PendingRestoreLogPayload | null {
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PendingRestoreLogPayload
  } catch {
    return null
  }
}

export function clearPendingRestoreLog(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true })
  }
}

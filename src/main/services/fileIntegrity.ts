import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

export function sanitizePathSegment(value: string, fallback = '未命名'): string {
  const normalized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return normalized || fallback
}

export function buildUniqueDirectoryPath(rootDir: string, preferredName: string): string {
  const baseName = sanitizePathSegment(preferredName)
  let candidatePath = path.join(rootDir, baseName)
  let sequence = 2

  while (fs.existsSync(candidatePath)) {
    candidatePath = path.join(rootDir, `${baseName}_${sequence}`)
    sequence += 1
  }

  return candidatePath
}

export function buildTimestampToken(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}

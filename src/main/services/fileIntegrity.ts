import crypto from 'node:crypto'
import fs from 'node:fs'

export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
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

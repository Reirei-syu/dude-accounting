import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { ensureDirectory } from './fileIntegrity'

export const USER_WALLPAPER_KEY = 'custom_wallpaper_relative_path'
export const LAST_LOGIN_USER_ID_KEY = 'last_login_user_id'
export const WALLPAPER_SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const
export const WALLPAPER_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
export const WALLPAPER_RECOMMENDED_RESOLUTION = '1920 × 1080 及以上'
export const WALLPAPER_RECOMMENDED_RATIO = '16:9'
export const WALLPAPER_CROP_OUTPUT_WIDTH = 1920
export const WALLPAPER_CROP_OUTPUT_HEIGHT = 1080

export interface WallpaperState {
  mode: 'default' | 'custom'
  wallpaperPath: string | null
  wallpaperUrl: string | null
  recommendedResolution: string
  recommendedRatio: string
  maxFileSizeMb: number
  supportedFormats: string[]
}

function getWallpaperMimeType(extension: string): string {
  const normalizedExtension = extension.toLowerCase()
  if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') {
    return 'image/jpeg'
  }
  if (normalizedExtension === 'webp') {
    return 'image/webp'
  }
  return 'image/png'
}

function buildWallpaperDataUrl(wallpaperPath: string | null): string | null {
  if (!wallpaperPath) {
    return null
  }

  const extension = path.extname(wallpaperPath).slice(1).toLowerCase()
  return `data:${getWallpaperMimeType(extension)};base64,${fs.readFileSync(wallpaperPath).toString('base64')}`
}

function buildWallpaperState(wallpaperPath: string | null): WallpaperState {
  return {
    mode: wallpaperPath ? 'custom' : 'default',
    wallpaperPath,
    wallpaperUrl: buildWallpaperDataUrl(wallpaperPath),
    recommendedResolution: WALLPAPER_RECOMMENDED_RESOLUTION,
    recommendedRatio: WALLPAPER_RECOMMENDED_RATIO,
    maxFileSizeMb: Math.floor(WALLPAPER_MAX_FILE_SIZE_BYTES / (1024 * 1024)),
    supportedFormats: [...WALLPAPER_SUPPORTED_FORMATS]
  }
}

function upsertUserPreference(
  db: Database.Database,
  userId: number,
  key: string,
  value: string
): void {
  db.prepare(
    `INSERT INTO user_preferences (user_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, key, value)
}

function deleteUserPreference(db: Database.Database, userId: number, key: string): void {
  db.prepare('DELETE FROM user_preferences WHERE user_id = ? AND key = ?').run(userId, key)
}

function getUserPreference(db: Database.Database, userId: number, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined

  return row?.value?.trim() || null
}

function upsertSystemSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value)
}

function getSystemSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined

  return row?.value?.trim() || null
}

function getWallpaperStorageDir(userDataPath: string, userId: number): string {
  return path.join(userDataPath, 'wallpapers', `user-${userId}`)
}

function getStoredWallpaperPath(userDataPath: string, relativePath: string | null): string | null {
  if (!relativePath) {
    return null
  }

  const absolutePath = path.resolve(userDataPath, relativePath)
  const wallpaperRoot = path.resolve(path.join(userDataPath, 'wallpapers'))

  if (!absolutePath.startsWith(wallpaperRoot)) {
    return null
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return null
  }

  return absolutePath
}

function clearDirectoryFiles(directoryPath: string): void {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const targetPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    } else {
      fs.rmSync(targetPath, { force: true })
    }
  }
}

export function validateWallpaperSourceFile(filePath: string): string {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('选中的图片文件不存在')
  }

  const fileStat = fs.statSync(filePath)
  if (fileStat.size > WALLPAPER_MAX_FILE_SIZE_BYTES) {
    throw new Error('图片文件不能超过 50MB')
  }

  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (!WALLPAPER_SUPPORTED_FORMATS.includes(extension as (typeof WALLPAPER_SUPPORTED_FORMATS)[number])) {
    throw new Error('仅支持 jpg、jpeg、png、webp 格式的图片')
  }

  return extension
}

function validateWallpaperBuffer(buffer: Buffer, extension: string): string {
  const normalizedExtension = extension.trim().toLowerCase()
  if (!WALLPAPER_SUPPORTED_FORMATS.includes(normalizedExtension as (typeof WALLPAPER_SUPPORTED_FORMATS)[number])) {
    throw new Error('仅支持 jpg、jpeg、png、webp 格式的图片')
  }

  if (buffer.byteLength > WALLPAPER_MAX_FILE_SIZE_BYTES) {
    throw new Error('图片文件不能超过 50MB')
  }

  return normalizedExtension
}

export function setLastLoginUserId(db: Database.Database, userId: number): void {
  upsertSystemSetting(db, LAST_LOGIN_USER_ID_KEY, String(userId))
}

export function getUserWallpaperState(
  db: Database.Database,
  userDataPath: string,
  userId: number
): WallpaperState {
  const relativePath = getUserPreference(db, userId, USER_WALLPAPER_KEY)
  const wallpaperPath = getStoredWallpaperPath(userDataPath, relativePath)

  if (!wallpaperPath && relativePath) {
    deleteUserPreference(db, userId, USER_WALLPAPER_KEY)
  }

  return buildWallpaperState(wallpaperPath)
}

export function getLoginWallpaperState(
  db: Database.Database,
  userDataPath: string
): WallpaperState {
  const userIdText = getSystemSetting(db, LAST_LOGIN_USER_ID_KEY)
  const userId = userIdText ? Number(userIdText) : Number.NaN

  if (!Number.isInteger(userId) || userId <= 0) {
    return buildWallpaperState(null)
  }

  return getUserWallpaperState(db, userDataPath, userId)
}

export function replaceUserWallpaper(
  db: Database.Database,
  userDataPath: string,
  userId: number,
  sourcePath: string
): WallpaperState {
  const extension = validateWallpaperSourceFile(sourcePath)
  const sourceBuffer = fs.readFileSync(sourcePath)
  return replaceUserWallpaperFromBuffer(db, userDataPath, userId, sourceBuffer, extension)
}

export function replaceUserWallpaperFromBuffer(
  db: Database.Database,
  userDataPath: string,
  userId: number,
  sourceBuffer: Buffer,
  extension: string
): WallpaperState {
  const normalizedExtension = validateWallpaperBuffer(sourceBuffer, extension)
  const wallpaperDir = getWallpaperStorageDir(userDataPath, userId)
  const targetPath = path.join(wallpaperDir, `current.${normalizedExtension}`)
  const relativePath = path.relative(userDataPath, targetPath)

  ensureDirectory(wallpaperDir)
  clearDirectoryFiles(wallpaperDir)
  fs.writeFileSync(targetPath, sourceBuffer)
  upsertUserPreference(db, userId, USER_WALLPAPER_KEY, relativePath)

  return buildWallpaperState(targetPath)
}

export function restoreDefaultWallpaper(
  db: Database.Database,
  userDataPath: string,
  userId: number
): WallpaperState {
  const wallpaperDir = getWallpaperStorageDir(userDataPath, userId)
  if (fs.existsSync(wallpaperDir)) {
    fs.rmSync(wallpaperDir, { recursive: true, force: true })
  }

  deleteUserPreference(db, userId, USER_WALLPAPER_KEY)
  return buildWallpaperState(null)
}

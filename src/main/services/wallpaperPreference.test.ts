import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getLoginWallpaperState,
  getUserWallpaperState,
  replaceUserWallpaper,
  restoreDefaultWallpaper,
  setLastLoginUserId
} from './wallpaperPreference'

class MockWallpaperDb {
  private userPreferences = new Map<string, string>()
  private systemSettings = new Map<string, string>()

  prepare(sql: string): { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => void } {
    if (sql === 'SELECT value FROM user_preferences WHERE user_id = ? AND key = ?') {
      return {
        get: (userId: unknown, key: unknown) => {
          const value = this.userPreferences.get(`${String(userId)}:${String(key)}`)
          return value === undefined ? undefined : { value }
        },
        run: () => undefined
      }
    }

    if (sql.includes('INSERT INTO user_preferences')) {
      return {
        get: () => undefined,
        run: (userId: unknown, key: unknown, value: unknown) => {
          this.userPreferences.set(`${String(userId)}:${String(key)}`, String(value))
        }
      }
    }

    if (sql === 'DELETE FROM user_preferences WHERE user_id = ? AND key = ?') {
      return {
        get: () => undefined,
        run: (userId: unknown, key: unknown) => {
          this.userPreferences.delete(`${String(userId)}:${String(key)}`)
        }
      }
    }

    if (sql === 'SELECT value FROM system_settings WHERE key = ?') {
      return {
        get: (key: unknown) => {
          const value = this.systemSettings.get(String(key))
          return value === undefined ? undefined : { value }
        },
        run: () => undefined
      }
    }

    if (sql.includes('INSERT INTO system_settings')) {
      return {
        get: () => undefined,
        run: (key: unknown, value: unknown) => {
          this.systemSettings.set(String(key), String(value))
        }
      }
    }

    throw new Error(`Unsupported SQL in MockWallpaperDb: ${sql}`)
  }
}

describe('wallpaperPreference service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('returns default wallpaper state when user has not uploaded a wallpaper', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-wallpaper-'))
    const db = new MockWallpaperDb()

    expect(getUserWallpaperState(db as never, tempDir, 1)).toEqual(
      expect.objectContaining({
        mode: 'default',
        wallpaperPath: null,
        wallpaperUrl: null
      })
    )
  })

  it('copies the selected wallpaper into the user data directory and returns custom wallpaper state', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-wallpaper-'))
    const db = new MockWallpaperDb()
    const sourcePath = path.join(tempDir, 'source.png')
    fs.writeFileSync(sourcePath, 'png-bytes', 'utf8')

    const state = replaceUserWallpaper(db as never, tempDir, 1, sourcePath)

    expect(state.mode).toBe('custom')
    expect(state.wallpaperPath).toBe(path.join(tempDir, 'wallpapers', 'user-1', 'current.png'))
    expect(state.wallpaperUrl).toMatch(/^data:image\/png;base64,/)
    expect(fs.existsSync(state.wallpaperPath as string)).toBe(true)
    expect(getUserWallpaperState(db as never, tempDir, 1).wallpaperPath).toBe(state.wallpaperPath)
  })

  it('restores the default wallpaper and deletes the stored custom wallpaper file', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-wallpaper-'))
    const db = new MockWallpaperDb()
    const sourcePath = path.join(tempDir, 'source.jpg')
    fs.writeFileSync(sourcePath, 'jpg-bytes', 'utf8')
    const customState = replaceUserWallpaper(db as never, tempDir, 1, sourcePath)

    const restoredState = restoreDefaultWallpaper(db as never, tempDir, 1)

    expect(restoredState).toEqual(
      expect.objectContaining({
        mode: 'default',
        wallpaperPath: null,
        wallpaperUrl: null
      })
    )
    expect(fs.existsSync(customState.wallpaperPath as string)).toBe(false)
  })

  it('returns the last login user wallpaper for the login page', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-wallpaper-'))
    const db = new MockWallpaperDb()
    const sourcePath = path.join(tempDir, 'source.webp')
    fs.writeFileSync(sourcePath, 'webp-bytes', 'utf8')
    replaceUserWallpaper(db as never, tempDir, 7, sourcePath)
    setLastLoginUserId(db as never, 7)

    const loginWallpaper = getLoginWallpaperState(db as never, tempDir)

    expect(loginWallpaper).toEqual(
      expect.objectContaining({
        mode: 'custom',
        wallpaperPath: path.join(tempDir, 'wallpapers', 'user-7', 'current.webp')
      })
    )
  })
})

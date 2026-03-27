import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PRIMARY_DATABASE_FILE_NAME,
  RUNTIME_DATABASE_DIRECTORY_NAME,
  ensurePrimaryDatabasePath,
  getRuntimeDatabaseDirectory
} from './runtimeDatabasePath'

describe('runtimeDatabasePath service', () => {
  let tempDir: string | null = null

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    tempDir = null
  })

  it('keeps the primary database in development userData', () => {
    const userDataPath = path.join('C:/Users/test/AppData/Roaming', 'dude-app-dev')
    expect(
      getRuntimeDatabaseDirectory({
        userDataPath,
        isDevelopment: true
      })
    ).toBe(userDataPath)
  })

  it('stores the packaged primary database under install-directory data', () => {
    expect(
      getRuntimeDatabaseDirectory({
        userDataPath: 'C:/Users/test/AppData/Roaming/dude-app',
        isDevelopment: false,
        executablePath: 'D:/DudeAcc/dude-app/dude-app.exe'
      })
    ).toBe(path.join('C:/Users/test/AppData/Roaming/dude-app', RUNTIME_DATABASE_DIRECTORY_NAME))
  })

  it('migrates the legacy packaged database from userData root into userData/data on first launch', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-db-'))
    const userDataPath = path.join(tempDir, 'userData')
    const installDirectory = path.join(tempDir, 'install')
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.mkdirSync(installDirectory, { recursive: true })

    const legacyDbPath = path.join(userDataPath, PRIMARY_DATABASE_FILE_NAME)
    const legacyWalPath = `${legacyDbPath}-wal`
    fs.writeFileSync(legacyDbPath, 'legacy-db', 'utf8')
    fs.writeFileSync(legacyWalPath, 'legacy-wal', 'utf8')

    const state = ensurePrimaryDatabasePath({
      userDataPath,
      isDevelopment: false,
      installDirectory
    })

    expect(state.targetPath).toBe(
      path.join(userDataPath, RUNTIME_DATABASE_DIRECTORY_NAME, PRIMARY_DATABASE_FILE_NAME)
    )
    expect(state.legacyPath).toBe(legacyDbPath)
    expect(state.migrated).toBe(true)
    expect(fs.readFileSync(state.targetPath, 'utf8')).toBe('legacy-db')
    expect(fs.readFileSync(`${state.targetPath}-wal`, 'utf8')).toBe('legacy-wal')
  })

  it('migrates the packaged database from the old install-directory data folder into userData/data', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-db-'))
    const userDataPath = path.join(tempDir, 'userData')
    const installDirectory = path.join(tempDir, 'install')
    const installDataDirectory = path.join(installDirectory, RUNTIME_DATABASE_DIRECTORY_NAME)
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.mkdirSync(installDataDirectory, { recursive: true })

    const installDbPath = path.join(installDataDirectory, PRIMARY_DATABASE_FILE_NAME)
    const installWalPath = `${installDbPath}-wal`
    fs.writeFileSync(installDbPath, 'install-db', 'utf8')
    fs.writeFileSync(installWalPath, 'install-wal', 'utf8')

    const state = ensurePrimaryDatabasePath({
      userDataPath,
      isDevelopment: false,
      installDirectory
    })

    expect(state.targetPath).toBe(
      path.join(userDataPath, RUNTIME_DATABASE_DIRECTORY_NAME, PRIMARY_DATABASE_FILE_NAME)
    )
    expect(state.migrated).toBe(true)
    expect(fs.readFileSync(state.targetPath, 'utf8')).toBe('install-db')
    expect(fs.readFileSync(`${state.targetPath}-wal`, 'utf8')).toBe('install-wal')
  })

  it('prefers the newer install-directory database when both legacy sources exist', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-db-'))
    const userDataPath = path.join(tempDir, 'userData')
    const installDirectory = path.join(tempDir, 'install')
    const installDataDirectory = path.join(installDirectory, RUNTIME_DATABASE_DIRECTORY_NAME)
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.mkdirSync(installDataDirectory, { recursive: true })

    const legacyRootDbPath = path.join(userDataPath, PRIMARY_DATABASE_FILE_NAME)
    fs.writeFileSync(legacyRootDbPath, 'legacy-root-db', 'utf8')
    const olderTime = new Date('2026-03-28T00:07:30')
    fs.utimesSync(legacyRootDbPath, olderTime, olderTime)

    const installDbPath = path.join(installDataDirectory, PRIMARY_DATABASE_FILE_NAME)
    fs.writeFileSync(installDbPath, 'install-db-newer', 'utf8')
    const newerTime = new Date('2026-03-28T00:08:30')
    fs.utimesSync(installDbPath, newerTime, newerTime)

    const state = ensurePrimaryDatabasePath({
      userDataPath,
      isDevelopment: false,
      installDirectory
    })

    expect(state.legacyPath).toBe(installDbPath)
    expect(fs.readFileSync(state.targetPath, 'utf8')).toBe('install-db-newer')
  })

  it('throws a clear error when the packaged data directory is not writable', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-db-'))
    const userDataPath = path.join(tempDir, 'userData-root-file')
    const installDirectory = path.join(tempDir, 'install')
    fs.mkdirSync(installDirectory, { recursive: true })
    fs.writeFileSync(userDataPath, 'not-a-directory', 'utf8')

    expect(() =>
      ensurePrimaryDatabasePath({
        userDataPath,
        isDevelopment: false,
        installDirectory
      })
    ).toThrow('数据库目录不可写')
  })
})

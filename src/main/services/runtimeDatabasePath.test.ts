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
    ).toBe(path.join('D:/DudeAcc/dude-app', RUNTIME_DATABASE_DIRECTORY_NAME))
  })

  it('migrates the legacy packaged database from userData on first launch', () => {
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
      path.join(installDirectory, RUNTIME_DATABASE_DIRECTORY_NAME, PRIMARY_DATABASE_FILE_NAME)
    )
    expect(state.legacyPath).toBe(legacyDbPath)
    expect(state.migrated).toBe(true)
    expect(fs.readFileSync(state.targetPath, 'utf8')).toBe('legacy-db')
    expect(fs.readFileSync(`${state.targetPath}-wal`, 'utf8')).toBe('legacy-wal')
  })

  it('throws a clear error when the packaged data directory is not writable', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-runtime-db-'))
    const userDataPath = path.join(tempDir, 'userData')
    const installDirectoryAsFile = path.join(tempDir, 'install-root-file')
    fs.mkdirSync(userDataPath, { recursive: true })
    fs.writeFileSync(installDirectoryAsFile, 'not-a-directory', 'utf8')

    expect(() =>
      ensurePrimaryDatabasePath({
        userDataPath,
        isDevelopment: false,
        installDirectory: installDirectoryAsFile
      })
    ).toThrow('数据库目录不可写')
  })
})

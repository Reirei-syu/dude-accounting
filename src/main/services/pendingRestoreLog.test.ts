import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingRestoreLog,
  readPendingRestoreLog,
  writePendingRestoreLog
} from './pendingRestoreLog'

describe('pendingRestoreLog service', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
  })

  it('writes, reads and clears pending restore log payload', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-restore-log-'))
    const filePath = path.join(tempDir, 'pending-restore-log.json')

    writePendingRestoreLog(filePath, {
      userId: 1,
      username: 'admin',
      ledgerId: 2,
      targetType: 'backup_package',
      targetId: 3,
      backupPath: 'D:/backup/package.db',
      manifestPath: 'D:/backup/manifest.json',
      backupMode: 'system_db_snapshot'
    })

    expect(readPendingRestoreLog(filePath)).toEqual({
      userId: 1,
      username: 'admin',
      ledgerId: 2,
      targetType: 'backup_package',
      targetId: 3,
      backupPath: 'D:/backup/package.db',
      manifestPath: 'D:/backup/manifest.json',
      backupMode: 'system_db_snapshot'
    })

    clearPendingRestoreLog(filePath)
    expect(readPendingRestoreLog(filePath)).toBeNull()
  })
})

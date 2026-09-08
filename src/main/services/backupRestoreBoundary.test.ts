import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDatabaseMigrations } from '../database/migrations'
import { CURRENT_SCHEMA_VERSION } from '../database/schema'
import { computeFileSha256 } from './fileIntegrity'
import { restoreBackupArtifact } from './backupRecovery'

describe('整库恢复前拒绝损坏载荷', () => {
  let root: string
  let source: string
  let target: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-restore-boundary-'))
    source = path.join(root, 'source.db')
    target = path.join(root, 'target.db')
    const db = new Database(source)
    runDatabaseMigrations(db)
    db.close()
    for (const suffix of ['', '-wal', '-shm'])
      fs.writeFileSync(target + suffix, `original${suffix}`)
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  it('候选库审计写入失败不切换主库，也不更改源备份', () => {
    const checksum = computeFileSha256(source)
    let called = false
    expect(() => restoreBackupArtifact({
      backupPath: source, targetPath: target, manifestPath: null, expectedChecksum: checksum,
      commitCandidate(candidate) {
        called = true
        candidate.exec("INSERT INTO users(username) VALUES('candidate-only')")
        throw new Error('模拟恢复审计失败')
      }
    })).toThrow('模拟恢复审计失败')
    expect(called).toBe(true)
    expect(computeFileSha256(source)).toBe(checksum)
    for (const suffix of ['', '-wal', '-shm'])
      expect(fs.readFileSync(target + suffix, 'utf8')).toBe(`original${suffix}`)
  })
  it('主文件摘要不变时仍拒绝未声明 WAL', () => {
    const checksum = computeFileSha256(source)
    const db = new Database(source)
    db.pragma('journal_mode = WAL')
    db.pragma('wal_checkpoint(TRUNCATE)')
    const mainChecksum = computeFileSha256(source)
    db.exec("INSERT INTO users(username) VALUES('unlisted-wal-user')")
    try {
      expect(computeFileSha256(source)).toBe(mainChecksum)
      expect(fs.statSync(`${source}-wal`).size).toBeGreaterThan(0)
      expect(() =>
        restoreBackupArtifact({
          backupPath: source,
          targetPath: target,
          manifestPath: null,
          expectedChecksum: mainChecksum
        })
      ).toThrow('旁置日志')
      for (const suffix of ['', '-wal', '-shm'])
        expect(fs.readFileSync(target + suffix, 'utf8')).toBe(`original${suffix}`)
      expect(checksum).toHaveLength(64)
    } finally {
      db.close()
    }
  })
  it.each(['future', 'missing-table', 'foreign-key', 'garbage', 'empty', 'manifest-version'])(
    '拒绝 %s 且原库 sidecar 不变',
    (fault) => {
      if (fault === 'garbage') fs.writeFileSync(source, 'not sqlite')
      else {
        const db = new Database(source)
        if (fault === 'future') db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`)
        if (fault === 'missing-table') db.exec('DROP TABLE user_preferences')
        if (fault === 'foreign-key')
          db.exec(
            "PRAGMA foreign_keys=OFF; INSERT INTO user_preferences(user_id,key,value) VALUES(999,'test','bad')"
          )
        db.close()
        if (fault === 'empty') {
          fs.rmSync(source)
          new Database(source).close()
        }
      }
      const checksum = computeFileSha256(source)
      const manifestPath = path.join(root, 'manifest.json')
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          schemaVersion: fault === 'manifest-version' ? '9.0' : '1.0',
          packageType: 'system_backup',
          databaseFile: 'source.db',
          checksum,
          fileSize: fs.statSync(source).size
        })
      )
      const originalSource = fs.readFileSync(source)
      expect(() =>
        restoreBackupArtifact({
          backupPath: source,
          targetPath: target,
          manifestPath,
          expectedChecksum: checksum
        })
      ).toThrow()
      for (const suffix of ['', '-wal', '-shm'])
        expect(fs.readFileSync(target + suffix, 'utf8')).toBe(`original${suffix}`)
      expect(fs.readFileSync(source)).toEqual(originalSource)
      expect(fs.existsSync(`${target}.recovery`)).toBe(false)
    }
  )
})

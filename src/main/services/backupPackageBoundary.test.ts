import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeFileSha256 } from './fileIntegrity'
import { type LedgerBackupManifest, validateLedgerBackupArtifact } from './backupRecovery'

describe('账套包附件信任边界', () => {
  let root: string
  let databasePath: string
  let manifestPath: string
  let manifest: LedgerBackupManifest
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-package-boundary-'))
    databasePath = path.join(root, 'ledger.db')
    manifestPath = path.join(root, 'manifest.json')
    fs.mkdirSync(path.join(root, 'electronic-vouchers'))
    const attachmentPath = path.join(root, 'electronic-vouchers', '凭证.pdf')
    fs.writeFileSync(attachmentPath, 'attachment')
    const checksum = computeFileSha256(attachmentPath)
    const db = new Database(databasePath)
    db.exec('CREATE TABLE ledgers(id INTEGER PRIMARY KEY); INSERT INTO ledgers VALUES(1)')
    db.exec(
      'CREATE TABLE users(id INTEGER PRIMARY KEY, username TEXT); CREATE TABLE user_preferences(user_id INTEGER, key TEXT, value TEXT)'
    )
    db.exec(
      'CREATE TABLE electronic_voucher_files (stored_name TEXT, stored_path TEXT, sha256 TEXT, file_size INTEGER)'
    )
    db.prepare('INSERT INTO electronic_voucher_files VALUES (?, ?, ?, ?)').run(
      '凭证.pdf',
      'electronic-vouchers/凭证.pdf',
      checksum,
      10
    )
    db.close()
    manifest = {
      schemaVersion: '2.1',
      packageType: 'ledger_backup',
      ledgerId: 1,
      ledgerName: '测试',
      period: null,
      fiscalYear: null,
      createdAt: '2026-09-08',
      databaseFile: 'ledger.db',
      checksum: computeFileSha256(databasePath),
      fileSize: fs.statSync(databasePath).size,
      settingsAssets: [],
      attachments: [
        {
          storedName: '凭证.pdf',
          originalName: '凭证.pdf',
          relativePath: 'electronic-vouchers/凭证.pdf',
          checksum,
          fileSize: 10
        }
      ]
    }
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  const validate = (): ReturnType<typeof validateLedgerBackupArtifact> => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    return validateLedgerBackupArtifact(databasePath, manifestPath)
  }
  it.each(['2.0', '2.1'] as const)('接受合法 %s 附件清单', (version) => {
    manifest.schemaVersion = version
    if (version === '2.0') delete manifest.settingsAssets
    expect(validate().valid).toBe(true)
  })
  it.each([
    '../outside.pdf',
    'C:/outside.pdf',
    '//server/share/a.pdf',
    'electronic-vouchers\\凭证.pdf',
    'electronic-vouchers/../凭证.pdf'
  ])('拒绝清单路径 %s', (relativePath) => {
    manifest.attachments[0].relativePath = relativePath
    expect(validate().valid).toBe(false)
  })
  it('拒绝重复清单文件', () => {
    manifest.attachments.push({ ...manifest.attachments[0] })
    expect(validate().error).toContain('重复')
  })
  it('拒绝未声明文件', () => {
    fs.writeFileSync(path.join(root, 'extra.txt'), 'extra')
    expect(validate().error).toContain('未声明')
  })
  it.each(['stored_name', 'stored_path', 'sha256', 'file_size'])(
    '即使数据库摘要重新计算也拒绝记录不对应：%s',
    (column) => {
      const db = new Database(databasePath)
      db.prepare(`UPDATE electronic_voucher_files SET ${column} = ?`).run(
        column === 'file_size' ? 99 : '../tampered'
      )
      db.close()
      manifest.checksum = computeFileSha256(databasePath)
      manifest.fileSize = fs.statSync(databasePath).size
      expect(validate().valid).toBe(false)
    }
  )
  it('拒绝数据库重复附件记录', () => {
    const db = new Database(databasePath)
    db.exec('INSERT INTO electronic_voucher_files SELECT * FROM electronic_voucher_files')
    db.close()
    manifest.checksum = computeFileSha256(databasePath)
    expect(validate().valid).toBe(false)
  })
  it('拒绝内容摘要错误', () => {
    fs.writeFileSync(path.join(root, 'electronic-vouchers', '凭证.pdf'), 'different!')
    expect(validate().error).toContain('校验失败')
  })
  it.each(['多账套', '清单账套不对应', '混入其他账套行'])('拒绝%s', (fault) => {
    const db = new Database(databasePath)
    if (fault === '多账套') db.exec('INSERT INTO ledgers VALUES(2)')
    if (fault === '清单账套不对应') manifest.ledgerId = 2
    if (fault === '混入其他账套行')
      db.exec('CREATE TABLE records(ledger_id INTEGER); INSERT INTO records VALUES(2)')
    db.close()
    manifest.checksum = computeFileSha256(databasePath)
    manifest.fileSize = fs.statSync(databasePath).size
    expect(validate().valid).toBe(false)
  })
})

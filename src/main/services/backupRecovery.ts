import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { assertSynchronousOperation } from './auditedTransaction'
import { requireOperationId } from './fileOperationJournal'
import { hashPassword } from '../security/password'
import {
  buildTimestampToken,
  buildUniqueDirectoryPath,
  computeFileSha256,
  ensureDirectory,
  sanitizePathSegment
} from './fileIntegrity'
import { formatLocalDateTime } from './localTime'
import { requireStoredFilename, resolveContainedPath } from './containedPath'
import { switchDatabaseFile, withDatabaseImportStaging } from './databaseFileSwitch'
import { withDatabaseSnapshot } from '../database/databaseSnapshot'
import { runDatabaseMigrations } from '../database/migrations'
import {
  checkDatabaseIntegrity,
  getSchemaObjects,
  quoteIdentifier
} from '../database/migrationSchema'
import { CURRENT_SCHEMA_VERSION } from '../database/schema'
import { LAST_LOGIN_USER_ID_KEY, USER_WALLPAPER_KEY } from './wallpaperPreference'

export interface BackupManifest {
  schemaVersion: '1.0'
  packageType: 'system_backup'
  ledgerId: number
  ledgerName: string | null
  period: string | null
  fiscalYear: string | null
  createdAt: string
  databaseFile: string
  checksum: string
  fileSize: number
}

export interface BackupArtifactResult {
  packageDir: string
  backupPath: string
  manifestPath: string
  checksum: string
  fileSize: number
  createdAt: string
}

export interface LedgerBackupAttachment {
  relativePath: string
  originalName: string
  storedName: string
  checksum: string
  fileSize: number
}

export interface LedgerBackupSettingsAsset {
  ownerUsername: string
  kind: 'wallpaper'
  relativePath: string
  checksum: string
  fileSize: number
}

export interface LedgerBackupManifest {
  schemaVersion: '2.0' | '2.1'
  packageType: 'ledger_backup'
  ledgerId: number | string
  ledgerName: string | null
  period: string | null
  fiscalYear: string | null
  createdAt: string
  databaseFile: string
  checksum: string
  fileSize: number
  attachments: LedgerBackupAttachment[]
  settingsAssets?: LedgerBackupSettingsAsset[]
}

export interface LedgerBackupArtifactResult {
  packageDir: string
  backupPath: string
  manifestPath: string
  checksum: string
  fileSize: number
  createdAt: string
  attachments: LedgerBackupAttachment[]
  settingsAssets: LedgerBackupSettingsAsset[]
}

export interface BackupValidationResult {
  valid: boolean
  actualChecksum: string | null
  error?: string
  manifest?: BackupManifest | null
}

export interface LedgerBackupValidationResult {
  valid: boolean
  actualChecksum: string | null
  error?: string
  manifest?: LedgerBackupManifest | null
}

export interface LedgerBackupImportResult {
  importedLedgerId: number
  importedLedgerName: string
}

export interface BackupRestoreResult {
  targetPath: string
  fileSize: number
}

export interface ResolvedBackupArtifactPaths {
  backupPath: string
  manifestPath: string
}

function tryResolveDirectBackupArtifactPaths(
  packageDir: string
): ResolvedBackupArtifactPaths | null {
  const manifestPath = path.join(packageDir, 'manifest.json')
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return null
  }

  const databaseFiles = fs
    .readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.db'))
    .map((entry) => path.join(packageDir, entry.name))

  if (databaseFiles.length !== 1) {
    throw new Error('所选备份包目录必须且只能包含一个数据库备份文件')
  }

  return {
    backupPath: databaseFiles[0],
    manifestPath
  }
}

function buildBackupPackageName(
  ledgerName?: string | null,
  period?: string | null,
  fiscalYear?: string | null,
  now: Date = new Date()
): string {
  const ledgerLabel = sanitizePathSegment(ledgerName?.trim() || '未命名账套', '未命名账套')
  if (!period?.trim() && !fiscalYear?.trim()) {
    return `${ledgerLabel}_备份_${buildTimestampToken(now)}`
  }

  const periodLabel = sanitizePathSegment(
    period?.trim() || fiscalYear?.trim() || '未设置期间',
    '未设置期间'
  )
  return `${ledgerLabel}_${periodLabel}_备份包`
}

function writeBackupManifest(packageDir: string, manifest: BackupManifest): string {
  const manifestPath = path.join(packageDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}

function writeLedgerBackupManifest(packageDir: string, manifest: LedgerBackupManifest): string {
  const manifestPath = path.join(packageDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}

function trimLedgerBackupDatabase(db: Database.Database, ledgerId: number): void {
  db.exec('PRAGMA foreign_keys = ON;')
  db.prepare('DELETE FROM ledgers WHERE id <> ?').run(ledgerId)

  db.prepare(`DELETE FROM electronic_voucher_records WHERE ledger_id <> ?`).run(ledgerId)
  db.prepare(`DELETE FROM electronic_voucher_files WHERE ledger_id <> ?`).run(ledgerId)
  db.prepare(`DELETE FROM operation_logs WHERE ledger_id IS NULL OR ledger_id <> ?`).run(ledgerId)
  db.prepare(`DELETE FROM user_ledger_permissions WHERE ledger_id <> ?`).run(ledgerId)
  for (const tableName of ['backup_packages', 'archive_exports']) {
    db.exec(`DELETE FROM ${tableName}`)
  }
}

function copyLedgerAttachments(
  db: Database.Database,
  packageDir: string
): LedgerBackupAttachment[] {
  const attachmentDir = path.join(packageDir, 'electronic-vouchers')
  ensureDirectory(attachmentDir)
  const rows = db
    .prepare(
      `SELECT id, original_name, stored_name, stored_path, sha256, file_size
         FROM electronic_voucher_files
        ORDER BY id ASC`
    )
    .all() as Array<{
    id: number
    original_name: string
    stored_name: string
    stored_path: string
    sha256: string
    file_size: number
  }>

  const updateStoredPath = db.prepare(
    `UPDATE electronic_voucher_files
        SET stored_name = ?, stored_path = ?, sha256 = ?, file_size = ?
      WHERE id = ?`
  )

  const attachments: LedgerBackupAttachment[] = []
  const reservedNames = new Set<string>()
  for (const row of rows) {
    requireStoredFilename(row.stored_name)
    reservedNames.add(row.stored_name.toLowerCase())
  }
  const usedNames = new Set<string>()
  for (const row of rows) {
    if (!fs.existsSync(row.stored_path)) {
      throw new Error(`电子凭证附件缺失：${row.stored_path}`)
    }

    // 运行时按 operation 目录隔离同名原件；扁平备份仅在副本内消歧。
    let storedName = row.stored_name
    if (usedNames.has(storedName.toLowerCase())) {
      const extension = path.extname(storedName).slice(0, 16)
      let suffix = 0
      do {
        storedName = `file-${row.id}-${suffix++}${extension}`
      } while (reservedNames.has(storedName.toLowerCase()))
      requireStoredFilename(storedName)
      reservedNames.add(storedName.toLowerCase())
    }
    usedNames.add(storedName.toLowerCase())
    const relativePath = path.posix.join('electronic-vouchers', storedName)
    const targetPath = resolveContainedPath(packageDir, relativePath)
    fs.copyFileSync(row.stored_path, targetPath)
    const attachmentChecksum = computeFileSha256(targetPath)
    const attachmentFileSize = fs.statSync(targetPath).size
    updateStoredPath.run(storedName, relativePath, attachmentChecksum, attachmentFileSize, row.id)
    attachments.push({
      relativePath,
      originalName: row.original_name,
      storedName,
      checksum: attachmentChecksum,
      fileSize: attachmentFileSize
    })
  }

  return attachments
}

function deriveUserDataPathFromDatabasePath(databasePath: string): string {
  const parentDir = path.dirname(databasePath)
  if (path.basename(parentDir).toLowerCase() === 'data') {
    return path.dirname(parentDir)
  }
  return parentDir
}

function copyLedgerSettingsAssets(
  db: Database.Database,
  sourceUserDataPath: string,
  packageDir: string
): LedgerBackupSettingsAsset[] {
  const wallpaperRows = db
    .prepare(
      `SELECT u.username, up.value AS relative_path
         FROM user_preferences up
         INNER JOIN users u ON u.id = up.user_id
        WHERE up.key = ?
          AND TRIM(up.value) <> ''
        ORDER BY u.username ASC`
    )
    .all(USER_WALLPAPER_KEY) as Array<{
    username: string
    relative_path: string
  }>

  if (wallpaperRows.length === 0) {
    return []
  }

  const settingsAssetDir = path.join(packageDir, 'settings-assets')
  ensureDirectory(settingsAssetDir)

  const assets: LedgerBackupSettingsAsset[] = []
  for (const row of wallpaperRows) {
    const sourcePath = resolveContainedPath(sourceUserDataPath, row.relative_path)
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new Error(`备份缺少用户壁纸文件：${row.username}`)
    }

    const extension = path.extname(sourcePath).toLowerCase()
    const assetFileName = `${sanitizePathSegment(row.username, 'user')}-wallpaper${extension}`
    const relativePath = path.posix.join('settings-assets', assetFileName)
    const targetPath = path.join(settingsAssetDir, assetFileName)

    fs.copyFileSync(sourcePath, targetPath)

    assets.push({
      ownerUsername: row.username,
      kind: 'wallpaper',
      relativePath,
      checksum: computeFileSha256(targetPath),
      fileSize: fs.statSync(targetPath).size
    })
  }

  return assets
}

export function resolveBackupArtifactPaths(packageDir: string): ResolvedBackupArtifactPaths {
  if (!fs.existsSync(packageDir) || !fs.statSync(packageDir).isDirectory()) {
    throw new Error('所选恢复路径不是有效的备份包目录')
  }

  const directPackage = tryResolveDirectBackupArtifactPaths(packageDir)
  if (directPackage) {
    return directPackage
  }

  const candidatePackages = fs
    .readdirSync(packageDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packageDir, entry.name))
    .flatMap((childDir) => {
      try {
        const resolved = tryResolveDirectBackupArtifactPaths(childDir)
        return resolved ? [resolved] : []
      } catch {
        return []
      }
    })

  if (candidatePackages.length === 1) {
    return candidatePackages[0]
  }

  if (candidatePackages.length > 1) {
    throw new Error('所选目录中包含多个备份包，请进入具体备份目录后再导入')
  }

  throw new Error('所选目录中未找到备份包')
}

export function createBackupArtifact(input: {
  sourcePath: string
  backupDir: string
  ledgerId: number
  ledgerName?: string | null
  period?: string | null
  fiscalYear?: string | null
  now?: Date
}): BackupArtifactResult {
  ensureDirectory(input.backupDir)

  const preferredPackageName = buildBackupPackageName(
    input.ledgerName,
    input.period,
    input.fiscalYear,
    input.now
  )
  const packageDir = buildUniqueDirectoryPath(input.backupDir, preferredPackageName)
  const packageName = path.basename(packageDir)
  const filename = `${packageName}.db`
  const backupPath = path.join(packageDir, filename)
  const createdAt = formatLocalDateTime(input.now ?? new Date())

  ensureDirectory(packageDir)
  fs.copyFileSync(input.sourcePath, backupPath)

  const checksum = computeFileSha256(backupPath)
  const fileSize = fs.statSync(backupPath).size
  const manifestPath = writeBackupManifest(packageDir, {
    schemaVersion: '1.0',
    packageType: 'system_backup',
    ledgerId: input.ledgerId,
    ledgerName: input.ledgerName?.trim() || null,
    period: input.period ?? null,
    fiscalYear: input.fiscalYear ?? null,
    createdAt,
    databaseFile: filename,
    checksum,
    fileSize
  })

  return {
    packageDir,
    backupPath,
    manifestPath,
    checksum,
    fileSize,
    createdAt
  }
}

export function createLedgerBackupArtifact(input: {
  sourcePath: string
  backupDir: string
  ledgerId: number
  ledgerName?: string | null
  period?: string | null
  fiscalYear?: string | null
  now?: Date
}): LedgerBackupArtifactResult {
  ensureDirectory(input.backupDir)

  const preferredPackageName = buildBackupPackageName(
    input.ledgerName,
    input.period,
    input.fiscalYear,
    input.now
  )
  const packageDir = buildUniqueDirectoryPath(input.backupDir, preferredPackageName)
  const packageName = path.basename(packageDir)
  const backupPath = path.join(packageDir, `${packageName}.db`)
  const createdAt = formatLocalDateTime(input.now ?? new Date())
  const sourceUserDataPath = deriveUserDataPathFromDatabasePath(input.sourcePath)

  ensureDirectory(packageDir)
  fs.copyFileSync(input.sourcePath, backupPath)

  // Node 文件操作可处理长路径，SQLite 在 Windows 上需显式扩展路径。
  const packageDb = new Database(path.toNamespacedPath(backupPath))
  let attachments: LedgerBackupAttachment[] = []
  let settingsAssets: LedgerBackupSettingsAsset[] = []
  try {
    trimLedgerBackupDatabase(packageDb, input.ledgerId)
    attachments = copyLedgerAttachments(packageDb, packageDir)
    settingsAssets = copyLedgerSettingsAssets(packageDb, sourceUserDataPath, packageDir)
    packageDb.exec('VACUUM;')
  } finally {
    packageDb.close()
  }

  const checksum = computeFileSha256(backupPath)
  const fileSize = fs.statSync(backupPath).size
  const manifestPath = writeLedgerBackupManifest(packageDir, {
    schemaVersion: '2.1',
    packageType: 'ledger_backup',
    ledgerId: input.ledgerId,
    ledgerName: input.ledgerName?.trim() || null,
    period: input.period ?? null,
    fiscalYear: input.fiscalYear ?? null,
    createdAt,
    databaseFile: path.basename(backupPath),
    checksum,
    fileSize,
    attachments,
    settingsAssets
  })

  return {
    packageDir,
    backupPath,
    manifestPath,
    checksum,
    fileSize,
    createdAt,
    attachments,
    settingsAssets
  }
}

export function validateBackupArtifact(
  filePath: string,
  expectedChecksum: string,
  manifestPath?: string | null
): BackupValidationResult {
  if (['-wal', '-shm', '-journal'].some((suffix) => fs.existsSync(filePath + suffix))) {
    return {
      valid: false,
      actualChecksum: null,
      error: '备份载荷必须是独立数据库文件，不允许旁置日志',
      manifest: null
    }
  }
  if (!fs.existsSync(filePath)) {
    return { valid: false, actualChecksum: null, error: '备份文件不存在', manifest: null }
  }

  const actualChecksum = computeFileSha256(filePath)
  if (actualChecksum !== expectedChecksum) {
    return { valid: false, actualChecksum, error: '备份文件校验失败', manifest: null }
  }

  let manifest: BackupManifest | null = null
  if (manifestPath) {
    if (!fs.existsSync(manifestPath)) {
      return { valid: false, actualChecksum, error: '备份清单文件不存在', manifest: null }
    }

    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest
    } catch {
      return { valid: false, actualChecksum, error: '备份清单文件损坏', manifest: null }
    }

    const fileSize = fs.statSync(filePath).size
    const isManifestValid =
      manifest !== null &&
      manifest.schemaVersion === '1.0' &&
      manifest.packageType === 'system_backup' &&
      manifest.databaseFile === path.basename(filePath) &&
      manifest.checksum === actualChecksum &&
      manifest.fileSize === fileSize

    if (!isManifestValid) {
      return {
        valid: false,
        actualChecksum,
        error: '备份清单与备份文件不一致',
        manifest
      }
    }
  }

  return { valid: true, actualChecksum, manifest }
}

export function validateLedgerBackupArtifact(
  filePath: string,
  manifestPath: string
): LedgerBackupValidationResult {
  if (!fs.existsSync(filePath)) {
    return { valid: false, actualChecksum: null, error: '账套备份载荷文件不存在', manifest: null }
  }

  const actualChecksum = computeFileSha256(filePath)
  if (!fs.existsSync(manifestPath)) {
    return { valid: false, actualChecksum, error: '账套备份清单不存在', manifest: null }
  }

  let manifest: LedgerBackupManifest | null = null
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as LedgerBackupManifest
  } catch {
    return { valid: false, actualChecksum, error: '账套备份清单损坏', manifest: null }
  }

  // 兼容旧 CLI 的数字字符串 ID，仅归一化比较值，保留原清单及规划摘要。
  const rawLedgerId: unknown = manifest?.ledgerId
  const ledgerId =
    typeof rawLedgerId === 'string' && /^\d+$/.test(rawLedgerId.trim())
      ? Number(rawLedgerId.trim())
      : rawLedgerId
  if (typeof ledgerId !== 'number' || !Number.isSafeInteger(ledgerId) || ledgerId <= 0) {
    return {
      valid: false,
      actualChecksum,
      error: '账套备份清单中的账套 ID 必须为有效正整数',
      manifest
    }
  }
  const fileSize = fs.statSync(filePath).size
  const isManifestValid =
    manifest !== null &&
    (manifest.schemaVersion === '2.0' || manifest.schemaVersion === '2.1') &&
    manifest.packageType === 'ledger_backup' &&
    manifest.databaseFile === path.basename(filePath) &&
    manifest.checksum === actualChecksum &&
    manifest.fileSize === fileSize &&
    Array.isArray(manifest.attachments) &&
    (manifest.schemaVersion !== '2.1' || Array.isArray(manifest.settingsAssets))

  if (!isManifestValid) {
    return {
      valid: false,
      actualChecksum,
      error: '账套备份清单与载荷文件不一致',
      manifest
    }
  }

  try {
    const packageDir = path.dirname(manifestPath)
    requireStoredFilename(manifest.databaseFile)
    if (resolveContainedPath(packageDir, manifest.databaseFile) !== path.resolve(filePath)) {
      throw new Error('备份数据库必须位于备份包内')
    }
    resolveContainedPath(packageDir, path.basename(manifestPath))
    const declaredPaths = new Set<string>([
      manifest.databaseFile.toLowerCase(),
      path.basename(manifestPath).toLowerCase()
    ])
    for (const entry of [...manifest.attachments, ...(manifest.settingsAssets ?? [])]) {
      resolveContainedPath(packageDir, entry.relativePath)
      const key = entry.relativePath.toLowerCase()
      if (declaredPaths.has(key)) throw new Error('备份清单包含重复文件')
      declaredPaths.add(key)
    }
    for (const attachment of manifest.attachments) {
      requireStoredFilename(attachment.storedName)
      if (attachment.relativePath !== `electronic-vouchers/${attachment.storedName}`) {
        throw new Error('附件存储名称与相对路径不一致')
      }
    }
    withDatabaseSnapshot(filePath, (copy) => {
      if (computeFileSha256(copy) !== actualChecksum) throw new Error('校验期间备份载荷发生变化')
      const packageDb = new Database(copy, { readonly: true, fileMustExist: true })
      try {
        const schemaVersion = packageDb.pragma('user_version', { simple: true }) as number
        if (
          !Number.isInteger(schemaVersion) ||
          schemaVersion < 0 ||
          schemaVersion > CURRENT_SCHEMA_VERSION
        ) {
          throw new Error('账套载荷数据库版本不受支持')
        }
        checkDatabaseIntegrity(packageDb)
        const ledgers = packageDb.prepare('SELECT id FROM ledgers').all() as Array<{ id: number }>
        if (ledgers.length !== 1 || ledgers[0].id !== ledgerId)
          throw new Error('备份包必须仅包含清单声明的一个账套')
        for (const object of getSchemaObjects(packageDb).filter(
          (object) => object.type === 'table'
        )) {
          const table = quoteIdentifier(object.name)
          const columns = packageDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{
            name: string
          }>
          if (
            columns.some((column) => column.name === 'ledger_id') &&
            packageDb
              .prepare(
                `SELECT 1 FROM ${table} WHERE ledger_id IS NOT NULL AND ledger_id <> ? LIMIT 1`
              )
              .get(ledgerId)
          ) {
            throw new Error(`备份包混入其他账套记录：${object.name}`)
          }
        }
        const rows = packageDb
          .prepare(
            'SELECT stored_name, stored_path, sha256, file_size FROM electronic_voucher_files'
          )
          .all() as Array<{
          stored_name: string
          stored_path: string
          sha256: string
          file_size: number
        }>
        if (rows.length !== manifest.attachments.length)
          throw new Error('数据库附件记录与清单数量不一致')
        const matched = new Set<string>()
        for (const row of rows) {
          requireStoredFilename(row.stored_name)
          resolveContainedPath(packageDir, row.stored_path)
          const attachment = manifest.attachments.find(
            (item) => item.relativePath === row.stored_path
          )
          if (
            !attachment ||
            matched.has(row.stored_path.toLowerCase()) ||
            attachment.storedName !== row.stored_name ||
            attachment.checksum !== row.sha256 ||
            attachment.fileSize !== row.file_size
          )
            throw new Error('数据库附件记录与清单不一致或重复')
          matched.add(row.stored_path.toLowerCase())
        }
        if (manifest.schemaVersion === '2.1' || manifest.settingsAssets?.length) {
          const owners = new Set<string>()
          for (const asset of manifest.settingsAssets ?? []) {
            if (
              asset.kind !== 'wallpaper' ||
              typeof asset.ownerUsername !== 'string' ||
              owners.has(asset.ownerUsername)
            ) {
              throw new Error('设置资产类型或用户对应关系无效')
            }
            if (!asset.relativePath.startsWith('settings-assets/'))
              throw new Error('设置资产路径不在受控目录')
            const owner = packageDb
              .prepare('SELECT id FROM users WHERE username = ?')
              .get(asset.ownerUsername) as { id: number } | undefined
            if (
              !owner ||
              !packageDb
                .prepare(
                  'SELECT 1 FROM user_preferences WHERE user_id = ? AND key = ? AND TRIM(value) <> ?'
                )
                .get(owner.id, USER_WALLPAPER_KEY, '')
            ) {
              throw new Error('设置资产缺少对应用户壁纸记录')
            }
            owners.add(asset.ownerUsername)
          }
          const preferences = packageDb
            .prepare(
              'SELECT u.username, up.value FROM user_preferences up JOIN users u ON u.id = up.user_id WHERE up.key = ? AND TRIM(up.value) <> ?'
            )
            .all(USER_WALLPAPER_KEY, '') as Array<{ username: string; value: string }>
          for (const preference of preferences) {
            resolveContainedPath(packageDir, preference.value)
            if (!owners.has(preference.username)) throw new Error('用户壁纸记录缺少对应设置资产')
          }
          if (preferences.length !== owners.size)
            throw new Error('设置资产与用户壁纸记录数量不一致')
        }
      } finally {
        packageDb.close()
      }
    })
    const inspectFiles = (relativeDir: string): void => {
      const directory = relativeDir ? resolveContainedPath(packageDir, relativeDir) : packageDir
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
        const absolute = resolveContainedPath(packageDir, relative)
        if (entry.isDirectory()) inspectFiles(relative)
        else if (!fs.lstatSync(absolute).isFile() || !declaredPaths.has(relative.toLowerCase())) {
          throw new Error(`备份包包含未声明文件：${relative}`)
        }
      }
    }
    for (const attachment of manifest.attachments) {
      const attachmentPath = resolveContainedPath(packageDir, attachment.relativePath)
      if (!fs.existsSync(attachmentPath)) {
        return {
          valid: false,
          actualChecksum,
          error: `账套备份附件缺失：${attachment.relativePath}`,
          manifest
        }
      }

      const attachmentChecksum = computeFileSha256(attachmentPath)
      if (attachmentChecksum !== attachment.checksum) {
        return {
          valid: false,
          actualChecksum,
          error: `账套备份附件校验失败：${attachment.relativePath}`,
          manifest
        }
      }

      const attachmentSize = fs.statSync(attachmentPath).size
      if (attachmentSize !== attachment.fileSize) {
        return {
          valid: false,
          actualChecksum,
          error: `账套备份附件大小不一致：${attachment.relativePath}`,
          manifest
        }
      }
    }

    for (const settingsAsset of manifest.settingsAssets ?? []) {
      const assetPath = resolveContainedPath(packageDir, settingsAsset.relativePath)
      if (!fs.existsSync(assetPath)) {
        return {
          valid: false,
          actualChecksum,
          error: `备份设置资产缺失：${settingsAsset.relativePath}`,
          manifest
        }
      }

      const assetChecksum = computeFileSha256(assetPath)
      if (assetChecksum !== settingsAsset.checksum) {
        return {
          valid: false,
          actualChecksum,
          error: `备份设置资产校验失败：${settingsAsset.relativePath}`,
          manifest
        }
      }

      const assetSize = fs.statSync(assetPath).size
      if (assetSize !== settingsAsset.fileSize) {
        return {
          valid: false,
          actualChecksum,
          error: `备份设置资产大小不一致：${settingsAsset.relativePath}`,
          manifest
        }
      }
    }

    inspectFiles('')
    return { valid: true, actualChecksum, manifest }
  } catch (error) {
    return {
      valid: false,
      actualChecksum,
      manifest,
      error: error instanceof Error ? error.message : '备份包校验失败'
    }
  }
}

function resolveImportedLedgerName(
  targetDb: Database.Database,
  sourceLedgerName: string | null
): string {
  const baseName = sourceLedgerName?.trim() || '导入账套'
  const exists = (ledgerName: string): boolean =>
    Boolean(targetDb.prepare('SELECT id FROM ledgers WHERE name = ?').get(ledgerName))

  if (!exists(baseName)) {
    return baseName
  }

  const importedName = `${baseName}（导入）`
  if (!exists(importedName)) {
    return importedName
  }

  let suffix = 2
  while (exists(`${baseName}（导入${suffix}）`)) {
    suffix += 1
  }
  return `${baseName}（导入${suffix}）`
}

function requireMappedId(
  idMap: Map<number, number>,
  sourceId: number,
  entityLabel: string
): number {
  const targetId = idMap.get(sourceId)
  if (targetId === undefined) {
    throw new Error(`${entityLabel} 映射缺失：${sourceId}`)
  }
  return targetId
}

function hasLedgerColumn(db: Database.Database, columnName: string): boolean {
  const columns = db.prepare("PRAGMA table_info('ledgers')").all() as Array<{ name: string }>
  return columns.some((column) => column.name === columnName)
}

interface LedgerImportInput {
  operationId?: string
  expectedManifestDigest?: string
  preparedAssets?: (staging: string, finalPath: string) => undefined
  backupPath: string
  manifestPath: string
  targetPath: string
  attachmentRootDir: string
  operatorUserId: number
  operatorIsAdmin: boolean
  beforeSwitch?: () => void
  appendImportLog?: (db: Database.Database, result: LedgerBackupImportResult) => void
}

export function importLedgerBackupArtifact(input: LedgerImportInput): LedgerBackupImportResult {
  const validation = validateLedgerBackupArtifact(input.backupPath, input.manifestPath)
  if (!validation.valid || !validation.manifest)
    throw new Error(validation.error ?? '账套备份包校验失败')
  if (
    input.expectedManifestDigest &&
    createHash('sha256').update(JSON.stringify(validation.manifest)).digest('hex') !==
      input.expectedManifestDigest
  )
    throw new Error('操作规划后源备份清单发生变化，禁止导入')
  const generation = input.operationId ? requireOperationId(input.operationId) : randomUUID()
  const parent = path.dirname(path.resolve(input.targetPath))
  const finalAssets = resolveContainedPath(parent, `import-assets/${generation}`)
  const manifest = validation.manifest
  return withDatabaseImportStaging(input.targetPath, (staging) => {
    const snapshotRoot = resolveContainedPath(staging, 'package')
    fs.mkdirSync(snapshotRoot)
    const sourceRoot = path.dirname(input.manifestPath)
    const files = [
      {
        relativePath: manifest.databaseFile,
        checksum: manifest.checksum,
        fileSize: manifest.fileSize
      },
      ...manifest.attachments,
      ...(manifest.settingsAssets ?? [])
    ]
    for (const file of files) {
      const source = resolveContainedPath(sourceRoot, file.relativePath)
      const destination = resolveContainedPath(snapshotRoot, file.relativePath)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination)
      if (
        computeFileSha256(destination) !== file.checksum ||
        fs.statSync(destination).size !== file.fileSize
      ) {
        throw new Error('创建导入副本时源包发生变化或复制不完整')
      }
    }
    const snapshotManifest = resolveContainedPath(snapshotRoot, 'manifest.json')
    const snapshotDatabase = resolveContainedPath(snapshotRoot, manifest.databaseFile)
    const sourceCopy = new Database(snapshotDatabase)
    try {
      runDatabaseMigrations(sourceCopy, {
        backupDirectory: resolveContainedPath(staging, 'migration-backups')
      })
      sourceCopy.pragma('wal_checkpoint(TRUNCATE)')
      sourceCopy.pragma('journal_mode = DELETE')
    } finally {
      sourceCopy.close()
    }
    const upgradedManifest = {
      ...manifest,
      checksum: computeFileSha256(snapshotDatabase),
      fileSize: fs.statSync(snapshotDatabase).size
    }
    fs.writeFileSync(snapshotManifest, JSON.stringify(upgradedManifest), { flag: 'wx' })
    const assets = resolveContainedPath(staging, 'assets')
    fs.mkdirSync(assets)
    return withDatabaseSnapshot(input.targetPath, (copy) => {
      const result = importLedgerIntoStaging(
        {
          ...input,
          backupPath: resolveContainedPath(snapshotRoot, manifest.databaseFile),
          manifestPath: snapshotManifest,
          targetPath: copy
        },
        assets,
        finalAssets
      )
      if (input.preparedAssets) {
        assertSynchronousOperation(input.preparedAssets as () => unknown)
        if (input.preparedAssets(assets, finalAssets) !== undefined)
          throw new Error('导入附件准备必须同步完成')
      }
      input.beforeSwitch?.()
      switchDatabaseFile(copy, input.targetPath, { preparedPath: assets, generation })
      return result
    })
  })
}

function importLedgerIntoStaging(
  input: LedgerImportInput,
  stagedAssets: string,
  finalAssets: string
): LedgerBackupImportResult {
  const validation = validateLedgerBackupArtifact(input.backupPath, input.manifestPath)
  if (!validation.valid || !validation.manifest) {
    throw new Error(validation.error ?? '账套备份包校验失败')
  }

  const packageDb = new Database(input.backupPath, { readonly: true })
  const targetDb = new Database(input.targetPath)
  const packageDir = path.dirname(input.manifestPath)
  const targetUserDataPath = path.dirname(input.attachmentRootDir)

  try {
    packageDb.exec('PRAGMA foreign_keys = ON;')
    targetDb.exec('PRAGMA foreign_keys = ON; BEGIN;')

    const sourceLedger = packageDb.prepare('SELECT * FROM ledgers LIMIT 1').get() as
      | {
          id: number
          name: string
          standard_type: string
          start_period: string
          current_period: string
          taxpayer_identification_number?: string | null
          created_at: string
        }
      | undefined

    if (!sourceLedger) {
      throw new Error('账套备份包缺少账套数据')
    }

    const importedLedgerName = resolveImportedLedgerName(targetDb, sourceLedger.name)
    const importedLedgerResult = hasLedgerColumn(targetDb, 'taxpayer_identification_number')
      ? targetDb
          .prepare(
            `INSERT INTO ledgers (
               name, standard_type, taxpayer_identification_number, start_period, current_period, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            importedLedgerName,
            sourceLedger.standard_type,
            sourceLedger.taxpayer_identification_number ?? '',
            sourceLedger.start_period,
            sourceLedger.current_period,
            sourceLedger.created_at
          )
      : targetDb
          .prepare(
            `INSERT INTO ledgers (name, standard_type, start_period, current_period, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            importedLedgerName,
            sourceLedger.standard_type,
            sourceLedger.start_period,
            sourceLedger.current_period,
            sourceLedger.created_at
          )
    const importedLedgerId = Number(importedLedgerResult.lastInsertRowid)

    if (!input.operatorIsAdmin) {
      targetDb
        .prepare(
          `INSERT OR IGNORE INTO user_ledger_permissions (user_id, ledger_id, created_at)
           VALUES (?, ?, ?)`
        )
        .run(input.operatorUserId, importedLedgerId, formatLocalDateTime())
    }

    const userIdMap = new Map<number, number>()
    const sourceUserById = new Map<number, { username: string }>()
    const targetUserIdByUsername = new Map<string, number>()
    const sourceUsers = packageDb
      .prepare(
        `SELECT id, username, real_name, password_hash, permissions, is_admin, created_at
           FROM users
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      username: string
      real_name: string
      password_hash: string
      permissions: string
      is_admin: number
      created_at: string
    }>
    const selectUserByUsername = targetDb.prepare('SELECT id FROM users WHERE username = ?')
    const insertUser = targetDb.prepare(
      `INSERT INTO users (username, real_name, password_hash, permissions, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    for (const sourceUser of sourceUsers) {
      sourceUserById.set(sourceUser.id, { username: sourceUser.username })
      const existingUser = selectUserByUsername.get(sourceUser.username) as
        | { id: number }
        | undefined
      if (existingUser) {
        userIdMap.set(sourceUser.id, existingUser.id)
        targetUserIdByUsername.set(sourceUser.username, existingUser.id)
        continue
      }

      const insertedUser = insertUser.run(
        sourceUser.username,
        sourceUser.real_name,
        hashPassword(`imported-history-user:${sourceUser.username}`),
        '{}',
        0,
        sourceUser.created_at
      )
      const targetUserId = Number(insertedUser.lastInsertRowid)
      userIdMap.set(sourceUser.id, targetUserId)
      targetUserIdByUsername.set(sourceUser.username, targetUserId)
    }

    const insertPeriod = targetDb.prepare(
      `INSERT INTO periods (ledger_id, period, is_closed, closed_at)
       VALUES (?, ?, ?, ?)`
    )
    const sourcePeriods = packageDb
      .prepare('SELECT period, is_closed, closed_at FROM periods ORDER BY id ASC')
      .all() as Array<{ period: string; is_closed: number; closed_at: string | null }>
    for (const row of sourcePeriods) {
      insertPeriod.run(importedLedgerId, row.period, row.is_closed, row.closed_at)
    }

    const sourceSubjects = packageDb
      .prepare(
        `SELECT id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system
           FROM subjects
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      code: string
      name: string
      parent_code: string | null
      category: string
      balance_direction: string
      has_auxiliary: number
      is_cash_flow: number
      level: number
      is_system: number
    }>
    const subjectIdMap = new Map<number, number>()
    const insertSubject = targetDb.prepare(
      `INSERT INTO subjects (
         ledger_id, code, name, parent_code, category, balance_direction, has_auxiliary, is_cash_flow, level, is_system
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceSubjects) {
      const inserted = insertSubject.run(
        importedLedgerId,
        row.code,
        row.name,
        row.parent_code,
        row.category,
        row.balance_direction,
        row.has_auxiliary,
        row.is_cash_flow,
        row.level,
        row.is_system
      )
      subjectIdMap.set(row.id, Number(inserted.lastInsertRowid))
    }

    const auxiliaryIdMap = new Map<number, number>()
    const sourceAuxiliaryItems = packageDb
      .prepare(
        `SELECT id, category, code, name, created_at
           FROM auxiliary_items
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      category: string
      code: string
      name: string
      created_at: string
    }>
    const insertAuxiliary = targetDb.prepare(
      `INSERT INTO auxiliary_items (ledger_id, category, code, name, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of sourceAuxiliaryItems) {
      const inserted = insertAuxiliary.run(
        importedLedgerId,
        row.category,
        row.code,
        row.name,
        row.created_at
      )
      auxiliaryIdMap.set(row.id, Number(inserted.lastInsertRowid))
    }

    const insertSubjectAuxiliaryCategory = targetDb.prepare(
      `INSERT INTO subject_auxiliary_categories (subject_id, category)
       VALUES (?, ?)`
    )
    const sourceSubjectAuxiliaryCategories = packageDb
      .prepare(
        `SELECT id, subject_id, category
           FROM subject_auxiliary_categories
          ORDER BY id ASC`
      )
      .all() as Array<{ id: number; subject_id: number; category: string }>
    for (const row of sourceSubjectAuxiliaryCategories) {
      insertSubjectAuxiliaryCategory.run(
        requireMappedId(subjectIdMap, row.subject_id, '科目'),
        row.category
      )
    }

    const insertSubjectAuxiliaryCustomItem = targetDb.prepare(
      `INSERT INTO subject_auxiliary_custom_items (subject_id, auxiliary_item_id)
       VALUES (?, ?)`
    )
    const sourceSubjectAuxiliaryCustomItems = packageDb
      .prepare(
        `SELECT id, subject_id, auxiliary_item_id
           FROM subject_auxiliary_custom_items
          ORDER BY id ASC`
      )
      .all() as Array<{ id: number; subject_id: number; auxiliary_item_id: number }>
    for (const row of sourceSubjectAuxiliaryCustomItems) {
      insertSubjectAuxiliaryCustomItem.run(
        requireMappedId(subjectIdMap, row.subject_id, '科目'),
        requireMappedId(auxiliaryIdMap, row.auxiliary_item_id, '辅助项')
      )
    }

    const cashFlowItemIdMap = new Map<number, number>()
    const sourceCashFlowItems = packageDb
      .prepare(
        `SELECT id, code, name, category, direction, is_system
           FROM cash_flow_items
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      code: string
      name: string
      category: string
      direction: string
      is_system: number
    }>
    const insertCashFlowItem = targetDb.prepare(
      `INSERT INTO cash_flow_items (ledger_id, code, name, category, direction, is_system)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceCashFlowItems) {
      const inserted = insertCashFlowItem.run(
        importedLedgerId,
        row.code,
        row.name,
        row.category,
        row.direction,
        row.is_system
      )
      cashFlowItemIdMap.set(row.id, Number(inserted.lastInsertRowid))
    }

    const sourceCashFlowMappings = packageDb
      .prepare(
        `SELECT subject_code, counterpart_subject_code, entry_direction, cash_flow_item_id
           FROM cash_flow_mappings
          ORDER BY id ASC`
      )
      .all() as Array<{
      subject_code: string
      counterpart_subject_code: string | null
      entry_direction: string | null
      cash_flow_item_id: number
    }>
    const insertCashFlowMapping = targetDb.prepare(
      `INSERT INTO cash_flow_mappings (
         ledger_id, subject_code, counterpart_subject_code, entry_direction, cash_flow_item_id
       ) VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of sourceCashFlowMappings) {
      insertCashFlowMapping.run(
        importedLedgerId,
        row.subject_code,
        row.counterpart_subject_code,
        row.entry_direction,
        requireMappedId(cashFlowItemIdMap, row.cash_flow_item_id, '现金流量项目')
      )
    }

    const sourceCarryForwardRules = packageDb
      .prepare(
        `SELECT from_subject_code, to_subject_code
           FROM pl_carry_forward_rules
          ORDER BY id ASC`
      )
      .all() as Array<{ from_subject_code: string; to_subject_code: string }>
    const insertCarryForwardRule = targetDb.prepare(
      `INSERT INTO pl_carry_forward_rules (ledger_id, from_subject_code, to_subject_code)
       VALUES (?, ?, ?)`
    )
    for (const row of sourceCarryForwardRules) {
      insertCarryForwardRule.run(importedLedgerId, row.from_subject_code, row.to_subject_code)
    }

    const sourceInitialBalances = packageDb
      .prepare(
        `SELECT period, subject_code, debit_amount, credit_amount
           FROM initial_balances
          ORDER BY id ASC`
      )
      .all() as Array<{
      period: string
      subject_code: string
      debit_amount: number
      credit_amount: number
    }>
    const insertInitialBalance = targetDb.prepare(
      `INSERT INTO initial_balances (ledger_id, period, subject_code, debit_amount, credit_amount)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const row of sourceInitialBalances) {
      insertInitialBalance.run(
        importedLedgerId,
        row.period,
        row.subject_code,
        row.debit_amount,
        row.credit_amount
      )
    }

    const voucherIdMap = new Map<number, number>()
    const sourceVouchers = packageDb
      .prepare(
        `SELECT *
           FROM vouchers
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      period: string
      voucher_date: string
      voucher_number: number
      voucher_word: string
      status: number
      deleted_from_status: number | null
      creator_id: number | null
      auditor_id: number | null
      bookkeeper_id: number | null
      posted_at?: string | null
      emergency_reversal_reason?: string | null
      emergency_reversal_by?: number | null
      emergency_reversal_at?: string | null
      reversal_approval_tag?: string | null
      attachment_count: number
      is_carry_forward: number
      created_at: string
      updated_at: string
    }>
    const insertVoucher = targetDb.prepare(
      `INSERT INTO vouchers (
         ledger_id, period, voucher_date, voucher_number, voucher_word, status, deleted_from_status, creator_id, auditor_id, bookkeeper_id, attachment_count, is_carry_forward, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceVouchers) {
      const inserted = insertVoucher.run(
        importedLedgerId,
        row.period,
        row.voucher_date,
        row.voucher_number,
        row.voucher_word,
        row.status,
        row.deleted_from_status,
        row.creator_id === null ? null : (userIdMap.get(row.creator_id) ?? null),
        row.auditor_id === null ? null : (userIdMap.get(row.auditor_id) ?? null),
        row.bookkeeper_id === null ? null : (userIdMap.get(row.bookkeeper_id) ?? null),
        row.attachment_count,
        row.is_carry_forward,
        row.created_at,
        row.updated_at
      )
      const targetVoucherId = Number(inserted.lastInsertRowid)
      const complianceFields = {
        posted_at: row.posted_at,
        emergency_reversal_reason: row.emergency_reversal_reason,
        emergency_reversal_by:
          row.emergency_reversal_by == null
            ? row.emergency_reversal_by
            : requireMappedId(userIdMap, row.emergency_reversal_by, '紧急逆转操作人'),
        emergency_reversal_at: row.emergency_reversal_at,
        reversal_approval_tag: row.reversal_approval_tag
      }
      const targetColumns = targetDb.prepare('PRAGMA table_info(vouchers)').all() as Array<{
        name: string
      }>
      for (const [column, value] of Object.entries(complianceFields)) {
        if (value === undefined || value === null) continue
        if (!targetColumns.some((item) => item.name === column))
          throw new Error(`目标数据库缺少凭证合规字段：${column}`)
        targetDb
          .prepare(`UPDATE vouchers SET ${quoteIdentifier(column)} = ? WHERE id = ?`)
          .run(value, targetVoucherId)
      }
      voucherIdMap.set(row.id, targetVoucherId)
    }

    const sourceVoucherEntries = packageDb
      .prepare(
        `SELECT voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, auxiliary_item_id, cash_flow_item_id
           FROM voucher_entries
          ORDER BY id ASC`
      )
      .all() as Array<{
      voucher_id: number
      row_order: number
      summary: string
      subject_code: string
      debit_amount: number
      credit_amount: number
      auxiliary_item_id: number | null
      cash_flow_item_id: number | null
    }>
    const insertVoucherEntry = targetDb.prepare(
      `INSERT INTO voucher_entries (
         voucher_id, row_order, summary, subject_code, debit_amount, credit_amount, auxiliary_item_id, cash_flow_item_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceVoucherEntries) {
      insertVoucherEntry.run(
        requireMappedId(voucherIdMap, row.voucher_id, '凭证'),
        row.row_order,
        row.summary,
        row.subject_code,
        row.debit_amount,
        row.credit_amount,
        row.auxiliary_item_id === null
          ? null
          : requireMappedId(auxiliaryIdMap, row.auxiliary_item_id, '辅助项'),
        row.cash_flow_item_id === null
          ? null
          : requireMappedId(cashFlowItemIdMap, row.cash_flow_item_id, '现金流量项目')
      )
    }

    const fileIdMap = new Map<number, number>()
    const sourceElectronicFiles = packageDb
      .prepare(
        `SELECT id, original_name, stored_name, stored_path, file_ext, mime_type, sha256, file_size, imported_by, imported_at
           FROM electronic_voucher_files
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      original_name: string
      stored_name: string
      stored_path: string
      file_ext: string
      mime_type: string | null
      sha256: string
      file_size: number
      imported_by: number | null
      imported_at: string
    }>
    const insertElectronicFile = targetDb.prepare(
      `INSERT INTO electronic_voucher_files (
         ledger_id, original_name, stored_name, stored_path, file_ext, mime_type, sha256, file_size, imported_by, imported_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceElectronicFiles) {
      requireStoredFilename(row.stored_name)
      const sourceAttachmentPath = resolveContainedPath(packageDir, row.stored_path)
      const targetAttachmentDir = resolveContainedPath(stagedAssets, `ledger-${importedLedgerId}`)
      ensureDirectory(targetAttachmentDir)
      const targetAttachmentPath = resolveContainedPath(targetAttachmentDir, row.stored_name)
      fs.copyFileSync(sourceAttachmentPath, targetAttachmentPath)
      if (
        computeFileSha256(targetAttachmentPath) !== row.sha256 ||
        fs.statSync(targetAttachmentPath).size !== row.file_size
      ) {
        throw new Error('staging 附件完整性校验失败')
      }
      const inserted = insertElectronicFile.run(
        importedLedgerId,
        row.original_name,
        row.stored_name,
        resolveContainedPath(finalAssets, `ledger-${importedLedgerId}/${row.stored_name}`),
        row.file_ext,
        row.mime_type,
        row.sha256,
        row.file_size,
        row.imported_by === null ? null : (userIdMap.get(row.imported_by) ?? null),
        row.imported_at
      )
      fileIdMap.set(row.id, Number(inserted.lastInsertRowid))
    }

    const recordIdMap = new Map<number, number>()
    const hasElectronicError = (
      packageDb.pragma('table_info(electronic_voucher_records)') as Array<{ name: string }>
    ).some((column) => column.name === 'last_error')
    const sourceElectronicRecords = packageDb
      .prepare(
        `SELECT id, file_id, voucher_type, source_number, source_date, counterpart_name, amount_cents, fingerprint, status, created_at, updated_at, ${hasElectronicError ? 'last_error' : 'NULL AS last_error'}
           FROM electronic_voucher_records
          ORDER BY id ASC`
      )
      .all() as Array<{
      id: number
      file_id: number
      voucher_type: string
      source_number: string | null
      source_date: string | null
      counterpart_name: string | null
      amount_cents: number | null
      fingerprint: string
      status: string
      created_at: string
      updated_at: string
      last_error: string | null
    }>
    const insertElectronicRecord = targetDb.prepare(
      `INSERT INTO electronic_voucher_records (
         ledger_id, file_id, voucher_type, source_number, source_date, counterpart_name, amount_cents, fingerprint, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceElectronicRecords) {
      const inserted = insertElectronicRecord.run(
        importedLedgerId,
        requireMappedId(fileIdMap, row.file_id, '电子凭证文件'),
        row.voucher_type,
        row.source_number,
        row.source_date,
        row.counterpart_name,
        row.amount_cents,
        row.fingerprint,
        row.status,
        row.created_at,
        row.updated_at
      )
      recordIdMap.set(row.id, Number(inserted.lastInsertRowid))
      if (row.last_error !== null) {
        targetDb
          .prepare('UPDATE electronic_voucher_records SET last_error = ? WHERE id = ?')
          .run(row.last_error, Number(inserted.lastInsertRowid))
      }
    }

    const sourceVerifications = packageDb
      .prepare(
        `SELECT record_id, verification_status, verification_method, verification_message, verified_at, created_at
           FROM electronic_voucher_verifications
          ORDER BY id ASC`
      )
      .all() as Array<{
      record_id: number
      verification_status: string
      verification_method: string | null
      verification_message: string | null
      verified_at: string | null
      created_at: string
    }>
    const insertVerification = targetDb.prepare(
      `INSERT INTO electronic_voucher_verifications (
         record_id, verification_status, verification_method, verification_message, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceVerifications) {
      insertVerification.run(
        requireMappedId(recordIdMap, row.record_id, '电子凭证记录'),
        row.verification_status,
        row.verification_method,
        row.verification_message,
        row.verified_at,
        row.created_at
      )
    }

    const sourceVoucherLinks = packageDb
      .prepare(
        `SELECT voucher_id, source_type, source_record_id, linked_at
           FROM voucher_source_links
          ORDER BY id ASC`
      )
      .all() as Array<{
      voucher_id: number
      source_type: string
      source_record_id: number
      linked_at: string
    }>
    const insertVoucherLink = targetDb.prepare(
      `INSERT INTO voucher_source_links (voucher_id, source_type, source_record_id, linked_at)
       VALUES (?, ?, ?, ?)`
    )
    for (const row of sourceVoucherLinks) {
      insertVoucherLink.run(
        requireMappedId(voucherIdMap, row.voucher_id, '凭证'),
        row.source_type,
        requireMappedId(recordIdMap, row.source_record_id, '电子凭证记录'),
        row.linked_at
      )
    }

    const sourceSnapshots = packageDb
      .prepare(
        `SELECT report_type, report_name, period, start_period, end_period, as_of_date, include_unposted_vouchers, generated_by, generated_at, content_json
           FROM report_snapshots
          ORDER BY id ASC`
      )
      .all() as Array<{
      report_type: string
      report_name: string
      period: string
      start_period: string
      end_period: string
      as_of_date: string | null
      include_unposted_vouchers: number
      generated_by: number | null
      generated_at: string
      content_json: string
    }>
    const insertSnapshot = targetDb.prepare(
      `INSERT INTO report_snapshots (
         ledger_id, report_type, report_name, period, start_period, end_period, as_of_date, include_unposted_vouchers, generated_by, generated_at, content_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceSnapshots) {
      insertSnapshot.run(
        importedLedgerId,
        row.report_type,
        row.report_name,
        row.period,
        row.start_period,
        row.end_period,
        row.as_of_date,
        row.include_unposted_vouchers,
        row.generated_by === null ? null : (userIdMap.get(row.generated_by) ?? null),
        row.generated_at,
        row.content_json
      )
    }

    const sourceLogs = packageDb
      .prepare(
        `SELECT user_id, username, module, action, target_type, target_id, reason, approval_tag, details_json, created_at
           FROM operation_logs
          ORDER BY id ASC`
      )
      .all() as Array<{
      user_id: number | null
      username: string
      module: string
      action: string
      target_type: string | null
      target_id: string | null
      reason: string | null
      approval_tag: string | null
      details_json: string
      created_at: string
    }>
    const insertLog = targetDb.prepare(
      `INSERT INTO operation_logs (
         ledger_id, user_id, username, module, action, target_type, target_id, reason, approval_tag, details_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const row of sourceLogs) {
      insertLog.run(
        importedLedgerId,
        row.user_id === null ? null : (userIdMap.get(row.user_id) ?? null),
        row.username,
        row.module,
        row.action,
        row.target_type,
        row.target_id,
        row.reason,
        row.approval_tag,
        row.details_json,
        row.created_at
      )
    }

    const sourcePermissions = packageDb
      .prepare(
        `SELECT user_id, ledger_id, created_at
           FROM user_ledger_permissions
          WHERE ledger_id = ?
          ORDER BY user_id ASC`
      )
      .all(sourceLedger.id) as Array<{
      user_id: number
      ledger_id: number
      created_at: string
    }>
    const insertPermission = targetDb.prepare(
      `INSERT OR IGNORE INTO user_ledger_permissions (user_id, ledger_id, created_at)
       VALUES (?, ?, ?)`
    )
    for (const row of sourcePermissions) {
      insertPermission.run(
        requireMappedId(userIdMap, row.user_id, '用户'),
        importedLedgerId,
        row.created_at
      )
    }

    targetDb.exec('DELETE FROM system_settings')
    const sourceSystemSettings = packageDb
      .prepare('SELECT key, value FROM system_settings ORDER BY key ASC')
      .all() as Array<{ key: string; value: string }>
    const insertSystemSetting = targetDb.prepare(
      `INSERT INTO system_settings (key, value)
       VALUES (?, ?)`
    )
    for (const row of sourceSystemSettings) {
      if (row.key === LAST_LOGIN_USER_ID_KEY) {
        const sourceLastLoginId = Number(row.value)
        const sourceUsername = sourceUserById.get(sourceLastLoginId)?.username
        const targetUserId = sourceUsername
          ? (targetUserIdByUsername.get(sourceUsername) ?? null)
          : null
        if (targetUserId !== null) {
          insertSystemSetting.run(row.key, String(targetUserId))
        }
        continue
      }
      insertSystemSetting.run(row.key, row.value)
    }

    targetDb.exec('DELETE FROM user_preferences')
    const sourceUserPreferences = packageDb
      .prepare(
        `SELECT user_id, key, value, updated_at
           FROM user_preferences
          ORDER BY user_id ASC, key ASC`
      )
      .all() as Array<{
      user_id: number
      key: string
      value: string
      updated_at: string
    }>
    const wallpaperPathByUsername = new Map<string, string>()
    for (const asset of validation.manifest.settingsAssets ?? []) {
      if (asset.kind !== 'wallpaper') {
        continue
      }
      const targetUserId = targetUserIdByUsername.get(asset.ownerUsername)
      if (!targetUserId) {
        continue
      }
      const sourceAssetPath = resolveContainedPath(packageDir, asset.relativePath)
      const extension = path.extname(asset.relativePath)
      const assetRelative = `wallpapers/user-${targetUserId}/current${extension}`
      const targetRelativePath = path
        .relative(targetUserDataPath, resolveContainedPath(finalAssets, assetRelative))
        .split(path.sep)
        .join('/')
      resolveContainedPath(targetUserDataPath, targetRelativePath)
      const targetAbsoluteDir = resolveContainedPath(
        stagedAssets,
        `wallpapers/user-${targetUserId}`
      )
      ensureDirectory(targetAbsoluteDir)
      const targetAbsolutePath = path.join(targetAbsoluteDir, `current${extension}`)
      fs.copyFileSync(sourceAssetPath, targetAbsolutePath)
      if (
        computeFileSha256(targetAbsolutePath) !== asset.checksum ||
        fs.statSync(targetAbsolutePath).size !== asset.fileSize
      ) {
        throw new Error('staging 壁纸完整性校验失败')
      }
      wallpaperPathByUsername.set(asset.ownerUsername, targetRelativePath)
    }

    const insertUserPreference = targetDb.prepare(
      `INSERT INTO user_preferences (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    for (const row of sourceUserPreferences) {
      const targetUserId = userIdMap.get(row.user_id)
      if (!targetUserId) {
        continue
      }

      const sourceUsername = sourceUserById.get(row.user_id)?.username
      if (row.key === USER_WALLPAPER_KEY) {
        const targetRelativePath = sourceUsername
          ? (wallpaperPathByUsername.get(sourceUsername) ?? '')
          : ''
        if (!targetRelativePath) {
          continue
        }
        insertUserPreference.run(targetUserId, row.key, targetRelativePath, row.updated_at)
        continue
      }

      insertUserPreference.run(targetUserId, row.key, row.value, row.updated_at)
    }

    input.appendImportLog?.(targetDb, { importedLedgerId, importedLedgerName })
    targetDb.exec('COMMIT;')
    targetDb.pragma('wal_checkpoint(TRUNCATE)')
    targetDb.pragma('journal_mode = DELETE')
    return {
      importedLedgerId,
      importedLedgerName
    }
  } catch (error) {
    if (targetDb.inTransaction) targetDb.exec('ROLLBACK;')
    throw error
  } finally {
    packageDb.close()
    targetDb.close()
  }
}

export function restoreBackupArtifact(input: {
  backupPath: string
  targetPath: string
  tempPath?: string
  manifestPath?: string | null
  expectedChecksum?: string
  commitCandidate?: (candidate: Database.Database) => undefined
}): BackupRestoreResult {
  if (input.commitCandidate) assertSynchronousOperation(input.commitCandidate as () => unknown)
  const manifestPath =
    input.manifestPath === undefined
      ? path.join(path.dirname(input.backupPath), 'manifest.json')
      : input.manifestPath
  const expectedChecksum =
    input.expectedChecksum ??
    (manifestPath && fs.existsSync(manifestPath)
      ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest | null)?.checksum
      : undefined)
  if (!expectedChecksum) throw new Error('恢复必须提供备份清单或历史记录的完整性摘要')
  const validation = validateBackupArtifact(input.backupPath, expectedChecksum, manifestPath)
  if (!validation.valid) throw new Error(validation.error ?? '整库恢复校验失败')
  withDatabaseSnapshot(input.backupPath, (copy) => {
    if (fs.existsSync(`${copy}-wal`)) throw new Error('恢复载荷包含未声明 WAL')
    if (computeFileSha256(copy) !== expectedChecksum) throw new Error('校验后恢复载荷发生变化')
    const candidate = new Database(copy, { fileMustExist: true })
    try {
      checkDatabaseIntegrity(candidate)
      if (getSchemaObjects(candidate).length === 0) throw new Error('恢复载荷不能是空白数据库')
      // 旧结构只在隔离副本上升级；当前结构也必须通过完整 schema 校验。
      runDatabaseMigrations(candidate, {
        backupDirectory: path.join(path.dirname(copy), 'migration-backups')
      })
      // 恢复不能复活快照中已撤销的令牌；所有客户端必须重新登录。
      candidate.exec('DELETE FROM auth_sessions')
      // 快照携带的提交证据属于旧控制日志，不能证明当前恢复后的文件操作。
      if (candidate.prepare('SELECT 1 FROM file_operation_commits LIMIT 1').get())
        candidate.exec('DELETE FROM file_operation_commits')
      if (input.commitCandidate) {
        candidate
          .transaction(() => {
            const result = input.commitCandidate!(candidate)
            if (result !== undefined) throw new TypeError('恢复候选库提交必须同步完成')
          })
          .immediate()
      }
      candidate.pragma('wal_checkpoint(TRUNCATE)')
      candidate.pragma('journal_mode = DELETE')
    } finally {
      candidate.close()
    }
    switchDatabaseFile(copy, input.targetPath)
  })

  return {
    targetPath: input.targetPath,
    fileSize: fs.statSync(input.targetPath).size
  }
}

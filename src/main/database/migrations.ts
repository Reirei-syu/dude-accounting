import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { withDatabaseSnapshot } from './databaseSnapshot'
import { CURRENT_SCHEMA_VERSION, createCurrentSchema } from './schema'
import { checkDatabaseIntegrity, getSchemaObjects, validateSchema } from './migrationSchema'
import {
  migrateLegacyStructure,
  migrateLegacyDataAndIndexes,
  validateLegacyObjects
} from './legacyMigrations'
import { migrateAuthRevision } from './authRevisionMigration'
import { migrateFileOperationCommits } from './fileOperationMigration'

const MIGRATIONS = [
  { version: 1, name: 'legacy 结构归一与原记录归档', run: migrateLegacyStructure },
  { version: 2, name: '历史元数据归一与唯一索引', run: migrateLegacyDataAndIndexes },
  { version: 3, name: '授权版本与最小会话身份', run: migrateAuthRevision },
  { version: 4, name: '文件操作原子提交标记', run: migrateFileOperationCommits }
] as const

export interface MigrationOptions {
  backupDirectory?: string
  // 用于恢复演练的故障注入；生产初始化不传入。
  checkpoint?: (point: 'beforeCommit' | 'afterCommit', version: number) => void
}

export interface MigrationResult {
  fromVersion: number
  toVersion: number
  created: boolean
  applied: number[]
  backupPath: string | null
}

export class SchemaMigrationError extends Error {
  constructor(
    readonly fromVersion: number,
    readonly migrationVersion: number,
    readonly backupPath: string | null,
    cause: unknown
  ) {
    super(
      `数据库迁移失败（源版本 ${fromVersion}，步骤 ${migrationVersion}，目标版本 ${CURRENT_SCHEMA_VERSION}，恢复副本 ${backupPath ?? '无'}）：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    )
    this.name = 'SchemaMigrationError'
  }
}

function readVersion(db: Database.Database): number {
  const version = db.pragma('user_version', { simple: true }) as number
  if (!Number.isInteger(version) || version < 0 || version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `不支持的数据库版本 ${version}，当前程序最高支持 ${CURRENT_SCHEMA_VERSION}；禁止降级写入`
    )
  }
  return version
}

export function preflightDatabaseVersion(file: string): void {
  if (!fs.existsSync(file)) return
  withDatabaseSnapshot(file, (copy) => {
    const snapshot = new Database(copy, { readonly: true, fileMustExist: true })
    try {
      readVersion(snapshot)
    } finally {
      snapshot.close()
    }
  })
}

function createRecoveryCopy(db: Database.Database, directory?: string): string {
  const root = directory
    ? path.resolve(directory)
    : path.join(path.dirname(path.resolve(db.name)), 'schema-backups')
  fs.mkdirSync(root, { recursive: true })
  const folder = fs.mkdtempSync(path.join(root, 'migration-'))
  const copy = path.join(folder, 'before.sqlite')
  db.prepare('VACUUM INTO ?').run(copy)
  const descriptor = fs.openSync(copy, 'r+')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  const backup = new Database(copy, { readonly: true, fileMustExist: true })
  try {
    checkDatabaseIntegrity(backup)
    if (
      backup.pragma('user_version', { simple: true }) !==
      db.pragma('user_version', { simple: true })
    ) {
      throw new Error('恢复副本版本与迁移源不一致')
    }
  } finally {
    backup.close()
  }
  fs.writeFileSync(
    path.join(folder, 'manifest.json'),
    JSON.stringify(
      {
        sourcePath: path.resolve(db.name),
        sourceVersion: db.pragma('user_version', { simple: true }),
        targetVersion: CURRENT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        sha256: createHash('sha256').update(fs.readFileSync(copy)).digest('hex')
      },
      null,
      2
    ),
    { flag: 'wx' }
  )
  return copy
}

export function runDatabaseMigrations(
  db: Database.Database,
  options: MigrationOptions = {}
): MigrationResult {
  if (db.inTransaction) throw new Error('迁移 runner 不允许嵌套在外部事务中')
  if (db.readonly) throw new Error('迁移 runner 需要可写连接；只读原库请先创建副本')
  MIGRATIONS.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error('迁移编号必须严格连续递增')
  })
  if (MIGRATIONS.length !== CURRENT_SCHEMA_VERSION) throw new Error('迁移注册表与当前版本不一致')
  let version = readVersion(db)
  const result: MigrationResult = {
    fromVersion: version,
    toVersion: CURRENT_SCHEMA_VERSION,
    created: false,
    applied: [],
    backupPath: null
  }
  if (version === CURRENT_SCHEMA_VERSION) {
    checkDatabaseIntegrity(db)
    validateSchema(db)
    return result
  }
  const foreignKeys = db.pragma('foreign_keys', { simple: true }) as number
  const lockingMode = db.pragma('locking_mode', { simple: true }) as string
  let step = version + 1
  try {
    // 独占连接保留跨事务锁：从快照到最后一步期间不允许其他进程写入。
    db.pragma('locking_mode = EXCLUSIVE')
    db.exec('BEGIN EXCLUSIVE; COMMIT;')
    version = readVersion(db)
    result.fromVersion = version
    if (version === CURRENT_SCHEMA_VERSION) {
      checkDatabaseIntegrity(db)
      validateSchema(db)
      return result
    }
    const objects = getSchemaObjects(db)
    if (version === 0 && objects.length > 0) validateLegacyObjects(db)
    if (!db.memory && objects.length > 0)
      result.backupPath = createRecoveryCopy(db, options.backupDirectory)
    db.pragma('foreign_keys = OFF')
    if (version === 0 && objects.length === 0) {
      step = CURRENT_SCHEMA_VERSION
      db.transaction(() => {
        createCurrentSchema(db)
        checkDatabaseIntegrity(db)
        validateSchema(db)
        db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
        options.checkpoint?.('beforeCommit', CURRENT_SCHEMA_VERSION)
      }).immediate()
      result.created = true
      options.checkpoint?.('afterCommit', CURRENT_SCHEMA_VERSION)
      return result
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue
      step = migration.version
      db.transaction(() => {
        if (readVersion(db) !== migration.version - 1) throw new Error('迁移源版本发生变化')
        migration.run(db)
        checkDatabaseIntegrity(db)
        validateSchema(db, migration.version >= 2, migration.version)
        db.pragma(`user_version = ${migration.version}`)
        options.checkpoint?.('beforeCommit', migration.version)
      }).immediate()
      version = migration.version
      result.applied.push(version)
      options.checkpoint?.('afterCommit', version)
    }
    return result
  } catch (error) {
    throw new SchemaMigrationError(result.fromVersion, step, result.backupPath, error)
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`)
    db.pragma(`locking_mode = ${lockingMode === 'exclusive' ? 'EXCLUSIVE' : 'NORMAL'}`)
    // NORMAL 模式在下一次数据库访问时释放之前保留的独占锁。
    db.pragma('user_version', { simple: true })
  }
}

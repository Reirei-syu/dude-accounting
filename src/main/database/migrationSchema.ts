import Database from 'better-sqlite3'
import { createCurrentSchema, CURRENT_SCHEMA_VERSION } from './schema'

export interface SchemaObject {
  type: string
  name: string
  sql: string
}

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function getSchemaObjects(db: Database.Database): SchemaObject[] {
  return db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name"
    )
    .all() as SchemaObject[]
}

export function getColumnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`).all() as Array<{ name: string }>
  ).map((row) => row.name)
}

export function checkDatabaseIntegrity(db: Database.Database): void {
  const checks = db.pragma('quick_check') as Array<{ quick_check: string }>
  if (checks.length !== 1 || checks[0].quick_check !== 'ok') {
    throw new Error(`数据库 quick_check 失败：${JSON.stringify(checks)}`)
  }
  const issues = db.pragma('foreign_key_check') as unknown[]
  if (issues.length > 0) throw new Error(`数据库外键校验失败：${JSON.stringify(issues)}`)
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/IF NOT EXISTS\s+/gi, '')
    .replace(/"([a-z_][a-z_0-9]*)"/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// 比对完整 CREATE 定义，覆盖默认值、CHECK、外键、唯一和部分索引，而非只检查名称。
export function validateSchema(
  db: Database.Database,
  includeIndexes = true,
  version = CURRENT_SCHEMA_VERSION
): void {
  const reference = new Database(':memory:')
  try {
    createCurrentSchema(reference, version)
    const filter = (row: SchemaObject): boolean => includeIndexes || row.type !== 'index'
    const expected = getSchemaObjects(reference).filter(filter)
    const actual = getSchemaObjects(db).filter(filter)
    if (actual.length !== expected.length) throw new Error('数据库 schema 对象数量与当前版本不一致')
    for (let index = 0; index < expected.length; index++) {
      if (
        actual[index].type !== expected[index].type ||
        actual[index].name !== expected[index].name ||
        normalizeSql(actual[index].sql) !== normalizeSql(expected[index].sql)
      ) {
        throw new Error(`数据库 schema 校验失败：${expected[index].type} ${expected[index].name}`)
      }
    }
  } finally {
    reference.close()
  }
}

// JSON 由 SQLite 生成，避免大整数经 JS Number 读取而损失精度；异常 BLOB 也可还原。
export function archiveRows(
  db: Database.Database,
  table: string,
  where: string,
  reason: string,
  version: number
): void {
  const columns = getColumnNames(db, table)
  const values = columns
    .map((column) => {
      const identifier = quoteIdentifier(column)
      return `'${column.replace(/'/g, "''")}', CASE WHEN typeof(${identifier}) = 'blob' THEN json_object('__sqlite_blob_hex', hex(${identifier})) ELSE ${identifier} END`
    })
    .join(', ')
  db.prepare(
    `INSERT OR IGNORE INTO migration_conflicts
    (migration_version, table_name, source_key, reason, row_json)
    SELECT ?, ?, CAST(id AS TEXT), ?, json_object(${values}) FROM ${quoteIdentifier(table)} WHERE ${where}`
  ).run(version, table, reason)
}

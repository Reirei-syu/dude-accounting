import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

function hash(file: string): string | null {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

// 不经 SQLite 打开原件，避免只读连接也创建/更新 WAL 的共享内存文件。
export function withDatabaseSnapshot<T>(source: string, inspect: (copy: string) => T): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dude-schema-preflight-'))
  const copy = path.join(directory, 'database.sqlite')
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = ['', '-wal'].map(suffix => hash(source + suffix))
      if (!before[0]) throw new Error('数据库源文件不存在，无法创建校验副本')
      for (const [index, suffix] of ['', '-wal'].entries()) {
        if (before[index] !== null) fs.copyFileSync(source + suffix, copy + suffix)
        else if (fs.existsSync(copy + suffix)) fs.unlinkSync(copy + suffix)
      }
      const after = ['', '-wal'].map(suffix => hash(source + suffix))
      const copied = ['', '-wal'].map(suffix => hash(copy + suffix))
      if (before.every((value, index) => value === after[index] && value === copied[index])) return inspect(copy)
    }
    throw new Error('数据库正在变化，无法取得稳定校验副本；请关闭其他实例后重试')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

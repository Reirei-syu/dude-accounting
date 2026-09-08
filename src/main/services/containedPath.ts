import fs from 'node:fs'
import path from 'node:path'

function validateSegment(segment: string): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    /[<>:"|?*]/.test(segment) ||
    /[. ]$/.test(segment) ||
    Array.from(segment).some((char) => char.charCodeAt(0) < 32) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  ) {
    throw new Error('不安全的相对路径名称')
  }
}

export function requireStoredFilename(value: unknown): asserts value is string {
  if (typeof value !== 'string' || /[/\\]/.test(value))
    throw new Error('stored_name 必须是纯文件名')
  validateSegment(value)
}

export function resolveContainedPath(base: string, untrustedPath: unknown): string {
  if (
    typeof untrustedPath !== 'string' ||
    untrustedPath.includes('\\') ||
    path.posix.isAbsolute(untrustedPath) ||
    path.win32.isAbsolute(untrustedPath)
  ) {
    throw new Error('仅允许受控相对路径，禁止绝对路径或混合分隔符')
  }
  const segments = untrustedPath.split('/')
  segments.forEach(validateSegment)
  const root = path.resolve(base)
  const resolved = path.resolve(root, ...segments)
  const relative = path.relative(root, resolved)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('路径越出受控目录')
  }
  // 连同根目录祖先检查，拒绝 junction/symlink；不存在的后续部分仍受词法约束。
  let cursor = path.parse(resolved).root
  for (const segment of resolved.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, segment)
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('路径包含链接或 reparse 目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  return resolved
}

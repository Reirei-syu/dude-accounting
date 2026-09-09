import path from 'node:path'
import { CommandError } from './types'

/** 不通过 cwd 猜测文件位置；支持 Windows 本机与显式 WSL 上下文。 */
export function normalizeExplicitFilePath(value: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new CommandError('VALIDATION_ERROR', '文件路径不能为空', null, 2)
  let target = value.trim()
  if (process.platform === 'win32') {
    const mount = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(target)
    if (mount) target = `${mount[1].toUpperCase()}:\\${(mount[2] ?? '').replaceAll('/', '\\')}`
    else if (target.startsWith('/') && !target.startsWith('//')) {
      const distro = process.env.DUDEACC_WSL_DISTRO_NAME?.trim()
      if (!distro || !/^[\w .-]+$/.test(distro))
        throw new CommandError('VALIDATION_ERROR', 'WSL 原生路径需要明确发行版名称', null, 2)
      target = `\\\\wsl.localhost\\${distro}${target.replaceAll('/', '\\')}`
    }
  } else if (/^[a-z]:[/\\]/i.test(target) || target.startsWith('\\\\')) {
    throw new CommandError('VALIDATION_ERROR', '当前平台不能直接使用 Windows 路径', null, 2)
  }
  if (!path.isAbsolute(target))
    throw new CommandError('VALIDATION_ERROR', '文件必须使用显式绝对路径', null, 2)
  const normalized = path.normalize(target)
  if (
    process.platform === 'win32' &&
    !(/^[a-z]:\\/i.test(normalized) || /^\\\\[^\\]+\\[^\\]+\\/.test(normalized))
  )
    throw new CommandError('VALIDATION_ERROR', '文件必须明确盘符或完整 UNC 共享路径', null, 2)
  return normalized
}

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { CommandError } from '../main/commands/types'

const WSL_DRIVE_PATH_PATTERN = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function toWindowsSeparators(value: string): string {
  return value.replace(/\//g, '\\')
}

function convertPosixPathWithWslPath(payloadFile: string): string | null {
  try {
    const output = execFileSync('wsl.exe', ['wslpath', '-w', payloadFile], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    }).trim()
    return output || null
  } catch {
    return null
  }
}

export function normalizeCliPayloadFilePath(payloadFile: string): string {
  if (process.platform !== 'win32') {
    return payloadFile
  }

  const driveMatch = payloadFile.match(WSL_DRIVE_PATH_PATTERN)
  if (driveMatch) {
    const drive = driveMatch[1].toUpperCase()
    const rest = driveMatch[2] ? toWindowsSeparators(driveMatch[2]) : ''
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`
  }

  const distroName = process.env.DUDEACC_WSL_DISTRO_NAME?.trim()
  if (distroName && payloadFile.startsWith('/') && !payloadFile.startsWith('//')) {
    return `\\\\wsl.localhost\\${distroName}${toWindowsSeparators(payloadFile)}`
  }

  if (payloadFile.startsWith('/') && !payloadFile.startsWith('//')) {
    return convertPosixPathWithWslPath(payloadFile) ?? payloadFile
  }

  return payloadFile
}

function parseJsonPayload(sourceName: string, rawJson: string): unknown {
  try {
    return JSON.parse(stripUtf8Bom(rawJson)) as unknown
  } catch (error) {
    throw new CommandError(
      'VALIDATION_ERROR',
      error instanceof Error ? `解析 ${sourceName} 失败：${error.message}` : `解析 ${sourceName} 失败`,
      null,
      2
    )
  }
}

function normalizeLooseValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLooseValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        normalizeLooseValue(entryValue)
      ])
    )
  }

  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return value
}

function hasOwnFlags(flags: Record<string, string | boolean>): boolean {
  return Object.keys(flags).length > 0
}

function isMergeablePayloadObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeExplicitFlags(
  payload: unknown,
  flags: Record<string, string | boolean>
): unknown {
  if (!hasOwnFlags(flags)) {
    return payload
  }

  const normalizedFlags = normalizeLooseValue(flags) as Record<string, unknown>
  if (payload === undefined) {
    return normalizedFlags
  }

  if (!isMergeablePayloadObject(payload)) {
    throw new CommandError(
      'VALIDATION_ERROR',
      'payload 文件、stdin 或 JSON 的根节点不是对象，不能再叠加命令行参数',
      {
        payloadType: Array.isArray(payload) ? 'array' : typeof payload
      },
      2
    )
  }

  return {
    ...payload,
    ...normalizedFlags
  }
}

export function resolveCliPayload(input: {
  payloadFile?: string
  payloadStdinJson?: string
  payloadJson?: string
  flags: Record<string, string | boolean>
}): unknown {
  let payload: unknown

  if (input.payloadFile) {
    const payloadFilePath = normalizeCliPayloadFilePath(input.payloadFile)
    try {
      payload = JSON.parse(stripUtf8Bom(fs.readFileSync(payloadFilePath, 'utf8'))) as unknown
    } catch (error) {
      throw new CommandError(
        'VALIDATION_ERROR',
        error instanceof Error ? `读取 payload 文件失败：${error.message}` : '读取 payload 文件失败',
        {
          payloadFile: input.payloadFile,
          resolvedPayloadFile: payloadFilePath
        },
        2
      )
    }
    return mergeExplicitFlags(payload, input.flags)
  }

  if (typeof input.payloadStdinJson === 'string') {
    payload = parseJsonPayload('stdin payload JSON', input.payloadStdinJson)
    return mergeExplicitFlags(payload, input.flags)
  }

  if (input.payloadJson) {
    payload = parseJsonPayload('payload JSON', input.payloadJson)
    return mergeExplicitFlags(payload, input.flags)
  }

  return mergeExplicitFlags(undefined, input.flags)
}

import fs from 'node:fs'
import { CommandError } from '../main/commands/types'

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
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
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  return value
}

export function resolveCliPayload(input: {
  payloadFile?: string
  payloadJson?: string
  flags: Record<string, string | boolean>
}): unknown {
  if (input.payloadFile) {
    try {
      return JSON.parse(stripUtf8Bom(fs.readFileSync(input.payloadFile, 'utf8'))) as unknown
    } catch (error) {
      throw new CommandError(
        'VALIDATION_ERROR',
        error instanceof Error ? `读取 payload 文件失败：${error.message}` : '读取 payload 文件失败',
        {
          payloadFile: input.payloadFile
        },
        2
      )
    }
  }

  if (input.payloadJson) {
    try {
      return JSON.parse(input.payloadJson) as unknown
    } catch (error) {
      throw new CommandError(
        'VALIDATION_ERROR',
        error instanceof Error ? `解析 payload JSON 失败：${error.message}` : '解析 payload JSON 失败',
        null,
        2
      )
    }
  }

  return normalizeLooseValue(input.flags)
}

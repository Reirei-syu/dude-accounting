import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as iconv from 'iconv-lite'
import { CommandError } from '../main/commands/types'
import type { PayloadEncoding } from './parse'
import { looksLikeMojibake, recoverMojibake } from '../shared/mojibake'

const WSL_DRIVE_PATH_PATTERN = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/

export interface PayloadWarning {
  code: 'PAYLOAD_MOJIBAKE_RECOVERED' | 'PAYLOAD_MOJIBAKE_SUSPECTED'
  message: string
  details: Record<string, unknown>
}

export interface PayloadResolution {
  payload: unknown
  warnings: PayloadWarning[]
}

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

function createPayloadWarning(
  code: PayloadWarning['code'],
  sourceName: string,
  details: Record<string, unknown>
): PayloadWarning {
  return {
    code,
    message:
      code === 'PAYLOAD_MOJIBAKE_RECOVERED'
        ? `${sourceName} may contain mojibake (corrupted Chinese). Please save the JSON with UTF-8 encoding. We attempted automatic recovery.`
        : `${sourceName} may contain mojibake (corrupted Chinese). Please save the JSON with UTF-8 encoding.`,
    details
  }
}

function scoreTextValue(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((sum, item) => sum + scoreTextValue(item), 0)
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).reduce<number>(
      (sum, entryValue) => sum + scoreTextValue(entryValue),
      0
    )
  }

  if (typeof value !== 'string') {
    return 0
  }

  const recovered = recoverMojibake(value)
  return recovered.suspicious ? recovered.recoveredScore + 8 : recovered.recoveredScore
}

function decodePayloadText(buffer: Buffer, encoding: Exclude<PayloadEncoding, 'auto'>): string {
  if (encoding === 'gbk') {
    return iconv.decode(buffer, 'gb18030')
  }

  return buffer.toString('utf8')
}

function tryParseCandidate(rawJson: string): {
  payload?: unknown
  error?: unknown
  textScore: number
  valueScore: number
} {
  const text = stripUtf8Bom(rawJson)
  const textScore = looksLikeMojibake(text) ? 100 : 0
  try {
    const payload = JSON.parse(text) as unknown
    return {
      payload,
      textScore,
      valueScore: scoreTextValue(payload)
    }
  } catch (error) {
    return {
      error,
      textScore,
      valueScore: Number.POSITIVE_INFINITY
    }
  }
}

function recoverStringLeaves(
  value: unknown
): { value: unknown; recoveredCount: number; suspectedCount: number } {
  if (Array.isArray(value)) {
    let recoveredCount = 0
    let suspectedCount = 0
    const nextValue = value.map((item) => {
      const result = recoverStringLeaves(item)
      recoveredCount += result.recoveredCount
      suspectedCount += result.suspectedCount
      return result.value
    })
    return { value: nextValue, recoveredCount, suspectedCount }
  }

  if (value && typeof value === 'object') {
    let recoveredCount = 0
    let suspectedCount = 0
    const nextEntries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      const result = recoverStringLeaves(entryValue)
      recoveredCount += result.recoveredCount
      suspectedCount += result.suspectedCount
      return [key, result.value] as const
    })
    return {
      value: Object.fromEntries(nextEntries),
      recoveredCount,
      suspectedCount
    }
  }

  if (typeof value !== 'string') {
    return { value, recoveredCount: 0, suspectedCount: 0 }
  }

  const recovered = recoverMojibake(value)
  return {
    value: recovered.recovered ? recovered.text : value,
    recoveredCount: recovered.recovered ? 1 : 0,
    suspectedCount: recovered.suspicious ? 1 : 0
  }
}

function decodePayloadBuffer(input: {
  sourceName: string
  buffer: Buffer
  encoding: PayloadEncoding
}): PayloadResolution {
  const warnings: PayloadWarning[] = []

  if (input.encoding === 'utf8' || input.encoding === 'gbk') {
    const text = decodePayloadText(input.buffer, input.encoding)
    const parsed = tryParseCandidate(text)
    if (parsed.error) {
      throw new CommandError(
        'VALIDATION_ERROR',
        parsed.error instanceof Error
          ? `解析 ${input.sourceName} 失败：${parsed.error.message}`
          : `解析 ${input.sourceName} 失败`,
        {
          encoding: input.encoding
        },
        2
      )
    }
    if (parsed.valueScore > 0) {
      warnings.push(
        createPayloadWarning('PAYLOAD_MOJIBAKE_SUSPECTED', input.sourceName, {
          encoding: input.encoding,
          textScore: parsed.textScore,
          valueScore: parsed.valueScore
        })
      )
    }
    const recovered = recoverStringLeaves(parsed.payload)
    if (recovered.recoveredCount > 0) {
      warnings.push(
        createPayloadWarning('PAYLOAD_MOJIBAKE_RECOVERED', input.sourceName, {
          encoding: input.encoding,
          recoveredTextFields: recovered.recoveredCount
        })
      )
    }
    return {
      payload: recovered.value,
      warnings
    }
  }

  const utf8Text = decodePayloadText(input.buffer, 'utf8')
  const utf8Candidate = tryParseCandidate(utf8Text)
  const shouldTryGbk =
    Boolean(utf8Candidate.error) ||
    utf8Candidate.textScore > 0 ||
    utf8Candidate.valueScore > 0 ||
    looksLikeMojibake(utf8Text)

  if (shouldTryGbk) {
    const gbkText = decodePayloadText(input.buffer, 'gbk')
    const gbkCandidate = tryParseCandidate(gbkText)
    if (
      !gbkCandidate.error &&
      (Boolean(utf8Candidate.error) ||
        gbkCandidate.textScore + gbkCandidate.valueScore <
          utf8Candidate.textScore + utf8Candidate.valueScore)
    ) {
      warnings.push(
        createPayloadWarning('PAYLOAD_MOJIBAKE_RECOVERED', input.sourceName, {
          encoding: 'auto',
          selectedEncoding: 'gb18030',
          attemptedEncodings: ['utf8', 'gb18030']
        })
      )
      return {
        payload: gbkCandidate.payload,
        warnings
      }
    }
  }

  if (utf8Candidate.error) {
    throw new CommandError(
      'VALIDATION_ERROR',
      utf8Candidate.error instanceof Error
        ? `解析 ${input.sourceName} 失败：${utf8Candidate.error.message}`
        : `解析 ${input.sourceName} 失败`,
      {
        encoding: 'auto',
        attemptedEncodings: shouldTryGbk ? ['utf8', 'gb18030'] : ['utf8']
      },
      2
    )
  }

  const recovered = recoverStringLeaves(utf8Candidate.payload)
  if (recovered.recoveredCount > 0) {
    warnings.push(
      createPayloadWarning('PAYLOAD_MOJIBAKE_RECOVERED', input.sourceName, {
        encoding: 'auto',
        recoveredTextFields: recovered.recoveredCount
      })
    )
  }
  if (recovered.suspectedCount > 0) {
    warnings.push(
      createPayloadWarning('PAYLOAD_MOJIBAKE_SUSPECTED', input.sourceName, {
        encoding: 'auto',
        suspectedTextFields: recovered.suspectedCount
      })
    )
  }
  return {
    payload: recovered.value,
    warnings
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
  payloadEncoding?: PayloadEncoding
  payloadStdinJson?: string
  payloadStdinBuffer?: Buffer
  payloadJson?: string
  flags: Record<string, string | boolean>
}): unknown {
  return resolveCliPayloadWithWarnings(input).payload
}

export function resolveCliPayloadWithWarnings(input: {
  payloadFile?: string
  payloadEncoding?: PayloadEncoding
  payloadStdinJson?: string
  payloadStdinBuffer?: Buffer
  payloadJson?: string
  flags: Record<string, string | boolean>
}): PayloadResolution {
  let payload: unknown
  const warnings: PayloadWarning[] = []
  const payloadEncoding = input.payloadEncoding ?? 'auto'

  if (input.payloadFile) {
    const payloadFilePath = normalizeCliPayloadFilePath(input.payloadFile)
    try {
      const resolution = decodePayloadBuffer({
        sourceName: 'payload 文件',
        buffer: fs.readFileSync(payloadFilePath),
        encoding: payloadEncoding
      })
      payload = resolution.payload
      warnings.push(...resolution.warnings)
    } catch (error) {
      if (error instanceof CommandError) {
        throw new CommandError(error.code, error.message, {
          ...(error.details && typeof error.details === 'object' ? error.details : {}),
          payloadFile: input.payloadFile,
          resolvedPayloadFile: payloadFilePath
        }, error.exitCode)
      }
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
    return {
      payload: mergeExplicitFlags(payload, input.flags),
      warnings
    }
  }

  if (input.payloadStdinBuffer) {
    const resolution = decodePayloadBuffer({
      sourceName: 'stdin payload JSON',
      buffer: input.payloadStdinBuffer,
      encoding: payloadEncoding
    })
    payload = resolution.payload
    warnings.push(...resolution.warnings)
    return {
      payload: mergeExplicitFlags(payload, input.flags),
      warnings
    }
  }

  if (typeof input.payloadStdinJson === 'string') {
    payload = parseJsonPayload('stdin payload JSON', input.payloadStdinJson)
    const recovered = recoverStringLeaves(payload)
    if (recovered.recoveredCount > 0) {
      warnings.push(
        createPayloadWarning('PAYLOAD_MOJIBAKE_RECOVERED', 'stdin payload JSON', {
          recoveredTextFields: recovered.recoveredCount
        })
      )
    }
    return {
      payload: mergeExplicitFlags(recovered.value, input.flags),
      warnings
    }
  }

  if (input.payloadJson) {
    payload = parseJsonPayload('payload JSON', input.payloadJson)
    const recovered = recoverStringLeaves(payload)
    if (recovered.recoveredCount > 0) {
      warnings.push(
        createPayloadWarning('PAYLOAD_MOJIBAKE_RECOVERED', 'payload JSON', {
          recoveredTextFields: recovered.recoveredCount
        })
      )
    }
    return {
      payload: mergeExplicitFlags(recovered.value, input.flags),
      warnings
    }
  }

  return {
    payload: mergeExplicitFlags(undefined, input.flags),
    warnings
  }
}

import * as iconv from 'iconv-lite'

export interface MojibakeRecoveryResult {
  text: string
  recovered: boolean
  suspicious: boolean
  unrecoverable: boolean
  originalScore: number
  recoveredScore: number
}

export interface NormalizeUserTextOptions {
  field: string
  label?: string
}

export class MojibakeTextError extends Error {
  readonly details: Record<string, unknown>

  constructor(message: string, details: Record<string, unknown>) {
    super(message)
    this.name = 'MojibakeTextError'
    this.details = details
  }
}

const MOJIBAKE_TOKEN_PATTERN = /(锟斤拷|ï¿½|鏀|瀵|鍗曟|墜缁|硅处|粯||����)/g
const REPLACEMENT_CHAR_PATTERN = /\uFFFD/g
const PRIVATE_USE_PATTERN = /[\uE000-\uF8FF]/g
const C1_CONTROL_PATTERN = /[\u0080-\u009F]/g
const CJK_PATTERN = /[\u3400-\u9FFF]/

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}

function scoreMojibake(text: string): number {
  if (!text) {
    return 0
  }

  const replacementCount = countMatches(text, REPLACEMENT_CHAR_PATTERN)
  const tokenCount = countMatches(text, MOJIBAKE_TOKEN_PATTERN)
  const privateUseCount = countMatches(text, PRIVATE_USE_PATTERN)
  const c1ControlCount = countMatches(text, C1_CONTROL_PATTERN)
  let score = replacementCount * 20 + tokenCount * 6 + privateUseCount * 8 + c1ControlCount * 4

  if (replacementCount >= 2 && CJK_PATTERN.test(text)) {
    score += 10
  }

  return score
}

function previewText(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}...` : text
}

export function looksLikeMojibake(text: string): boolean {
  return scoreMojibake(text) >= 8
}

export function recoverMojibake(text: string): MojibakeRecoveryResult {
  const originalScore = scoreMojibake(text)
  let bestText = text
  let bestScore = originalScore

  try {
    const gb18030RoundTrip = iconv.decode(iconv.encode(text, 'gb18030'), 'utf8')
    const candidateScore = scoreMojibake(gb18030RoundTrip)
    if (
      gb18030RoundTrip !== text &&
      candidateScore + 2 < bestScore &&
      (CJK_PATTERN.test(gb18030RoundTrip) || !CJK_PATTERN.test(text))
    ) {
      bestText = gb18030RoundTrip
      bestScore = candidateScore
    }
  } catch {
    // Recovery is best-effort; callers still get the original text if conversion fails.
  }

  const suspicious = looksLikeMojibake(bestText)
  return {
    text: bestText,
    recovered: bestText !== text,
    suspicious,
    unrecoverable: suspicious && bestText === text,
    originalScore,
    recoveredScore: bestScore
  }
}

export function normalizeUserTextOrThrow(
  text: string,
  options: NormalizeUserTextOptions
): string {
  const result = recoverMojibake(text)
  if (result.suspicious) {
    const label = options.label ?? options.field
    throw new MojibakeTextError(
      `${label}疑似包含中文乱码，请将 payload JSON 保存为 UTF-8 编码，或使用 --encoding gbk/auto 后重试`,
      {
        field: options.field,
        label,
        receivedPreview: previewText(text),
        recoveredPreview: result.recovered ? previewText(result.text) : null,
        suggestion:
          'Windows 下包含中文的 payload 推荐使用 PowerShell ConvertTo-Json | Out-File -Encoding UTF8 生成'
      }
    )
  }

  return result.text
}

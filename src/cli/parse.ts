import { CommandError } from '../main/commands/types'

export type PayloadEncoding = 'auto' | 'utf8' | 'gbk'

export interface ParsedCliArgs {
  outputMode: 'json' | 'pretty'
  token?: string
  domain: string
  action: string
  flags: Record<string, string | boolean>
  payloadFile?: string
  payloadStdin?: boolean
  payloadJson?: string
  payloadEncoding: PayloadEncoding
}

function parsePayloadEncoding(value: string | undefined): PayloadEncoding {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'utf8' || normalized === 'gbk') {
    return normalized
  }

  throw new CommandError(
    'VALIDATION_ERROR',
    '--encoding 仅支持 auto、utf8 或 gbk',
    {
      field: 'encoding',
      received: value ?? null,
      allowed: ['auto', 'utf8', 'gbk']
    },
    2
  )
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {}
  let outputMode: 'json' | 'pretty' = 'json'
  let token: string | undefined
  let payloadFile: string | undefined
  let payloadStdin = false
  let payloadJson: string | undefined
  let payloadEncoding: PayloadEncoding = 'auto'
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) {
      positionals.push(current)
      continue
    }

    const key = current.slice(2)
    const next = argv[index + 1]
    const hasValue = typeof next === 'string' && !next.startsWith('--')

    switch (key) {
      case 'pretty':
        outputMode = 'pretty'
        break
      case 'token':
        token = hasValue ? next : undefined
        if (hasValue) index += 1
        break
      case 'payload-file':
        payloadFile = hasValue ? next : undefined
        if (hasValue) index += 1
        break
      case 'payload-stdin':
        payloadStdin = true
        break
      case 'payload-json':
        payloadJson = hasValue ? next : undefined
        if (hasValue) index += 1
        break
      case 'encoding':
        if (!hasValue) {
          throw new CommandError('VALIDATION_ERROR', '--encoding 需要指定 auto、utf8 或 gbk', null, 2)
        }
        payloadEncoding = parsePayloadEncoding(next)
        index += 1
        break
      default:
        flags[key] = hasValue ? next : true
        if (hasValue) index += 1
        break
    }
  }

  if (positionals.length < 2) {
    throw new Error('命令格式错误，至少需要 <domain> <action>')
  }

  return {
    outputMode,
    token,
    domain: positionals[0],
    action: positionals[1],
    flags,
    payloadFile,
    payloadStdin,
    payloadJson,
    payloadEncoding
  }
}

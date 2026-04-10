export interface ParsedCliArgs {
  outputMode: 'json' | 'pretty'
  token?: string
  domain: string
  action: string
  flags: Record<string, string | boolean>
  payloadFile?: string
  payloadJson?: string
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const flags: Record<string, string | boolean> = {}
  let outputMode: 'json' | 'pretty' = 'json'
  let token: string | undefined
  let payloadFile: string | undefined
  let payloadJson: string | undefined
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
      case 'payload-json':
        payloadJson = hasValue ? next : undefined
        if (hasValue) index += 1
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
    payloadJson
  }
}

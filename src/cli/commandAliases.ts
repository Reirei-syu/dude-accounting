import { getCommandMetadata } from '../main/commands/catalog'

export function normalizeCliCommandTokens(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return tokens
  }

  const matched = getCommandMetadata().find((spec) => spec.aliases.includes(tokens[0]))
  if (!matched) {
    return tokens
  }

  return [matched.domain, matched.action, ...tokens.slice(1)]
}

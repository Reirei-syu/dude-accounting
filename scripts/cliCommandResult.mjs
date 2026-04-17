function isCommandResult(candidate) {
  return (
    candidate &&
    typeof candidate === 'object' &&
    (candidate.status === 'success' || candidate.status === 'error') &&
    Object.prototype.hasOwnProperty.call(candidate, 'data') &&
    Object.prototype.hasOwnProperty.call(candidate, 'error')
  )
}

export function extractCommandResult(output) {
  const matches = []
  let startIndex = -1
  let depth = 0
  let quote = null
  let escaping = false

  for (let index = 0; index < output.length; index += 1) {
    const current = output[index]

    if (startIndex === -1) {
      if (current === '{') {
        startIndex = index
        depth = 1
        quote = null
        escaping = false
      }
      continue
    }

    if (quote) {
      if (escaping) {
        escaping = false
        continue
      }

      if (current === '\\') {
        escaping = true
        continue
      }

      if (current === quote) {
        quote = null
      }
      continue
    }

    if (current === '"') {
      quote = current
      continue
    }

    if (current === '{') {
      depth += 1
      continue
    }

    if (current !== '}') {
      continue
    }

    depth -= 1
    if (depth !== 0) {
      continue
    }

    try {
      const parsed = JSON.parse(output.slice(startIndex, index + 1))
      if (isCommandResult(parsed)) {
        matches.push(parsed)
      }
    } catch {
      // ignore invalid slices
    }

    startIndex = -1
  }

  if (matches.length === 0) {
    throw new Error(`未找到 CLI JSON 输出：\n${output}`)
  }

  return matches[matches.length - 1]
}
